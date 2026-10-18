import { propertyText } from '../domain/guards';
import { readVisitRecord } from '../visits/store';
import type { App, TFile } from 'obsidian';
import { parse } from 'yaml';
import { createClipperTemplates, parseCapture } from '../capture';
import { captureRefreshReceipts, type CaptureRefreshReceipt } from '../capture/refresh';
import { validateRootPath } from '../domain';
import { resolveLocalities } from '../domain/hierarchy';
import type { CaptureSnapshot, MoveJournal, Settings } from '../types';
import { ASSET_VERSION, bundledAssets, VIEW_TYPE } from './assets';
import { hashText, linkPath, readNote } from './markdown';
import { hasControlCharacters, isRecord, isUnknownArray } from '../domain/guards';
import { parseSettings } from '../platform/settings-data';

export interface AttachmentPreview {
  root: string; fingerprint: string; recognized: boolean;
  counts: { sources: number; parking: number; areas: number; pendingCaptures: number };
  identical: string[]; modified: string[]; missing: string[];
  blockers: string[]; warnings: string[]; reviewRequiredCaptures: string[];
}
export interface AttachmentInspection {
  preview: AttachmentPreview;
  assets: Settings['assets'];
  captureReceipts: Settings['captureReceipts'];
  captureSnapshots: Settings['captureSnapshots'];
}
const isFile = (value: unknown): value is TFile => !!value && typeof value === 'object' && 'extension' in value;
const capturePath = (root: string, path: string) => path.startsWith(root + '/Capture inbox/') && path.endsWith('.md');
const validSnapshot = (value: unknown): value is CaptureSnapshot => isRecord(value) &&
  typeof value.captureId === 'string' && !!value.captureId &&
  typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision);
async function fileHash(app: App, file: TFile): Promise<string> {
  if (typeof app.vault.readBinary === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', await app.vault.readBinary(file));
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  return hashText(await app.vault.read(file));
}
function recognizedBase(raw: string | undefined, root: string): boolean {
  if (!raw) return false;
  try {
    const base: unknown = parse(raw);
    return isRecord(base) && isUnknownArray(base.views) && base.views.some(view => isRecord(view) && view.type === VIEW_TYPE) &&
      JSON.stringify(base.filters ?? {}).includes(root + '/');
  } catch { return false; }
}
function sourceKind(path: string, properties: Record<string, unknown>, root: string): 'sources' | 'parking' | null {
  if (properties.sourcing_example === true) return null;
  const tags = Array.isArray(properties.tags) ? properties.tags : [];
  if ((path.startsWith(root + '/Places/') || path.startsWith(root + '/Sources/') || path.startsWith(root + '/Shops/')) &&
    (tags.includes('sourcing-source') || tags.includes('charity-shop'))) return 'sources';
  return (path.startsWith(root + '/Places/') || path.startsWith(root + '/Parking/')) && tags.includes('parking') ? 'parking' : null;
}
const isPath = (path: unknown): path is string => typeof path === 'string' && !!path && !path.startsWith('/') &&
  !path.includes('\\') && !hasControlCharacters(path, false) && !path.split('/').some(segment => !segment || segment === '.' || segment === '..');
function journalShape(value: unknown): value is MoveJournal {
  try {
    const journal = parseSettings({ migration: value }).migration;
    return !!journal && isPath(journal.fromRoot) && isPath(journal.toRoot) &&
      journal.entries.every(entry => isPath(entry.from) && isPath(entry.to) &&
        /^[a-f0-9]{64}$/.test(entry.beforeHash) && /^[a-f0-9]{64}$/.test(entry.afterHash));
  } catch { return false; }
}
/** Inspect only. A second device must never repair or rewrite an existing notebook while attaching. */
export async function inspectNotebook(app: App, settings: Settings, requestedRoot: string): Promise<AttachmentInspection> {
  const root = validateRootPath(requestedRoot);
  const rootEntry = app.vault.getAbstractFileByPath(root);
  const blockers: string[] = [], warnings: string[] = [];
  if (!rootEntry || isFile(rootEntry)) blockers.push('Choose an existing sourcing notebook folder.');
  if (settings.migration) blockers.push('Finish or explicitly recover the interrupted move on the originating device before attaching.');
  const allFiles = app.vault.getFiles(), files = allFiles.filter(file => file.path.startsWith(root + '/')).sort((a, b) => a.path.localeCompare(b.path));
  const hashes = new Map<string, string>(), texts = new Map<string, string>();
  for (const file of files) {
    if (['md', 'base', 'json'].includes(file.extension)) {
      const raw = await app.vault.read(file); texts.set(file.path, raw); hashes.set(file.path, await hashText(raw));
    } else hashes.set(file.path, await fileHash(app, file));
  }
  const parsed = new Map<string, Record<string, unknown>>();
  for (const file of files.filter(file => file.extension === 'md')) {
    try { parsed.set(file.path, readNote(texts.get(file.path)!).properties); }
    catch { warnings.push('Invalid properties were left untouched: ' + file.path); }
  }
  const practiceState = texts.get(root + '/System/Practice state.json');
  if (practiceState) { try { const state: unknown = JSON.parse(practiceState); if (isRecord(state) && state.format === 'reseller-sourcing-examples') blockers.push('Examples is a fictional practice notebook. Open it through Examples instead of attaching it as your real notebook.'); } catch { blockers.push('The practice state cannot be inspected. Do not attach Examples as a real notebook.'); } }
  const counts = { sources: 0, parking: 0, areas: 0, pendingCaptures: 0 };
  const placePaths: string[] = [], captures: string[] = [];
  const receipts = new Map<string, string[]>();
  const refreshReceipts: { target: string; receipt: CaptureRefreshReceipt }[] = [];
  for (const [path, properties] of parsed) {
    const kind = sourceKind(path, properties, root);
    if (kind) {
      counts[kind]++; placePaths.push(path);
      const id = properties.source_capture_id;
      if (typeof id === 'string' && id.trim()) receipts.set(id, [...(receipts.get(id) ?? []), path]);
      if (kind === 'sources') for (const receipt of captureRefreshReceipts(properties)) refreshReceipts.push({ target: path, receipt });
    }
    if (capturePath(root, path) && properties.sourcing_capture === 1 && properties.sourcing_example !== true) captures.push(path);
  }
  counts.pendingCaptures = captures.length;
  const areaInputs = [...parsed].filter(([path, properties]) => properties.sourcing_example !== true && (path.startsWith(root + '/Places/') || path.startsWith(root + '/Localities/')) &&
    Array.isArray(properties.tags) && properties.tags.includes('sourcing-locality')).map(([path, properties]) => ({
      path, name: propertyText(properties.area_name, path.split('/').at(-1)!.slice(0, -3)), parentPath: linkPath(properties.parent_locality),
    }));
  for (const area of areaInputs) if (area.parentPath && !area.parentPath.includes('/')) {
    const matches = areaInputs.filter(candidate => candidate.name === area.parentPath.replace(/\.md$/, ''));
    if (matches.length === 1) area.parentPath = matches[0].path;
  }
  const localities = resolveLocalities(areaInputs); counts.areas = localities.length;
  if (localities.length !== areaInputs.length) warnings.push('Some area links are invalid or ambiguous; they were left untouched.');
  const visitIds = new Map<string,string[]>();
  for (const [path, properties] of parsed) {
    if (!path.startsWith(root + '/Visits/') || properties.sourcing_example === true) continue;
    try {
      const visit = await readVisitRecord(texts.get(path)!, path);
      visitIds.set(visit.id, [...(visitIds.get(visit.id) ?? []), path]);
      if (!placePaths.includes(visit.sourcePath) || sourceKind(visit.sourcePath, parsed.get(visit.sourcePath) ?? {}, root) !== 'sources') warnings.push('A visit points to a missing or different notebook source; it was left untouched: ' + path);
      if (visit.outingPath && !visit.outingPath.startsWith(root + '/Outings/')) warnings.push('A visit points outside this notebook; it was left untouched: ' + path);
    } catch { warnings.push('A visit record needs review; its original bytes were left untouched: ' + path); }
  }
  for (const paths of visitIds.values()) if (paths.length > 1) warnings.push('Duplicate visit identities need review; no visit was changed: ' + paths.join(', '));
  for (const [path, raw] of texts) if (path.startsWith(root + '/System/Visit operations/') && path.endsWith('.json')) {
    try { const operation: unknown = JSON.parse(raw); if (!isRecord(operation) || operation.stage !== 'complete' && operation.stage !== 'cancelled') warnings.push('A visit save needs explicit recovery after attachment; it was not replayed: ' + path); }
    catch { warnings.push('A visit recovery record needs review; it was left untouched: ' + path); }
  }
  const hasSystem = recognizedBase(texts.get(root + '/System/Sources.base'), root) ||
    recognizedBase(texts.get(root + '/System/Parking.base'), root);
  const home = texts.get(root + '/Home.md') ?? '';
  const hasHome = /```charity-sourcing\s*\r?\n(?:[^\n]*\n)*?view:\s*home\s*\r?\n/.test(home);
  const recognized = hasSystem && (hasHome || placePaths.length > 0);
  if (!recognized) blockers.push('This folder is not a recognized Reseller sourcing notebook. It needs its sourcing Home and system Base, or saved sourcing places and a system Base.');
  const expected: Record<string, string> = bundledAssets(root, app.vault.getName());
  const clipper = createClipperTemplates(root, app.vault.getName());
  expected[root + '/System/Templates/Web Clipper/Capture source.json'] = JSON.stringify(clipper.shop, null, 2) + '\n';
  expected[root + '/System/Templates/Web Clipper/Capture parking.json'] = JSON.stringify(clipper.parking, null, 2) + '\n';
  const identical: string[] = [], modified: string[] = [], missing: string[] = [], assets: Settings['assets'] = {};
  for (const [path, canonical] of Object.entries(expected)) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) missing.push(path);
    else if (isFile(file) && texts.get(path) === canonical) {
      identical.push(path); assets[path] = { hash: hashes.get(path)!, version: ASSET_VERSION };
    } else modified.push(path);
  }
  const captureReceipts: Settings['captureReceipts'] = {};
  for (const [id, paths] of receipts) {
    if (paths.length === 1) captureReceipts[id] = paths[0]!;
    else blockers.push('Capture identity is used by more than one saved record: ' + paths.join(', '));
  }
  const evidence = new Map<string, CaptureSnapshot[]>();
  const addEvidence = (path: string, snapshot: CaptureSnapshot) => {
    if (capturePath(root, path) && hashes.get(path) === snapshot.revision && validSnapshot(snapshot) && !snapshot.reviewRequired)
      evidence.set(path, [...(evidence.get(path) ?? []), snapshot]);
  };
  for (const [path, snapshot] of Object.entries(settings.captureSnapshots ?? {})) addEvidence(path, snapshot);
  const manifestEvidence: [string, string][] = [];
  for (const file of allFiles.filter(file => /\/System\/Migration backups\/[^/]+\/manifest\.json$/.test(file.path))) {
    let journal: unknown, raw: string;
    try { raw = await app.vault.read(file); journal = JSON.parse(raw); }
    catch { if (file.path.startsWith(root + '/')) blockers.push('A migration record cannot be inspected: ' + file.path); continue; }
    if (!isRecord(journal) || (journal.fromRoot !== root && journal.toRoot !== root)) continue;
    manifestEvidence.push([file.path, await hashText(raw)]);
    if (!journalShape(journal)) { blockers.push('A migration record is incomplete or invalid; inspect it on the originating desktop: ' + file.path); continue; }
    let completed: 'completed' | 'rolled-back' | null = null;
    for (const [suffix, state] of [['complete.json', 'completed'], ['rollback.json', 'rolled-back']] as const) {
      const receiptPath = file.path.slice(0, -'manifest.json'.length) + suffix;
      const receiptFile = app.vault.getAbstractFileByPath(receiptPath);
      if (!isFile(receiptFile)) continue;
      const receiptRaw = await app.vault.read(receiptFile);
      manifestEvidence.push([receiptPath, await hashText(receiptRaw)]);
      try {
        const receipt: unknown = JSON.parse(receiptRaw);
        if (isRecord(receipt) && receipt.schema === 1 && receipt.id === journal.id && receipt.fromRoot === journal.fromRoot &&
          receipt.toRoot === journal.toRoot && receipt.state === state && receipt.manifestHash === await hashText(raw)) completed = state;
        else blockers.push('A migration completion record cannot be verified: ' + receiptPath);
      } catch { blockers.push('A migration completion record cannot be read: ' + receiptPath); }
    }
    let before = true, after = true;
    for (const entry of journal.entries) {
      const original = app.vault.getAbstractFileByPath(entry.from), destination = app.vault.getAbstractFileByPath(entry.to);
      const fromHash = isFile(original) ? await fileHash(app, original) : null;
      const toHash = entry.from === entry.to ? fromHash : isFile(destination) ? await fileHash(app, destination) : null;
      manifestEvidence.push([entry.from, fromHash ?? 'missing'], [entry.to, toHash ?? 'missing']);
      before &&= fromHash === entry.beforeHash && (entry.from === entry.to || !destination);
      after &&= toHash === entry.afterHash && (entry.from === entry.to || !original);
    }
    if (completed) { before = completed === 'rolled-back'; after = completed === 'completed'; }
    if (!before && !after) {
      blockers.push('A previous move has mixed or unverifiable files. Complete or recover it on the originating desktop before attaching: ' + file.path);
      continue;
    }
    for (const [oldPath, snapshot] of Object.entries(journal.settingsBefore?.captureSnapshots ?? {})) {
      const entry = journal.entries.find(value => value.from === oldPath);
      addEvidence(after && entry ? entry.to : oldPath, snapshot);
    }
    for (const entry of journal.entries) {
      const path = after ? entry.to : entry.from, rawCapture = texts.get(path);
      if (!captures.includes(path) || rawCapture === undefined || hashes.get(path) !== entry.beforeHash || entry.beforeHash !== entry.afterHash) continue;
      const known = journal.settingsBefore?.captureSnapshots?.[entry.from];
      if (known?.reviewRequired) continue;
      if (validSnapshot(known)) addEvidence(path, known);
      else addEvidence(path, { captureId: await hashText(entry.from + '\n' + rawCapture), revision: entry.beforeHash });
    }
  }
  // Portable receipts recover a finished source update only when the unchanged raw
  // capture can be verified. They never assign an arbitrary identity to an inbox file.
  for (const { target, receipt } of refreshReceipts) {
    let verified = false;
    const archivedPath = [root + '/System/Capture archive/' + receipt.captureId + '.md', root + '/Capture archive/' + receipt.captureId + '.md'].find(path => texts.has(path)) ?? '';
    for (const path of [...captures, archivedPath]) {
      if (hashes.get(path) !== receipt.captureRevision) continue;
      const properties = parsed.get(path);
      if (!properties) continue;
      try {
        const draft = parseCapture(properties, path);
        if (draft.kind !== 'shop' || draft.url !== receipt.captureUrl) continue;
      } catch { continue; }
      if (captures.includes(path)) {
        if (settings.captureSnapshots?.[path]?.reviewRequired) continue;
        const known = evidence.get(path) ?? [];
        const directId = await hashText(path + '\n' + texts.get(path)!);
        if (directId !== receipt.captureId && !known.some(snapshot => snapshot.captureId === receipt.captureId)) continue;
        addEvidence(path, { captureId: receipt.captureId, revision: receipt.captureRevision });
      }
      verified = true;
    }
    if (!verified) {
      warnings.push('A source refresh receipt has no verified raw capture; it was left untouched: ' + target);
      continue;
    }
    const prior = captureReceipts[receipt.captureId];
    if (prior && prior !== target) blockers.push('Capture identity is used by more than one saved record: ' + prior + ', ' + target);
    else captureReceipts[receipt.captureId] = target;
  }
  const captureSnapshots: Settings['captureSnapshots'] = {}, reviewRequiredCaptures: string[] = [];
  for (const path of captures) {
    const matches = [...new Map((evidence.get(path) ?? []).map(snapshot => [snapshot.captureId, snapshot])).values()];
    if (matches.length === 1) captureSnapshots[path] = matches[0]!;
    else {
      captureSnapshots[path] = { captureId: '', revision: hashes.get(path)!, reviewRequired: true };
      reviewRequiredCaptures.push(path);
    }
  }
  if (reviewRequiredCaptures.length) warnings.push('Some pending captures need review on the originating desktop before this device can safely save them. Their original files stay unchanged.');
  const preview: AttachmentPreview = {
    root, fingerprint: await hashText(JSON.stringify({
      root, files: [...hashes], manifests: manifestEvidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      trustedSnapshots: settings.captureSnapshots ?? {}, migration: settings.migration ?? null,
      owned: identical, receipts: captureReceipts, snapshots: captureSnapshots, blockers,
    })), recognized, counts, identical, modified, missing, blockers: [...new Set(blockers)], warnings, reviewRequiredCaptures,
  };
  return { preview, assets, captureReceipts, captureSnapshots };
}
