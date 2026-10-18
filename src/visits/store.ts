import { propertyText } from '../domain/guards';
import type { App, TFile } from 'obsidian';
import type { PlaceRecord, VisitInput } from '../types';
import { safeFileName } from '../domain';
import { hashText, linkPath, readNote, updateNoteProperty, wiki, writeNote } from '../storage/markdown';
import type { ColourEvidence, VisitInspection, VisitOperation, VisitRecord, VisitSaveOptions, VisitDraftState, VisitSavedWorkInspection } from './types';
import { hasControlCharacters, isUnknownArray } from '../domain/guards';
import { notebookFiles } from '../storage/files';
interface VisitHost {
  app: App; root(): string; examples?: boolean;
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  listPlaces(): Promise<PlaceRecord[]>; folder(path: string): Promise<void>;
  sourceBlocked?(path: string, operationId?: string): Promise<boolean>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fileLike = (v: unknown): v is TFile => object(v) && 'extension' in v;
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00Z')) && new Date(v + 'T00:00Z').toISOString().slice(0, 10) === v;
const validTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const sections = ['Observations', 'Useful finds', 'Next time'] as const;
const keys = ['visit_schema', 'visit_id', 'source', 'visit_date', 'recorded_at', 'updated_at', 'items_purchased', 'haul_potential', 'stock_colour', 'colour_evidence', 'outing', 'outing_id', 'stop_id', 'legacy_operation_id'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Drafts may be incomplete, but their portable scalar shapes must remain valid. */
export function visitInputShape(value: unknown): value is VisitInput {
  if (!object(value) || typeof value.observations !== 'string' || typeof value.finds !== 'string' || typeof value.nextTime !== 'string' || typeof value.visitDate !== 'string' || typeof value.updateLastVisited !== 'boolean') return false;
  if (['itemsPurchased', 'haulPotential', 'rating'].some(key => value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key])))) return false;
  if (['stockColour', 'comments'].some(key => value[key] !== undefined && typeof value[key] !== 'string')) return false;
  return value.colourEvidence === undefined || value.colourEvidence === 'confirmed' || value.colourEvidence === 'suspected' || value.colourEvidence === 'unknown';
}
function visitRecordShape(value: unknown): value is VisitRecord {
  return object(value) && value.schema === 1 && safeId(value.id) && typeof value.path === 'string' && typeof value.sourcePath === 'string' && validDate(value.visitDate) && validTime(value.recordedAt) && validTime(value.updatedAt) && typeof value.revision === 'string' && typeof value.observations === 'string' && typeof value.finds === 'string' && typeof value.nextTime === 'string' &&
    ['itemsPurchased', 'haulPotential'].every(key => value[key] === undefined || typeof value[key] === 'number' && Number.isFinite(value[key])) && ['stockColour', 'outingPath', 'outingId', 'stopId', 'legacyOperationId'].every(key => value[key] === undefined || typeof value[key] === 'string') && (value.sourcingExample === undefined || typeof value.sourcingExample === 'boolean') && (value.colourEvidence === undefined || value.colourEvidence === 'confirmed' || value.colourEvidence === 'suspected' || value.colourEvidence === 'unknown');
}
function visitOperationShape(value: unknown): value is VisitOperation {
  return object(value) && value.schema === 1 && safeId(value.id) && (value.kind === 'create' || value.kind === 'update') && (value.stage === 'prepared' || value.stage === 'visit-written' || value.stage === 'complete' || value.stage === 'cancelled') && visitInputShape(value.input) && visitRecordShape(value.expected) && typeof value.sourceIdentity === 'string' && typeof value.sourceBeforeHash === 'string' && typeof value.inputHash === 'string' && validTime(value.recordedAt) && typeof value.sourcePath === 'string' && typeof value.visitPath === 'string' && safeId(value.visitId) && ['outingPath', 'outingId', 'stopId', 'beforeVisitHash'].every(key => value[key] === undefined || typeof value[key] === 'string') && (value.beforeValues === undefined || object(value.beforeValues));
}
function number(v: unknown, kind: 'items' | 'haul'): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (kind === 'items' ? 0 : 1) || kind === 'haul' && v > 5) throw Error(kind === 'items' ? 'Items purchased must be a nonnegative whole number, or blank for unknown.' : 'Haul potential must be a whole number from 1 to 5, or blank.');
  return v;
}
export function validateVisitInput(v: VisitInput, allowEmpty = false): VisitInput {
  if (!object(v) || ![v.observations, v.finds, v.nextTime].every(x => typeof x === 'string') || !validDate(v.visitDate)) throw Error('Use text for visit details and choose a valid visit date.');
  if ([v.observations, v.finds, v.nextTime].some(text => /^## (?:Observations|Useful finds|Next time|Notes)[ \t]*\r?$/m.test(text))) throw Error('Visit details cannot contain the reserved headings Observations, Useful finds, Next time or Notes. Use another heading name.');
  const input: VisitInput = { observations: v.observations.trim(), finds: v.finds.trim(), nextTime: v.nextTime.trim(), visitDate: v.visitDate, updateLastVisited: v.updateLastVisited === true };
  const items = number(v.itemsPurchased, 'items'), haul = number(v.haulPotential, 'haul');
  if (items !== undefined) input.itemsPurchased = items;
  if (haul !== undefined && items !== 0) input.haulPotential = haul;
  if (v.stockColour !== undefined) {
    if (typeof v.stockColour !== 'string' || v.stockColour.trim().length > 80 || /[\r\n]/.test(v.stockColour)) throw Error('Use a stock colour of up to 80 characters.');
    if (v.stockColour.trim()) input.stockColour = v.stockColour.trim();
  }
  if (v.colourEvidence !== undefined && !['confirmed', 'suspected', 'unknown'].includes(v.colourEvidence)) throw Error('Choose confirmed, suspected or unknown colour meaning.');
  if (input.stockColour) input.colourEvidence = v.colourEvidence ?? 'unknown';
  if (v.rating !== undefined) {
    if (typeof v.rating !== 'number' || !Number.isFinite(v.rating) || v.rating < 0 || v.rating > 5 || !Number.isInteger(v.rating * 2)) throw Error('Use a sourcing rating from 0 to 5 in half-star steps.');
    input.rating = v.rating;
  }
  if (v.comments !== undefined) { if (typeof v.comments !== 'string') throw Error('Use text for the sourcing takeaway.'); input.comments = v.comments; }
  if (!allowEmpty && ![input.observations, input.finds, input.nextTime, input.stockColour, input.comments].some(x => x?.trim()) && items === undefined && haul === undefined && input.rating === undefined) throw Error('Add visit details or an outcome before saving.');
  return input;
}
function bounds(body: string, label: string): { start: number; content: number; end: number } | null {
  const matches = [...body.matchAll(new RegExp('^## ' + label + '[ \\t]*\\r?\\n', 'gm'))];
  if (matches.length > 1) throw Error('The visit has duplicate ' + label + ' sections. Review the note before editing.');
  const m = matches[0]; if (!m) return null;
  const content = m.index + m[0].length, next = /^## (?:Observations|Useful finds|Next time|Notes)[ \t]*\r?$/m.exec(body.slice(content));
  return { start: m.index, content, end: next ? content + next.index : body.length };
}
function ownedText(body: string, label: string): string { const b = bounds(body, label); return b ? body.slice(b.content, b.end).trim() : ''; }
function propertiesFor(r: VisitRecord): Record<string, unknown> {
  const p: Record<string, unknown> = { visit_schema: 1, visit_id: r.id, source: wiki(r.sourcePath), visit_date: r.visitDate, recorded_at: r.recordedAt, updated_at: r.updatedAt };
  for (const [key, value] of [['items_purchased', r.itemsPurchased], ['haul_potential', r.itemsPurchased === 0 ? undefined : r.haulPotential], ['stock_colour', r.stockColour], ['colour_evidence', r.stockColour ? r.colourEvidence ?? 'unknown' : undefined], ['outing', r.outingPath ? wiki(r.outingPath) : undefined], ['outing_id', r.outingId], ['stop_id', r.stopId], ['legacy_operation_id', r.legacyOperationId]] as const) if (value !== undefined) p[key] = value;
  return p;
}
export async function readVisitRecord(raw: string, path: string): Promise<VisitRecord> {
  const { properties: p, body } = readNote(raw);
  if (!Array.isArray(p.tags) || !p.tags.includes('sourcing-visit') || p.visit_schema !== 1 || !safeId(p.visit_id) || typeof p.source !== 'string' || !linkPath(p.source) || !validDate(p.visit_date) || !validTime(p.recorded_at) || !validTime(p.updated_at)) throw Error('This visit has invalid identity, source or date properties.');
  const r: VisitRecord = { schema: 1, id: p.visit_id, path, sourcePath: linkPath(p.source), visitDate: p.visit_date, recordedAt: p.recorded_at, updatedAt: p.updated_at, observations: ownedText(body, sections[0]), finds: ownedText(body, sections[1]), nextTime: ownedText(body, sections[2]), revision: await hashText(raw) };
  const items = number(p.items_purchased, 'items'), haul = number(p.haul_potential, 'haul');
  if (items !== undefined) r.itemsPurchased = items;
  if (haul !== undefined && items !== 0) r.haulPotential = haul;
  if (p.stock_colour !== undefined && p.stock_colour !== null && p.stock_colour !== '') {
    if (typeof p.stock_colour !== 'string' || !p.stock_colour.trim() || p.stock_colour.length > 80 || /[\r\n]/.test(p.stock_colour)) throw Error('This visit has an invalid stock colour.');
    r.stockColour = p.stock_colour.trim();
    if (p.colour_evidence !== undefined && p.colour_evidence !== null && p.colour_evidence !== 'confirmed' && p.colour_evidence !== 'suspected' && p.colour_evidence !== 'unknown') throw Error('This visit has invalid colour evidence.');
    r.colourEvidence = p.colour_evidence as ColourEvidence || 'unknown';
  }
  if (p.outing) { if (typeof p.outing !== 'string') throw Error('The outing link is invalid.'); r.outingPath = linkPath(p.outing); }
  for (const [key, prop] of [['outingId', 'outing_id'], ['stopId', 'stop_id'], ['legacyOperationId', 'legacy_operation_id']] as const) if (p[prop] !== undefined && p[prop] !== null) { if (typeof p[prop] !== 'string') throw Error('A visit association is invalid.'); r[key] = p[prop]; }
  if (p.sourcing_example === true) r.sourcingExample = true;
  return r;
}
export function writeVisitRecord(r: VisitRecord): string {
  const fence = String.fromCharCode(96).repeat(3);
  const body = fence + 'charity-sourcing\nview: visit\n' + fence + '\n\n' + sections.map((label, i) => '## ' + label + '\n\n' + [r.observations, r.finds, r.nextTime][i].trim() + '\n\n').join('') + '## Notes\n\n';
  return writeNote({ tags: ['sourcing-visit'], ...propertiesFor(r), ...(r.sourcingExample ? { sourcing_example: true } : {}) }, body);
}
function editVisitRecord(raw: string, r: VisitRecord): string {
  const p = propertiesFor(r); let next = raw;
  for (const key of keys) next = updateNoteProperty(next, key, p[key] ?? null);
  const note = readNote(next), nl = next.includes('\r\n') ? '\r\n' : '\n'; let body = note.body;
  for (const [i, label] of sections.entries()) {
    const b = bounds(body, label), text = [r.observations, r.finds, r.nextTime][i].trim().replace(/\r?\n/g, nl), block = '## ' + label + nl + nl + text + nl + nl;
    if (b) body = body.slice(0, b.start) + block + body.slice(b.end);
    else { const notes = /^## Notes[ \t]*\r?\n/m.exec(body), at = notes?.index ?? body.length; body = body.slice(0, at) + block + body.slice(at); }
  }
  return next.slice(0, next.length - note.body.length) + body;
}
function ownedRecord(r: VisitRecord): string { const { revision: _revision, sourcingExample: _example, ...v } = r; return JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))); }
function inputRecord(r: VisitRecord, input: VisitInput, updatedAt: string): VisitRecord {
  const next = { ...r, updatedAt, observations: input.observations, finds: input.finds, nextTime: input.nextTime, visitDate: input.visitDate, revision: '' };
  for (const key of ['itemsPurchased', 'haulPotential', 'stockColour', 'colourEvidence'] as const) { delete next[key]; if (input[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = input[key]; }
  return next;
}
/** Journalled multi-file saves share the notebook's existing serial lane. */
export class VisitStore {
  constructor(private host: VisitHost) {}
  private owns(path: string, folder: string): boolean { return path.startsWith(this.host.root() + '/' + folder + '/') && !path.includes('\\') && !hasControlCharacters(path, false) && !path.split('/').some(p => !p || p === '.' || p === '..'); }
  private ownsSource(path: string): boolean { return this.owns(path, 'Places') || this.owns(path, 'Sources') || this.owns(path, 'Shops'); }
  private file(path: string, folder: string): TFile {
    if (!this.owns(path, folder)) throw Error('Choose a visit in this notebook.');
    const f = this.host.app.vault.getAbstractFileByPath(path); if (!fileLike(f)) throw Error('The visit or operation no longer exists.'); return f;
  }
  private async source(path: string): Promise<{ place: PlaceRecord; file: TFile; raw: string; identity: string }> {
    const place = (await this.host.listPlaces()).find(p => p.path === path && p.kind === 'shop');
    if (!place) throw Error('Choose a source in this notebook. Restore a missing source before saving its visit.');
    const file = this.host.app.vault.getAbstractFileByPath(path); if (!fileLike(file)) throw Error('The source note no longer exists.');
    const raw = await this.host.app.vault.read(file), p = readNote(raw).properties;
    if (!this.host.examples && p.sourcing_example === true) throw Error('Fictional visits belong in Examples.');
    return { place, file, raw, identity: propertyText(p.source_capture_id) };
  }
  async inspect(): Promise<VisitInspection> {
    const visits: VisitRecord[] = [], warnings: string[] = [], sources = new Set((await this.host.listPlaces()).filter(p => p.kind === 'shop').map(p => p.path));
    for (const f of notebookFiles(this.host.app.vault, this.host.root() + '/Visits').filter(f => this.owns(f.path, 'Visits'))) {
      try {
        const raw = await this.host.app.vault.read(f), p = readNote(raw).properties;
        if (!this.host.examples && p.sourcing_example === true) continue;
        const v = await readVisitRecord(raw, f.path);
        if (!sources.has(v.sourcePath)) { warnings.push('Visit source is missing or outside this notebook: ' + f.path); continue; }
        if (v.outingPath && !this.owns(v.outingPath, 'Outings')) { warnings.push('Visit outing is outside this notebook: ' + f.path); continue; }
        visits.push(v);
      } catch (e) { warnings.push(f.path + ': ' + String(e instanceof Error ? e.message : e)); }
    }
    const duplicate = new Set(visits.filter((v, i) => visits.some((w, j) => j !== i && w.id === v.id)).map(v => v.id));
    for (const id of duplicate) warnings.push('Duplicate visit identifier ' + id + ': conflicting notes are excluded until reviewed.');
    warnings.push(...(await this.operationsWithWarnings()).warnings);
    return { visits: visits.filter(v => !duplicate.has(v.id)).sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id)), warnings };
  }
  async list(sourcePath?: string): Promise<VisitRecord[]> { return (await this.inspect()).visits.filter(v => !sourcePath || v.sourcePath === sourcePath); }
  async get(path: string): Promise<VisitRecord> {
    const r = await readVisitRecord(await this.host.app.vault.read(this.file(path, 'Visits')), path);
    if (!this.host.examples && r.sourcingExample) throw Error('Fictional visits belong in Examples.');
    await this.source(r.sourcePath);
    let copies = 0;
    for (const f of notebookFiles(this.host.app.vault, this.host.root() + '/Visits').filter(f => this.owns(f.path, 'Visits'))) {
      try {
        const properties = readNote(await this.host.app.vault.read(f)).properties;
        if (!this.host.examples && properties.sourcing_example === true) continue;
        if (properties.visit_id === r.id) copies++;
      } catch { /* Invalid unrelated notes are surfaced by inspect, not edited here. */ }
    }
    if (copies > 1) throw Error('Duplicate visit identifier. Resolve the conflicting notes before editing.');
    if (r.outingPath && !this.owns(r.outingPath, 'Outings')) throw Error('This visit points to an outing outside this notebook.');
    return r;
  }
  private operationPath(id: string): string { if (!safeId(id)) throw Error('The visit operation identifier is invalid.'); return this.host.root() + '/System/Visit operations/' + id + '.json'; }
  private encodeOperation(op: VisitOperation): string {
    const v = structuredClone(op);
    v.sourcePath = wiki(v.sourcePath); v.visitPath = wiki(v.visitPath); v.expected.path = wiki(v.expected.path); v.expected.sourcePath = wiki(v.expected.sourcePath);
    if (v.outingPath) v.outingPath = wiki(v.outingPath);
    if (v.expected.outingPath) v.expected.outingPath = wiki(v.expected.outingPath);
    return JSON.stringify(v, null, 2) + '\n';
  }
  private parseOperation(raw: string): VisitOperation {
    const v: unknown = JSON.parse(raw);
    if (!visitOperationShape(v)) throw Error('The saved visit operation has invalid content or dates.');
    v.sourcePath = linkPath(v.sourcePath); v.visitPath = linkPath(v.visitPath); v.expected.path = linkPath(v.expected.path); v.expected.sourcePath = linkPath(v.expected.sourcePath);
    if (v.outingPath) v.outingPath = linkPath(v.outingPath);
    if (v.expected.outingPath) v.expected.outingPath = linkPath(v.expected.outingPath);
    if ((v.stage !== 'complete' && v.stage !== 'cancelled') && (!this.owns(v.visitPath, 'Visits') || !this.ownsSource(v.sourcePath) || !safeId(v.visitId) || v.expected.id !== v.visitId || v.expected.path !== v.visitPath || v.expected.sourcePath !== v.sourcePath || v.outingPath && !this.owns(v.outingPath, 'Outings'))) throw Error('The saved visit operation points outside this notebook.');
    return v;
  }
  private async verifyOperation(op: VisitOperation): Promise<void> {
    if (op.stage === 'complete' || op.stage === 'cancelled') return;
    const input = validateVisitInput(op.input);
    if (!!op.expected.sourcingExample !== !!this.host.examples) throw Error('The saved visit operation belongs to another notebook context.');
    if (await hashText(JSON.stringify(input)) !== op.inputHash) throw Error('The saved visit input fingerprint changed. Preserve the journal for review.');
    if (op.expected.updatedAt !== op.recordedAt || op.kind === 'create' && op.expected.recordedAt !== op.recordedAt || op.expected.outingId !== op.outingId || op.expected.stopId !== op.stopId || op.expected.outingPath !== op.outingPath) throw Error('The saved visit operation metadata conflicts with its target.');
    const parsed = await readVisitRecord(writeVisitRecord(op.expected), op.visitPath);
    if (ownedRecord(parsed) !== ownedRecord(op.expected) || ownedRecord(inputRecord(op.expected, input, op.recordedAt)) !== ownedRecord(op.expected)) throw Error('The saved visit content conflicts with its original input.');
    for (const key of Object.keys(this.sourcePatch(input))) if (!op.beforeValues || !Object.hasOwn(op.beforeValues, key)) throw Error('The source comparison values are missing from the saved operation.');
  }
  private async operation(id: string): Promise<{ op: VisitOperation; raw: string; file: TFile }> {
    const file = this.file(this.operationPath(id), 'System/Visit operations'), raw = await this.host.app.vault.read(file), op = this.parseOperation(raw);
    if (op.id !== id) throw Error('The visit operation identity changed.'); return { op, raw, file };
  }
  private async writeOperation(op: VisitOperation, expected: string): Promise<void> {
    await this.host.app.vault.process(this.file(this.operationPath(op.id), 'System/Visit operations'), current => { if (current !== expected) throw Error('The saved visit operation changed. Review recovery before continuing.'); return this.encodeOperation(op); });
  }
  private async operationsWithWarnings(): Promise<{ operations: VisitOperation[]; warnings: string[] }> {
    const operations: VisitOperation[] = [], warnings: string[] = [];
    for (const f of notebookFiles(this.host.app.vault, this.host.root()).filter(f => this.owns(f.path, 'System/Visit operations') && f.extension === 'json')) {
      try { const op = this.parseOperation(await this.host.app.vault.read(f)); if (f.path !== this.operationPath(op.id)) throw Error('Operation filename and identity differ.'); await this.verifyOperation(op); operations.push(op); }
      catch (e) { warnings.push(f.path + ': ' + String(e instanceof Error ? e.message : e)); }
    }
    return { operations, warnings };
  }
  async pendingOperations(): Promise<VisitOperation[]> { const result = await this.operationsWithWarnings(); if (result.warnings.length) throw Error(result.warnings.join('\n')); return result.operations.filter(op => op.stage !== 'complete' && op.stage !== 'cancelled'); }
  async create(sourcePath: string, input: VisitInput, options: VisitSaveOptions = {}): Promise<VisitRecord> { return this.host.exclusive(() => this.createNow(sourcePath, input, options)); }
  /** Internal: caller already holds the shared serial lane. */
  async createNow(sourcePath: string, value: VisitInput, options: VisitSaveOptions = {}): Promise<VisitRecord> {
    const input = validateVisitInput(value), source = await this.source(sourcePath), id = options.operationId ?? crypto.randomUUID(), opPath = this.operationPath(id), inputHash = await hashText(JSON.stringify(input));
    if (this.host.app.vault.getAbstractFileByPath(opPath)) {
      const { op } = await this.operation(id);
      if (op.kind !== 'create' || op.sourcePath !== sourcePath || op.inputHash !== inputHash || (op.outingId ?? '') !== (options.outingId ?? '') || (op.stopId ?? '') !== (options.stopId ?? '')) throw Error('This visit identifier has conflicting saved details.');
      return this.runNow(id);
    }
    if (options.outingPath && !this.owns(options.outingPath, 'Outings')) throw Error('Choose an outing in this notebook.');
    const recordedAt = options.recordedAt ?? new Date().toISOString(); if (!validTime(recordedAt)) throw Error('The visit recording time is invalid.');
    const visitPath = this.host.root() + '/Visits/' + input.visitDate.slice(0, 4) + '/' + input.visitDate.slice(5, 7) + '/' + input.visitDate + ' - ' + safeFileName(source.place.name).slice(0, 60) + ' - ' + id + '.md';
    if (this.host.app.vault.getAbstractFileByPath(visitPath)) throw Error('The visit filename is occupied; nothing was overwritten.');
    const seed: VisitRecord = { schema: 1, id, path: visitPath, sourcePath, visitDate: input.visitDate, recordedAt, updatedAt: recordedAt, observations: '', finds: '', nextTime: '', revision: '',
      ...(this.host.examples ? { sourcingExample: true } : {}), ...(options.outingPath ? { outingPath: options.outingPath } : {}), ...(options.outingId ? { outingId: options.outingId } : {}), ...(options.stopId ? { stopId: options.stopId } : {}), ...(options.legacyOperationId ? { legacyOperationId: options.legacyOperationId } : {}) };
    const expected = inputRecord(seed, input, recordedAt);
    const op: VisitOperation = { schema: 1, kind: 'create', id, stage: 'prepared', sourcePath, sourceIdentity: source.identity, sourceBeforeHash: await hashText(source.raw), input, inputHash, recordedAt, visitPath, visitId: id, expected, beforeValues: this.sourceBeforeValues(source.raw, input),
      ...(options.outingPath ? { outingPath: options.outingPath } : {}), ...(options.outingId ? { outingId: options.outingId } : {}), ...(options.stopId ? { stopId: options.stopId } : {}) };
    if (options.draftRevision !== undefined) await this.assertDraftRevisionNow(sourcePath, undefined, options.draftRevision);
    await this.ensureNoPending(sourcePath, id); await this.host.folder(this.host.root() + '/System/Visit operations'); await this.host.app.vault.create(opPath, this.encodeOperation(op));
    return this.runNow(id);
  }
  async update(path: string, input: VisitInput, revision: string, options: VisitSaveOptions = {}): Promise<VisitRecord> { return this.host.exclusive(() => this.updateNow(path, input, revision, options)); }
  async updateNow(path: string, value: VisitInput, revision: string, options: VisitSaveOptions = {}): Promise<VisitRecord> {
    const input = validateVisitInput(value), record = await this.get(path), id = options.operationId ?? crypto.randomUUID(), inputHash = await hashText(JSON.stringify(input));
    if (this.host.app.vault.getAbstractFileByPath(this.operationPath(id))) {
      const { op } = await this.operation(id);
      if (op.kind !== 'update' || op.visitPath !== path || op.inputHash !== inputHash) throw Error('This visit identifier has conflicting saved details.');
      return this.runNow(id);
    }
    if (!revision || revision !== record.revision) throw Error('The visit changed. Reopen it before saving; personal text has been kept.');
    const source = await this.source(record.sourcePath), recordedAt = options.recordedAt ?? new Date().toISOString();
    if (!validTime(recordedAt)) throw Error('The visit recording time is invalid.');
    const op: VisitOperation = { schema: 1, kind: 'update', id, stage: 'prepared', sourcePath: record.sourcePath, sourceIdentity: source.identity, sourceBeforeHash: await hashText(source.raw), input, inputHash, recordedAt,
      visitPath: path, visitId: record.id, beforeVisitHash: record.revision, expected: inputRecord(record, input, recordedAt), beforeValues: this.sourceBeforeValues(source.raw, input),
      ...(record.outingPath ? { outingPath: record.outingPath } : {}), ...(record.outingId ? { outingId: record.outingId } : {}), ...(record.stopId ? { stopId: record.stopId } : {}) };
    if (options.draftRevision !== undefined) await this.assertDraftRevisionNow(record.sourcePath, path, options.draftRevision);
    await this.ensureNoPending(record.sourcePath, id); await this.host.folder(this.host.root() + '/System/Visit operations'); await this.host.app.vault.create(this.operationPath(id), this.encodeOperation(op));
    return this.runNow(id);
  }
  private sourcePatch(input: VisitInput): Record<string, unknown> { return { ...(input.updateLastVisited ? { last_visited: input.visitDate } : {}), ...(input.rating !== undefined ? { rating: input.rating } : {}), ...(input.comments !== undefined ? { comments: input.comments } : {}) }; }
  private sourceBeforeValues(raw: string, input: VisitInput): Record<string, unknown> { const p = readNote(raw).properties; return Object.fromEntries(Object.keys(this.sourcePatch(input)).map(key => [key, p[key] ?? null])); }
  private async ensureNoPending(sourcePath: string, operationId?: string): Promise<void> {
    if (await this.host.sourceBlocked?.(sourcePath, operationId)) throw Error('Finish the unfinished outing visit save for this source first.');
    const found = await this.operationsWithWarnings();
    if (found.warnings.length) throw Error('Review the invalid visit operation before saving another visit.');
    if (found.operations.some(op => op.sourcePath === sourcePath && op.stage !== 'complete' && op.stage !== 'cancelled')) throw Error('Finish the saved visit operation for this source before changing its details.');
  }
  async assertSourceAvailableNow(sourcePath: string, operationId?: string): Promise<void> { await this.ensureNoPending(sourcePath, operationId); }
  async resumeOperation(id: string): Promise<VisitRecord> { return this.host.exclusive(() => this.runNow(id)); }
  async resumeOperationNow(id: string, input?: VisitInput): Promise<VisitRecord> {
    if (input && (await this.operation(id)).op.inputHash !== await hashText(JSON.stringify(validateVisitInput(input)))) throw Error('This visit identifier has conflicting saved details.');
    return this.runNow(id);
  }
  private async runNow(id: string): Promise<VisitRecord> {
    let { op, raw: journalRaw } = await this.operation(id);
    if (op.stage === 'cancelled') throw Error('This visit operation was cancelled. Start another visit.');
    await this.verifyOperation(op);
    const source = await this.source(op.sourcePath);
    if (source.identity !== op.sourceIdentity) throw Error('The source note was replaced. Review the saved visit operation before continuing.');
    if (op.stage === 'complete') return this.get(op.visitPath);
    const visitFile = this.host.app.vault.getAbstractFileByPath(op.visitPath);
    if (!visitFile) {
      if (op.kind !== 'create' || op.stage !== 'prepared') throw Error('The saved visit was removed. It will not be recreated automatically.');
      await this.host.folder(op.visitPath.slice(0, op.visitPath.lastIndexOf('/')));
      await this.host.app.vault.create(op.visitPath, writeVisitRecord(op.expected));
    } else {
      if (!fileLike(visitFile)) throw Error('A folder occupies the visit filename.');
      const current = await this.host.app.vault.read(visitFile), existing = await readVisitRecord(current, op.visitPath);
      if (op.kind === 'update' && await hashText(current) === op.beforeVisitHash && op.stage === 'prepared') {
        const next = editVisitRecord(current, op.expected);
        await this.host.app.vault.process(visitFile, raw => { if (raw !== current) throw Error('The visit changed before saving. Its personal text is retained.'); return next; });
      } else if (ownedRecord(existing) !== ownedRecord(op.expected)) throw Error('The visit note has conflicting saved details. Preserve it and review the operation.');
    }
    if (op.stage === 'prepared') { op.stage = 'visit-written'; await this.writeOperation(op, journalRaw); journalRaw = this.encodeOperation(op); }
    const patch = this.sourcePatch(op.input);
    if (Object.keys(patch).length) {
      const current = await this.host.app.vault.read(source.file), p = readNote(current).properties;
      if (propertyText(p.source_capture_id) !== op.sourceIdentity) throw Error('The source was replaced before updating its assessment.');
      if (p.sourcing_visit_receipts !== undefined && !Array.isArray(p.sourcing_visit_receipts)) throw Error('Review the invalid source visit receipts before continuing.');
      const receipts = isUnknownArray(p.sourcing_visit_receipts) ? p.sourcing_visit_receipts : [], receipt = receipts.find(v => object(v) && v.id === op.id);
      if (receipt) {
        if (!object(receipt) || receipt.kind !== 'linked-visit' || receipt.inputHash !== op.inputHash || receipt.visitId !== op.visitId) throw Error('This visit has a conflicting source receipt.');
      } else {
        for (const key of Object.keys(patch)) if (!same(p[key], op.beforeValues?.[key])) throw Error('The source assessment changed during the visit save. The visit is retained; review recovery before retrying.');
        await this.host.app.vault.process(source.file, raw => {
          const latest = readNote(raw).properties;
          if (propertyText(latest.source_capture_id) !== op.sourceIdentity) throw Error('The source was replaced before saving.');
          for (const key of Object.keys(patch)) if (!same(latest[key], op.beforeValues?.[key])) throw Error('The source assessment changed before saving. The visit is retained.');
          if (latest.sourcing_visit_receipts !== undefined && !Array.isArray(latest.sourcing_visit_receipts)) throw Error('The source visit receipts changed. Review recovery.');
          const latestReceipts = isUnknownArray(latest.sourcing_visit_receipts) ? latest.sourcing_visit_receipts : [];
          if (latestReceipts.some(v => object(v) && v.id === op.id)) throw Error('The visit receipt changed while saving. Retry recovery.');
          let next = raw; for (const [key, value] of Object.entries(patch)) next = updateNoteProperty(next, key, value);
          return updateNoteProperty(next, 'sourcing_visit_receipts', [...latestReceipts, { id: op.id, kind: 'linked-visit', visitId: op.visitId, visitPath: wiki(op.visitPath), inputHash: op.inputHash, recordedAt: op.recordedAt, ...(op.outingId ? { outingId: op.outingId, stopId: op.stopId } : {}) }]);
        });
      }
    }
    op.stage = 'complete'; await this.writeOperation(op, journalRaw); return this.get(op.visitPath);
  }
  async cancelOperation(id: string): Promise<void> { return this.host.exclusive(() => this.cancelOperationNow(id)); }
  async cancelOperationNow(id: string): Promise<void> {
    const { op, raw } = await this.operation(id);
    await this.verifyOperation(op);
    if (op.stage === 'cancelled') return;
    if (op.stage === 'complete' || op.stage === 'visit-written') throw Error('This visit is already saved. Finish the remaining work instead of cancelling.');
    const existing = this.host.app.vault.getAbstractFileByPath(op.visitPath);
    if (existing && (op.kind === 'create' || !fileLike(existing) || await hashText(await this.host.app.vault.read(existing)) !== op.beforeVisitHash)) throw Error('The visit may already be saved. Finish recovery instead of cancelling.');
    op.stage = 'cancelled'; await this.writeOperation(op, raw);
  }
  private async drafts(): Promise<{ file: TFile; raw: string; value: { sourcePath: string; sourceIdentity: string; visitPath?: string; input: VisitInput; cleared?: boolean; visitRevision?: string } }[]> {
    const values: { file: TFile; raw: string; value: { sourcePath: string; sourceIdentity: string; visitPath?: string; input: VisitInput; cleared?: boolean; visitRevision?: string } }[] = [];
    for (const f of notebookFiles(this.host.app.vault, this.host.root()).filter(f => this.owns(f.path, 'System/Visit drafts') && f.extension === 'json')) {
      const raw = await this.host.app.vault.read(f), v: unknown = JSON.parse(raw);
      if (!object(v) || v.schema !== 1 || typeof v.sourcePath !== 'string' || typeof v.sourceIdentity !== 'string' || !visitInputShape(v.input) || v.visitPath !== undefined && typeof v.visitPath !== 'string' || v.visitRevision !== undefined && typeof v.visitRevision !== 'string' || v.cleared !== undefined && typeof v.cleared !== 'boolean') throw Error('Review the invalid standalone visit draft before continuing.');
      const sourcePath = linkPath(v.sourcePath), visitPath = v.visitPath ? linkPath(v.visitPath) : undefined;
      if (!this.ownsSource(sourcePath) || visitPath && !this.owns(visitPath, 'Visits')) throw Error('A visit draft points outside this notebook.');
      values.push({ file: f, raw, value: { sourcePath, sourceIdentity: v.sourceIdentity, input: v.input, ...(visitPath ? { visitPath } : {}), ...(v.visitRevision ? { visitRevision: v.visitRevision } : {}), ...(typeof v.cleared === 'boolean' ? { cleared: v.cleared } : {}) } });
    }
    return values;
  }
  /**
   * Inspect saved work without repairing it or opening a mutation lane.
   * Invalid files are reported individually so another saved draft remains usable.
   */
  async inspectSavedWork(): Promise<VisitSavedWorkInspection> {
    const result: VisitSavedWorkInspection = { drafts: [], operations: [], warnings: [] };
    const warn = (path: string, e: unknown) => result.warnings.push({ path, message: e instanceof Error ? e.message : String(e) });
    for (const f of notebookFiles(this.host.app.vault, this.host.root()).filter(f => this.owns(f.path, 'System/Visit drafts') && f.extension === 'json')) {
      try {
        const raw = await this.host.app.vault.read(f), value: unknown = JSON.parse(raw);
        if (!object(value) || value.schema !== 1 || typeof value.sourcePath !== 'string' || typeof value.sourceIdentity !== 'string' || !object(value.input)) throw Error('This saved visit draft has invalid properties.');
        if (value.cleared === true) continue;
        if (value.cleared !== undefined && value.cleared !== false) throw Error('This visit draft has an invalid cleared state.');
        const sourcePath = linkPath(value.sourcePath);
        if (!this.ownsSource(sourcePath)) throw Error('This visit draft points outside this notebook.');
        const source = await this.source(sourcePath);
        if (!!source.place.properties.sourcing_example !== !!this.host.examples) throw Error('This visit draft belongs to another notebook context.');
        if (value.sourceIdentity !== source.identity) throw Error('The source identity changed after this draft was saved.');
        // Drafts can contain incomplete dates or values which the user still needs to correct.
        // Require the same portable value shapes accepted by saveDraft, not save-time completeness.
        const input = value.input;
        if (![input.observations, input.finds, input.nextTime, input.visitDate].every(v => typeof v === 'string') ||
            [input.itemsPurchased, input.haulPotential].some(v => v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) ||
            input.stockColour !== undefined && typeof input.stockColour !== 'string' ||
            input.comments !== undefined && typeof input.comments !== 'string' ||
            input.rating !== undefined && (typeof input.rating !== 'number' || !Number.isFinite(input.rating)) ||
            input.colourEvidence !== undefined && input.colourEvidence !== 'confirmed' && input.colourEvidence !== 'suspected' && input.colourEvidence !== 'unknown') throw Error('This visit draft contains unsupported values.');
        if (!validTime(value.updatedAt)) throw Error('This visit draft has no valid saved date.');
        let visitPath: string | undefined, visitRevision: string | undefined;
        if (value.visitPath !== undefined) {
          if (typeof value.visitPath !== 'string') throw Error('This visit draft has an invalid visit link.');
          visitPath = linkPath(value.visitPath);
          if (!this.owns(visitPath, 'Visits')) throw Error('This visit draft points outside this notebook.');
          const visit = await this.get(visitPath);
          if (visit.sourcePath !== sourcePath) throw Error('This draft belongs to another source.');
          if (typeof value.visitRevision !== 'string' || value.visitRevision !== visit.revision) throw Error('The saved visit changed after this draft was reviewed. Review the draft and visit before continuing.');
          visitRevision = value.visitRevision;
        } else if (value.visitRevision !== undefined) throw Error('This draft has a visit comparison without a visit link.');
        result.drafts.push({ path: f.path, sourcePath, sourceName: source.place.name, updatedAt: value.updatedAt, revision: await hashText(raw), ...(visitPath ? { visitPath, visitRevision } : {}) });
      } catch (e) { warn(f.path, e); }
    }
    const duplicates = new Set(result.drafts.filter((draft, index, all) => all.some((other, at) => at !== index && other.sourcePath === draft.sourcePath && (other.visitPath ?? '') === (draft.visitPath ?? ''))).map(draft => draft.path));
    for (const path of duplicates) warn(path, Error('More than one draft exists for this visit. Review the saved drafts before continuing.'));
    result.drafts = result.drafts.filter(draft => !duplicates.has(draft.path)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.path.localeCompare(b.path));
    for (const f of notebookFiles(this.host.app.vault, this.host.root()).filter(f => this.owns(f.path, 'System/Visit operations') && f.extension === 'json')) {
      try {
        const raw = await this.host.app.vault.read(f), op = this.parseOperation(raw);
        if (f.path !== this.operationPath(op.id)) throw Error('Operation filename and identity differ.');
        await this.verifyOperation(op);
        if (op.stage === 'complete' || op.stage === 'cancelled') continue;
        const source = await this.source(op.sourcePath);
        if (!!source.place.properties.sourcing_example !== !!this.host.examples || source.identity !== op.sourceIdentity) throw Error('The source identity or notebook context changed after this visit save.');
        const visitFile = this.host.app.vault.getAbstractFileByPath(op.visitPath);
        if (visitFile) {
          if (!fileLike(visitFile)) throw Error('A folder occupies the saved visit filename.');
          const current = await this.host.app.vault.read(visitFile), visit = await readVisitRecord(current, op.visitPath);
          const isOriginalUpdate = op.kind === 'update' && op.stage === 'prepared' && await hashText(current) === op.beforeVisitHash;
          if (!isOriginalUpdate && ownedRecord(visit) !== ownedRecord(op.expected)) throw Error('The visit note conflicts with this saved operation. Review both before continuing.');
        } else if (op.kind !== 'create' || op.stage !== 'prepared') throw Error('The saved visit was removed. It will not be recreated automatically.');
        result.operations.push(structuredClone(op));
      } catch (e) { warn(f.path, e); }
    }
    result.operations.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id));
    return result;
  }
  private async assertDraftRevisionNow(sourcePath: string, visitPath: string | undefined, expected: string): Promise<void> {
    const state = await this.getDraftState(sourcePath, visitPath);
    if (typeof expected !== 'string' || (state?.revision ?? '') !== expected) throw Error('The visit draft changed in another pane before saving. Your form and the other draft were kept.');
  }
  async getDraftState(sourcePath: string, visitPath?: string): Promise<VisitDraftState | undefined> {
    const source = await this.source(sourcePath), found = (await this.drafts()).filter(({ value: v }) => v.sourcePath === sourcePath && (v.visitPath ?? '') === (visitPath ?? ''));
    if (found.length > 1) throw Error('More than one draft exists for this visit. Review them before continuing.');
    const entry = found[0]; if (!entry) return undefined;
    if (!entry.value.cleared && entry.value.sourceIdentity !== source.identity) throw Error('The source identity changed after this draft was saved.');
    return { input: structuredClone(entry.value.input), revision: await hashText(entry.raw), ...(entry.value.visitRevision ? { visitRevision: entry.value.visitRevision } : {}), ...(entry.value.cleared ? { cleared: true } : {}) };
  }
  async getDraft(sourcePath: string, visitPath?: string): Promise<VisitInput | undefined> {
    const state = await this.getDraftState(sourcePath, visitPath); return state && !state.cleared ? state.input : undefined;
  }
  async saveDraft(sourcePath: string, input: VisitInput, visitPath?: string, expectedDraftRevision = '', visitRevision?: string): Promise<string> {
    return this.host.exclusive(async () => {
      const source = await this.source(sourcePath); if (visitPath && (await this.get(visitPath)).sourcePath !== sourcePath) throw Error('This draft belongs to another source.');
      if (!object(input) || ![input.observations, input.finds, input.nextTime, input.visitDate].every(v => typeof v === 'string') || [input.itemsPurchased, input.haulPotential].some(v => v !== undefined && (typeof v !== 'number' || !Number.isFinite(v)))) throw Error('The visit draft contains unsupported values.');
      if (visitRevision !== undefined && !/^[a-f0-9]{64}$/.test(visitRevision)) throw Error('The visit draft has no valid reviewed visit revision.');
      const drafts = (await this.drafts()).filter(({ value: v }) => v.sourcePath === sourcePath && (v.visitPath ?? '') === (visitPath ?? ''));
      if (drafts.length > 1) throw Error('More than one draft exists for this visit.');
      const old = drafts[0];
      if (old ? !expectedDraftRevision || await hashText(old.raw) !== expectedDraftRevision : !!expectedDraftRevision) throw Error('The visit draft changed in another pane. Your form has been kept; reopen or review the saved draft before continuing.');
      if (old && !old.value.cleared && old.value.sourceIdentity !== source.identity) throw Error('The source was replaced after its visit draft was saved.');
      if (old && !old.value.cleared && old.value.visitRevision !== visitRevision) throw Error('Keep the original reviewed visit revision with this draft. Reopen its details before rebasing.');
      const next = JSON.stringify({ schema: 1, sourcePath: wiki(sourcePath), sourceIdentity: source.identity, ...(visitPath ? { visitPath: wiki(visitPath) } : {}), ...(visitRevision ? { visitRevision } : {}), input: structuredClone(input), updatedAt: new Date().toISOString(), cleared: false }, null, 2) + '\n';
      if (old) await this.host.app.vault.process(old.file, current => { if (current !== old.raw) throw Error('The visit draft changed elsewhere.'); return next; });
      else { await this.host.folder(this.host.root() + '/System/Visit drafts'); await this.host.app.vault.create(this.host.root() + '/System/Visit drafts/' + crypto.randomUUID() + '.json', next); }
      return hashText(next);
    });
  }
  async clearDraft(sourcePath: string, visitPath?: string, expectedDraftRevision = ''): Promise<void> {
    return this.host.exclusive(async () => {
      await this.source(sourcePath);
      const drafts = (await this.drafts()).filter(({ value: v }) => v.sourcePath === sourcePath && (v.visitPath ?? '') === (visitPath ?? ''));
      if (drafts.length > 1) throw Error('More than one draft exists for this visit.');
      const draft = drafts[0];
      if (!draft) { if (expectedDraftRevision) throw Error('The saved visit draft was removed or changed.'); return; }
      if (!expectedDraftRevision || await hashText(draft.raw) !== expectedDraftRevision) throw Error('The visit draft changed in another pane. Its saved text was kept.');
      const v: unknown = JSON.parse(draft.raw); if (!object(v)) throw Error('The saved visit draft is invalid.'); v.cleared = true;
      await this.host.app.vault.process(draft.file, current => { if (current !== draft.raw) throw Error('The visit draft changed before clearing.'); return JSON.stringify(v, null, 2) + '\n'; });
    });
  }
}
