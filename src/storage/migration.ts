import type { App, TFile } from 'obsidian';
import type { CaptureSnapshot, MoveJournal, MovePreview, MoveReport, MoveSettingsSnapshot, Settings } from '../types';
import { validateRootPath } from '../domain';
import { hashText, linkPath, readNote } from './markdown';

const textExtensions = new Set(['md', 'base', 'json', 'txt', 'css', 'csv', 'html', 'yaml', 'yml', 'svg', 'backup']);
const isFile = (value: unknown): value is TFile => !!value && typeof value === 'object' && 'extension' in value;
export function migrationEligible(path: string): boolean {
  return !path.split('/').some(segment => segment.startsWith('.')) && !path.includes('/System/Migration backups/');
}
export function remapPath(path: string, mapping: ReadonlyMap<string, string>): string {
  return mapping.get(path) ?? path;
}
export function stripCodexMarkers(text: string): string {
  return text.replace(/^[ \t]*(?:<!--\s*\/?codex-generated(?::[^>]*?)?\s*-->|#\s*\/?codex-generated(?::.*)?)[ \t]*\r?\n?/gmi, '');
}
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
function relativePath(fromFile: string, to: string): string {
  const from = fromFile.split('/').slice(0, -1), target = to.split('/');
  while (from.length && target.length && from[0] === target[0]) { from.shift(); target.shift(); }
  return [...from.map(() => '..'), ...target].join('/');
}
function resolveTarget(app: App, target: string, from: string, allFiles: TFile[], markdownRelative = false): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { decoded = target; }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(decoded)) return null;
  const direct = (path: string) => allFiles.find(file => file.path === path || (file.extension === 'md' && file.path === path + '.md'))?.path;
  if (markdownRelative) {
    const relative = direct(normalizePath(from.split('/').slice(0, -1).join('/') + '/' + decoded));
    if (relative) return relative;
  }
  const cached = app.metadataCache?.getFirstLinkpathDest?.(decoded, from);
  if (cached && allFiles.some(file => file.path === cached.path)) return cached.path;
  const exact = direct(decoded);
  if (exact) return exact;
  const relative = direct(normalizePath(from.split('/').slice(0, -1).join('/') + '/' + decoded));
  if (relative) return relative;
  const candidates = allFiles.filter(file => file.path.endsWith('/' + decoded) || file.path.endsWith('/' + decoded + '.md'));
  return candidates.length === 1 ? candidates[0].path : null;
}
export function rewriteLinks(app: App, text: string, from: string, to: string, mapping: ReadonlyMap<string, string>, allFiles: TFile[]): string {
  let next = text.replace(/\[\[([^\]\r\n]+)\]\]/g, (whole, raw: string) => {
    const split = raw.search(/[|#]/), target = split < 0 ? raw : raw.slice(0, split), suffix = split < 0 ? '' : raw.slice(split);
    const resolved = resolveTarget(app, target, from, allFiles);
    const replacement = resolved && (mapping.get(resolved) ?? (from !== to ? resolved : null));
    if (!replacement) return whole;
    const newTarget = /\.md$/i.test(target) ? replacement : replacement.replace(/\.md$/i, '');
    return '[[' + newTarget + suffix + ']]';
  });
  next = next.replace(/(!?\[[^\]\r\n]*\]\()(<[^>\r\n]+>|[^\s)\r\n]+)([ \t]+(?:"[^"]*"|'[^']*'))?(\))/g,
    (whole, prefix: string, raw: string, title = '', end: string) => {
      const bracketed = raw.startsWith('<'), value = bracketed ? raw.slice(1, -1) : raw;
      const hash = value.indexOf('#'), target = hash < 0 ? value : value.slice(0, hash), suffix = hash < 0 ? '' : value.slice(hash);
      const resolved = resolveTarget(app, target, from, allFiles, true);
      if (!resolved || (!mapping.has(resolved) && from === to)) return whole;
      const newTarget = relativePath(to, mapping.get(resolved) ?? resolved).split('/').map(encodeURIComponent).join('/') + suffix;
      return prefix + (bracketed ? '<' + newTarget + '>' : newTarget) + title + end;
    });
  // Protocol links store their note target in a query parameter.
  next = next.replace(/obsidian:\/\/charity-sourcing\?[^\s<)"'\]]+/g, url => {
    try {
      const parsed = new URL(url), path = parsed.searchParams.get('path');
      if (path && mapping.has(path)) { parsed.searchParams.set('path', mapping.get(path)!); return parsed.toString(); }
    } catch { /* Leave invalid user links untouched. */ }
    return url;
  });
  return next;
}

/** Replace whole path prefixes once, never substrings of similarly named sibling folders. */
export function rewritePathPrefixes(text: string, prefixes: [string, string][]): string {
  const variants = new Map<string, { replacement: string; encoded: boolean }>();
  for (const [before, after] of prefixes) {
    variants.set(JSON.stringify(before).slice(1, -1), { replacement: JSON.stringify(after).slice(1, -1), encoded: false });
    const encoded = encodeURIComponent(before);
    if (encoded !== before) variants.set(encoded, { replacement: encodeURIComponent(after), encoded: true });
  }
  if (!variants.size) return text;
  const escape = (value: string) => value.replace(/[.*+?^{}$()|[\]\\]/g, character => '\\' + character);
  const alternatives = [...variants.keys()].sort((a, b) => b.length - a.length).map(escape).join('|');
  const pattern = new RegExp('(^|["\\\'(\\[=])(' + alternatives + ')(?=$|/|%2[Ff]|["\\\')\\]},#?]|\\.md(?=$|["\\\')\\]},#?]))', 'gm');
  return text.replace(pattern, (whole, before: string, path: string, offset: number) => {
    const variant = variants.get(path)!;
    const next = text.slice(offset + whole.length);
    if (!variant.encoded && (before === '=' || /^%2f/i.test(next))) {
      return before + encodeURIComponent(variant.replacement);
    }
    return before + variant.replacement;
  });
}

async function readBytes(app: App, file: TFile): Promise<ArrayBuffer> {
  if (typeof app.vault.readBinary === 'function') return app.vault.readBinary(file);
  if (!textExtensions.has(file.extension)) throw new Error('Binary backup support is required for ' + file.path);
  return new TextEncoder().encode(await app.vault.read(file)).buffer;
}
function decodeText(bytes: ArrayBuffer | Uint8Array): string { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
async function bytesHash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function ensureFolder(app: App, path: string): Promise<void> {
  validateRootPath(path);
  let current = '';
  for (const part of path.split('/')) {
    current += (current ? '/' : '') + part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (isFile(existing)) throw new Error('A file occupies the folder ' + current);
    if (!existing) await app.vault.createFolder(current);
  }
}
function fileAt(app: App, path: string): TFile {
  const file = app.vault.getAbstractFileByPath(path);
  if (!isFile(file)) throw new Error('File no longer exists: ' + path);
  return file;
}
async function rename(app: App, file: TFile, path: string): Promise<void> {
  await ensureFolder(app, path.slice(0, path.lastIndexOf('/')));
  if (app.vault.getAbstractFileByPath(path)) throw new Error('Move destination already exists: ' + path);
  // Vault.rename does not depend on the user's automatic link-update preference.
  if (typeof app.vault.rename === 'function') await app.vault.rename(file, path);
  else await app.fileManager.renameFile(file, path);
}
export interface PrepareMoveOptions {
  kind: MovePreview['kind']; toRoot: string; mapping: Map<string, string>;
  prefixes?: [string, string][]; content?: Record<string, string>;
  locality?: MovePreview['locality'];
  rawCaptureRoots?: string[]; ignoredPaths?: string[]; opaqueSubtrees?: string[]; writeBoundary?: string;
}
export async function prepareMove(app: App, settings: Settings, options: PrepareMoveOptions): Promise<MovePreview> {
  if (settings.migration) throw new Error('A previous move needs recovery before another move can begin.');
  const fromRoot = validateRootPath(settings.root), toRoot = validateRootPath(options.toRoot);
  const opaqueSubtrees = options.opaqueSubtrees ?? [], ignored = new Set(options.ignoredPaths ?? []);
  const allFiles = app.vault.getFiles().filter(file => !ignored.has(file.path) && (migrationEligible(file.path) || opaqueSubtrees.some(root => file.path.startsWith(root + '/'))));
  const mapping = options.mapping;
  const conflicts: string[] = [], entries: MovePreview['entries'] = [], observed: Record<string, string> = {};
  const captureSnapshots: Record<string, CaptureSnapshot> = structuredClone(settings.captureSnapshots ?? {});
  const folded = new Map<string, string>();
  for (const file of allFiles) {
    const to = mapping.get(file.path) ?? file.path, lower = to.toLocaleLowerCase();
    if (folded.has(lower) && folded.get(lower) !== file.path) conflicts.push('Two files would share ' + to);
    folded.set(lower, file.path);
    if (mapping.has(file.path)) {
      const destination = app.vault.getAbstractFileByPath(to);
      if (destination && to !== file.path && !mapping.has(to)) conflicts.push('Destination already exists: ' + to);
      const parts = to.split('/');
      for (let i = 1; i < parts.length; i++) if (isFile(app.vault.getAbstractFileByPath(parts.slice(0, i).join('/')))) conflicts.push('A file occupies a destination folder: ' + parts.slice(0, i).join('/'));
    }
    const opaque = opaqueSubtrees.some(root => file.path.startsWith(root + '/'));
    const textFile = !opaque && textExtensions.has(file.extension);
    if (!mapping.has(file.path) && !textFile) continue;
    const bytes = await readBytes(app, file), beforeHash = await bytesHash(bytes);
    observed[file.path] = beforeHash;
    let text: string | undefined;
    if (textFile) {
      const raw = decodeText(bytes);
      const rawCapture = [fromRoot, ...(settings.previousRoots ?? []), ...(options.rawCaptureRoots ?? [])].some(root => file.path.startsWith(root + '/Capture inbox/') || file.path.startsWith(root + '/Capture archive/') || file.path.startsWith(root + '/System/Capture archive/'));
      let next = rawCapture ? raw : rewriteLinks(app, raw, file.path, to, mapping, allFiles);
      if (options.kind !== 'place-area' && options.kind !== 'capture-archive' && file.extension === 'md' && file.path.startsWith(fromRoot + '/') && !/\/Capture (?:inbox|archive)\//.test(file.path)) next = stripCodexMarkers(next);
      if (['base', 'json'].includes(file.extension) && file.path.startsWith(fromRoot + '/')) {
        next = rewritePathPrefixes(next, options.prefixes ?? []);
      }
      if (options.content?.[file.path] !== undefined) next = options.content[file.path]!;
      if (next !== raw) text = next;
      if (file.path.startsWith(fromRoot + '/Capture inbox/') && file.extension === 'md') {
        try {
          if (readNote(raw).properties.sourcing_capture === 1) {
            const previous = captureSnapshots[file.path];
            const captureId = previous?.revision === beforeHash ? previous.captureId : await hashText(file.path + '\n' + raw);
            captureSnapshots[file.path] = { ...previous, captureId, revision: beforeHash };
          }
        } catch { /* Malformed captures are moved without changing their contents. */ }
      }
    }
    if (mapping.has(file.path) || text !== undefined) entries.push({ from: file.path, to, beforeHash, afterHash: text === undefined ? beforeHash : await hashText(text), ...(text === undefined ? {} : { text }) });
  }
  if (options.writeBoundary) {
    validateRootPath(options.writeBoundary);
    for (const entry of entries) if (![entry.from, entry.to].every(path => path.startsWith(options.writeBoundary! + '/'))) conflicts.push('Practice changes would affect a note outside Examples: ' + entry.from);
  }
  const files = entries.filter(e => e.from !== e.to).map(e => ({ from: e.from, to: e.to }));
  const preview: MovePreview = { id: crypto.randomUUID(), kind: options.kind, fromRoot, toRoot, files, moves: files,
    rewrites: entries.filter(e => e.text !== undefined).map(e => e.from), conflicts: [...new Set(conflicts)], warnings: [],
    entries, inventory: allFiles.map(file => file.path).sort(), observed, captureSnapshots,
    ...(options.ignoredPaths ? { ignoredPaths: options.ignoredPaths } : {}), ...(options.opaqueSubtrees ? { opaqueSubtrees: options.opaqueSubtrees } : {}), ...(options.writeBoundary ? { writeBoundary: options.writeBoundary } : {}), ...(options.locality ? { locality: options.locality } : {}) };
  const nestedConfig = fromRoot + '/' + app.vault.configDir;
  if (app.vault.getAbstractFileByPath(nestedConfig)) preview.warnings.push('The nested vault settings stay in ' + nestedConfig + '. Open the notebook inside the current vault.');
  return preview;
}

async function hintTownPath(app: App, target: string, root: string): Promise<string | null> {
  const seen = new Set<string>();
  let path = target;
  while ((path.startsWith(root + '/Places/') || path.startsWith(root + '/Localities/')) && !seen.has(path)) {
    seen.add(path);
    const file = app.vault.getAbstractFileByPath(path);
    if (!isFile(file)) return null;
    try {
      const { properties } = readNote(await app.vault.read(file));
      if (!Array.isArray(properties.tags) || !properties.tags.includes('sourcing-locality')) return null;
      const parent = linkPath(properties.parent_locality);
      if (!parent) return path;
      if (parent.includes('/')) path = parent;
      else {
        const candidates = app.vault.getMarkdownFiles().filter(record => record.path.startsWith(root + '/Localities/') && record.basename === parent.replace(/\.md$/, ''));
        if (candidates.length !== 1) return null;
        path = candidates[0].path;
      }
    } catch { return null; }
  }
  return null;
}

function settingsSnapshot(settings: Settings): MoveSettingsSnapshot {
  return structuredClone({ root: settings.root, assets: settings.assets, captureReceipts: settings.captureReceipts,
    captureSnapshots: settings.captureSnapshots ?? {}, previousRoots: settings.previousRoots ?? [], recentLocalities: settings.recentLocalities ?? [], areaHints: settings.areaHints ?? [],
    ...(settings.shortTripDefaults ? { shortTripDefaults: settings.shortTripDefaults } : {}) });
}
export async function validateMovePreview(app: App, settings: Settings, preview: MovePreview): Promise<void> {
  if (settings.migration) throw new Error('A previous move needs recovery. Inspect it or use the explicit rollback action.');
  if (settings.root !== preview.fromRoot || preview.conflicts.length) throw new Error('Resolve the move conflicts and preview the move again.');
  const inventory = app.vault.getFiles().filter(file => !(preview.ignoredPaths ?? []).includes(file.path) && (migrationEligible(file.path) || (preview.opaqueSubtrees ?? []).some(root => file.path.startsWith(root + '/')))).map(file => file.path).sort();
  if (JSON.stringify(inventory) !== JSON.stringify(preview.inventory)) throw new Error('Files changed since the preview. Preview the move again.');
  for (const [path, expected] of Object.entries(preview.observed)) if (await bytesHash(await readBytes(app, fileAt(app, path))) !== expected) throw new Error('A file changed since the preview: ' + path);
}

async function writeMoveCompletion(app: App, journal: MoveJournal, state: 'completed' | 'rolled-back'): Promise<void> {
  const manifest = app.vault.getAbstractFileByPath(journal.backupRoot + '/manifest.json');
  // A preparation failure may occur before the immutable manifest was written.
  if (!isFile(manifest)) return;
  const content = JSON.stringify({
    schema: 1, id: journal.id, fromRoot: journal.fromRoot, toRoot: journal.toRoot, state,
    manifestHash: await hashText(await app.vault.read(manifest)),
  }, null, 2) + '\n';
  const path = journal.backupRoot + (state === 'completed' ? '/complete.json' : '/rollback.json');
  const existing = app.vault.getAbstractFileByPath(path);
  if (!existing) await app.vault.create(path, content);
  else if (!isFile(existing) || await app.vault.read(existing) !== content) throw new Error('Move completion record conflicts: ' + path);
}
export async function executeMove(app: App, settings: Settings, save: () => Promise<void>, preview: MovePreview): Promise<MoveReport> {
  await validateMovePreview(app, settings, preview);
  if (preview.writeBoundary && preview.entries.some(entry => ![entry.from, entry.to].every(path => path.startsWith(preview.writeBoundary! + '/')))) throw new Error('Practice changes cannot write outside Examples.');
  const backupRoot = preview.fromRoot + '/System/Migration backups/' + preview.id;
  const journal: MoveJournal = settings.migration = { id: preview.id, kind: preview.kind, status: 'preparing' as const, backupRoot,
    fromRoot: preview.fromRoot, toRoot: preview.toRoot, entries: structuredClone(preview.entries), ...(preview.writeBoundary ? { writeBoundary: preview.writeBoundary } : {}), settingsBefore: settingsSnapshot(settings) };
  await save();
  const backupBytes = new Map<string, ArrayBuffer>();
  try {
    await ensureFolder(app, backupRoot);
    for (let i = 0; i < journal.entries.length; i++) {
      const entry = journal.entries[i], bytes = await readBytes(app, fileAt(app, entry.from));
      if (await bytesHash(bytes) !== entry.beforeHash) throw new Error('A file changed before backup: ' + entry.from);
      const backupPath = backupRoot + '/' + String(i).padStart(5, '0') + '.backup';
      if (typeof app.vault.createBinary === 'function') await app.vault.createBinary(backupPath, bytes);
      else await app.vault.create(backupPath, decodeText(bytes));
      if (await bytesHash(await readBytes(app, fileAt(app, backupPath))) !== entry.beforeHash) throw new Error('Backup verification failed for ' + entry.from);
      backupBytes.set(entry.from, bytes);
      entry.backupPath = backupPath; entry.phase = 'backed-up'; await save();
    }
    await app.vault.create(backupRoot + '/manifest.json', JSON.stringify(journal, null, 2));
    settings.migration.status = 'moving'; await save();
    for (const entry of journal.entries) {
      let file = fileAt(app, entry.from);
      if (await bytesHash(await readBytes(app, file)) !== entry.beforeHash) throw new Error('A file changed during the move: ' + entry.from);
      if (entry.from !== entry.to) { await rename(app, file, entry.to); file = fileAt(app, entry.to); entry.phase = 'moved'; await save(); }
      if (entry.text !== undefined) await app.vault.process(file, raw => {
        // Process verifies the exact snapshot synchronously, including concurrent editor writes.
        const original = raw;
        if (original !== decodeText(backupBytes.get(entry.from)!)) throw new Error('A file changed during link updates: ' + entry.to);
        return entry.text!;
      });
      if (await bytesHash(await readBytes(app, fileAt(app, entry.to))) !== entry.afterHash) throw new Error('Move verification failed for ' + entry.to);
      entry.phase = 'updated'; await save();
    }
    const mapping = new Map(journal.entries.filter(e => e.from !== e.to).map(e => [e.from, e.to]));
    settings.assets = Object.fromEntries(Object.entries(settings.assets).map(([path, asset]) => {
      const entry = journal.entries.find(e => e.from === path);
      return [remapPath(path, mapping), entry && asset.hash === entry.beforeHash ? { ...asset, hash: entry.afterHash } : asset];
    }));
    settings.captureReceipts = Object.fromEntries(Object.entries(settings.captureReceipts).map(([id, path]) => [id, remapPath(path, mapping)]));
    settings.captureSnapshots = Object.fromEntries(Object.entries(preview.captureSnapshots).map(([path, snapshot]) => {
      const entry = journal.entries.find(e => e.from === path);
      return [remapPath(path, mapping), { ...snapshot, revision: entry?.afterHash ?? snapshot.revision }];
    }));
    settings.recentLocalities = (settings.recentLocalities ?? []).map(path => remapPath(path, mapping));
    if (settings.shortTripDefaults?.startPath) settings.shortTripDefaults.startPath = remapPath(settings.shortTripDefaults.startPath, mapping);
    const movedHintRoot = preview.kind === 'notebook' ? preview.toRoot : settings.root;
    settings.areaHints = await Promise.all((settings.areaHints ?? []).map(async hint => {
      if (!mapping.has(hint.localityPath) && !mapping.has(hint.townPath)) return hint;
      const target = hint.localityPath ? remapPath(hint.localityPath, mapping) : '';
      const townPath = target ? await hintTownPath(app, target, movedHintRoot) : null;
      return { ...hint, townPath: townPath ?? remapPath(hint.townPath, mapping), localityPath: target };
    }));
    if (preview.kind === 'notebook') {
      settings.root = preview.toRoot;
      settings.previousRoots = [...new Set([...(settings.previousRoots ?? []), preview.fromRoot])].filter(root => root !== preview.toRoot);
    }
    await writeMoveCompletion(app, journal, 'completed');
    delete settings.migration; await save();
    return { moved: preview.files.map(file => file.to), updated: preview.rewrites.map(path => remapPath(path, mapping)), backupRoot };
  } catch (error) {
    settings.migration = journal; settings.migration.status = 'failed'; settings.migration.error = String(error);
    await save(); throw new Error('Move stopped safely. Backups: ' + backupRoot + '. ' + String(error));
  }
}
/** Explicit recovery only: refuse any path whose current contents no longer match our snapshots. */
export async function rollbackMove(app: App, settings: Settings, save: () => Promise<void>): Promise<MoveReport> {
  const journal = settings.migration;
  if (!journal) throw new Error('There is no interrupted move to roll back.');
  if (journal.writeBoundary && journal.entries.some(entry => ![entry.from, entry.to, entry.backupPath ?? journal.backupRoot + '/pending'].every(path => path.startsWith(journal.writeBoundary! + '/')))) throw new Error('Practice recovery cannot write outside Examples.');
  const checks: { entry: typeof journal.entries[number]; current: TFile; bytes: ArrayBuffer }[] = [];
  for (const entry of journal.entries) {
    if (!entry.backupPath) continue;
    const bytes = await readBytes(app, fileAt(app, entry.backupPath));
    if (await bytesHash(bytes) !== entry.beforeHash) throw new Error('Recovery backup changed: ' + entry.backupPath);
    const from = app.vault.getAbstractFileByPath(entry.from), to = entry.from === entry.to ? from : app.vault.getAbstractFileByPath(entry.to);
    if (from && to && entry.from !== entry.to) throw new Error('Both original and destination exist; inspect ' + entry.from);
    const current = from ?? to;
    if (!isFile(current)) throw new Error('A moved file is missing: ' + entry.from);
    const hash = await bytesHash(await readBytes(app, current));
    if (hash !== entry.beforeHash && hash !== entry.afterHash) throw new Error('A moved file has new edits; preserve them before recovery: ' + current.path);
    checks.push({ entry, current, bytes });
  }
  for (const { entry, current, bytes } of checks.reverse()) {
    let file = current;
    if (file.path !== entry.from) { await rename(app, file, entry.from); file = fileAt(app, entry.from); }
    if (entry.beforeHash !== await bytesHash(await readBytes(app, file))) {
      const expected = entry.afterHash;
      const beforeText = decodeText(bytes);
      const actualText = await app.vault.read(file);
      if (await hashText(actualText) !== expected) throw new Error('Recovery stopped because the file changed: ' + file.path);
      await app.vault.process(file, raw => { if (raw !== actualText) throw new Error('Recovery stopped because the file changed: ' + file.path); return beforeText; });
    }
    if (await bytesHash(await readBytes(app, file)) !== entry.beforeHash) throw new Error('Recovery verification failed: ' + entry.from);
  }
  await writeMoveCompletion(app, journal, 'rolled-back');
  if (journal.settingsBefore.shortTripDefaults === undefined) delete settings.shortTripDefaults;
  Object.assign(settings, structuredClone(journal.settingsBefore)); delete settings.migration; await save();
  return { moved: checks.map(({ entry }) => entry.from), updated: [], backupRoot: journal.backupRoot };
}
