import type { App, TFile } from 'obsidian';
import type { PreparationDraft, PlacePreparation, OutingPreparation } from './types';
import { hashText, linkPath, wiki } from '../storage/markdown';
import { NotebookPaths } from '../storage/paths';
import { hasControlCharacters, isRecord, isUnknownArray } from '../domain/guards';
import { validateCoordinates } from '../domain/coordinates';
import { validatePlanningOptions } from '../outings/planning';
import { notebookFiles } from '../storage/files';
import { isPlaceEditPreparation, placeEditReceiptFor, type PlaceEditPreparation } from '../place-edit/model';
import { readNote } from '../storage/markdown';
import { serialisePlaceQuery } from './place-query';
import { isShortTripOptions } from '../outings/short-trip';
interface Host { app: App; root(): string; exclusive<T>(run: () => Promise<T>): Promise<T>; folder(path: string): Promise<void>; }
const fileLike = (v: unknown): v is TFile => !!v && typeof v === 'object' && 'extension' in v;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(id);
const member = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value);
function queryData(value: unknown, inside: (path: unknown) => path is string): boolean {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.area !== 'string' || value.area && value.area !== 'unassigned' && !inside(value.area) || !member(value.kind, ['all', 'shop', 'parking']) || typeof value.sourceType !== 'string' || !member(value.rating, ['any', 'unrated', 'minimum']) || typeof value.minimumRating !== 'number' || value.minimumRating < .5 || value.minimumRating > 5 || !Number.isInteger(value.minimumRating * 2) || typeof value.shortlist !== 'boolean' || !member(value.status, ['active', 'closed', 'all']) || !member(value.visits, ['any', 'with', 'without']) || !member(value.location, ['any', 'present', 'missing'])) return false;
  if (value.nearby === undefined) return true;
  if (!isRecord(value.nearby) || typeof value.nearby.radiusKm !== 'number' || !Number.isFinite(value.nearby.radiusKm) || value.nearby.radiusKm <= 0 || !isRecord(value.nearby.reference)) return false;
  const reference = value.nearby.reference;
  if (reference.label !== undefined && typeof reference.label !== 'string') return false;
  return reference.kind === 'place' ? inside(reference.path) : reference.kind === 'point' ? !!validateCoordinates(reference.coordinates) : reference.kind === 'unavailable';
}
function outingData(value: unknown, inside: (path: unknown) => path is string): value is OutingPreparation {
  if (!isRecord(value) || typeof value.name !== 'string' || !isUnknownArray(value.groups) || value.step !== 1 && value.step !== 2 && value.step !== 3 || !isUnknownArray(value.unresolved) || !value.unresolved.every(inside) || !isRecord(value.filter) || typeof value.filter.text !== 'string' || typeof value.filter.area !== 'string' || value.filter.area && value.filter.area !== 'unassigned' && !inside(value.filter.area) || typeof value.filter.shortlist !== 'boolean' || typeof value.filter.type !== 'string' || value.filter.view !== 'list' && value.filter.view !== 'map') return false;
  for (const group of value.groups) {
    if (!isRecord(group) || typeof group.id !== 'string' || typeof group.parkingPath !== 'string' || group.parkingPath && !inside(group.parkingPath) || !isUnknownArray(group.stops)) return false;
    for (const stop of group.stops) if (!isRecord(stop) || typeof stop.id !== 'string' || !inside(stop.sourcePath) || stop.status !== 'pending' && stop.status !== 'visited' && stop.status !== 'skipped') return false;
  }
  if (value.existingPath !== undefined && !inside(value.existingPath) || value.existingRevision !== undefined && typeof value.existingRevision !== 'string' || value.startAfterSave !== undefined && typeof value.startAfterSave !== 'boolean') return false;
  if (value.planning !== undefined) validatePlanningOptions(value.planning);
  if (value.reviewWarnings !== undefined && (!isUnknownArray(value.reviewWarnings) || value.reviewWarnings.length > 100 || !value.reviewWarnings.every(v => typeof v === 'string' && v.length <= 2000))) return false;
  if (value.shortTrip !== undefined) {
    const shortTrip = value.shortTrip;
    if (!isShortTripOptions(shortTrip) || shortTrip.areaPath && shortTrip.areaPath !== 'unassigned' && !inside(shortTrip.areaPath)) return false;
    if (shortTrip.form?.savedPath && !inside(shortTrip.form.savedPath)) return false;
    for (const anchor of [shortTrip.planning.start, shortTrip.planning.end]) if (anchor?.kind === 'record' && !inside(anchor.path)) return false;
  }
  if (value.placeQuery !== undefined && !queryData(value.placeQuery, inside)) return false;
  if (value.placeSort !== undefined && (!isRecord(value.placeSort) || !member(value.placeSort.key, ['name', 'area', 'type', 'rating', 'lastVisited', 'shortlist', 'distance']) || value.placeSort.direction !== 'asc' && value.placeSort.direction !== 'desc')) return false;
  return true;
}
function placeData(value: unknown, inside: (path: unknown) => path is string): value is PlacePreparation {
  if (!isRecord(value) || !isRecord(value.capture) || !isRecord(value.area) || typeof value.area.town !== 'string' || typeof value.area.locality !== 'string' || typeof value.filename !== 'string' || value.step !== 1 && value.step !== 2 || value.linkedSource !== undefined && !inside(value.linkedSource)) return false;
  const c = value.capture;
  if (c.kind !== 'shop' && c.kind !== 'parking' || !['name', 'address', 'url', 'captureId', 'capturedAt', 'street', 'postcode', 'brandTag'].every(key => typeof c[key] === 'string') || !isUnknownArray(c.topics) || !c.topics.every(v => typeof v === 'string') || !isUnknownArray(c.hours) || !c.hours.every(v => typeof v === 'string') || c.coordinates !== null && !validateCoordinates(c.coordinates) || c.googleRating !== null && (typeof c.googleRating !== 'number' || !Number.isFinite(c.googleRating)) || c.googleReviewCount !== null && (typeof c.googleReviewCount !== 'number' || !Number.isFinite(c.googleReviewCount))) return false;
  if (['sourcePath', 'sourceRevision', 'sourceType', 'website', 'telephone', 'coordinateIssue'].some(key => c[key] !== undefined && typeof c[key] !== 'string')) return false;
  const area = value.area;
  if (['townPath', 'localityPath'].some(key => area[key] !== undefined && !inside(area[key]))) return false;
  return (value.coordinatesText === undefined || typeof value.coordinatesText === 'string') && (value.makeDefaultSourceType === undefined || typeof value.makeDefaultSourceType === 'boolean');
}
/** Preparation shares the notebook's mutation queue and context boundary. */
export class PreparationStore {
  constructor(private host: Host) {}
  private path(id: string) { if (!validId(id)) throw Error('Invalid preparation identity.'); return new NotebookPaths(this.host.root()).drafts + '/' + id + '.json'; }
  private parse(raw: string): PreparationDraft {
    const d: unknown = JSON.parse(raw);
    const editorDraft = isRecord(d) && d.kind === 'place-edit';
    const decode = (value: unknown, key = ''): unknown => isUnknownArray(value) ? value.map(v => decode(v, key)) : isRecord(value) ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, decode(v, k)])) : typeof value === 'string' && value.startsWith('[[') && value.endsWith(']]') && (!editorDraft || key === 'path') ? linkPath(value) : value;
    if (!isRecord(d) || d.schema !== 1 || !validId(d.id) || d.root !== this.host.root() || typeof d.updatedAt !== 'string' || !Number.isFinite(Date.parse(d.updatedAt)) || typeof d.deferred !== 'boolean' || d.phase !== 'editing' && d.phase !== 'completing' && d.phase !== 'complete' && d.phase !== 'discarded') throw Error('This preparation draft needs review.');
    const root = this.host.root();
    const inside = (p: unknown): p is string => typeof p === 'string' && p.startsWith(root + '/') && !p.includes('\\') && !hasControlCharacters(p, false) && !p.split('/').some(v => !v || v === '..' || v === '.') && !p.startsWith(root + '/Examples/');
    const data = decode(d.data), resultPath = d.resultPath === undefined ? undefined : linkPath(d.resultPath);
    if (resultPath !== undefined && !inside(resultPath)) throw Error('Preparation result belongs to another notebook.');
    const phase: PreparationDraft['phase'] = d.phase;
    const envelope = { schema: 1 as const, id: d.id, root, updatedAt: d.updatedAt, deferred: d.deferred, phase, revision: '', ...(resultPath === undefined ? {} : { resultPath }) };
    if (d.kind === 'outing' && outingData(data, inside)) return { ...envelope, kind: 'outing', data };
    if (d.kind === 'place' && placeData(data, inside)) return { ...envelope, kind: 'place', data };
    if (d.kind === 'place-edit' && isPlaceEditPreparation(data, inside)) return { ...envelope, kind: 'place-edit', data };
    throw Error('This preparation draft needs review: fields are invalid or belong to another notebook.');
  }
  async get(id: string): Promise<PreparationDraft | undefined> {
    const file = this.host.app.vault.getAbstractFileByPath(this.path(id)); if (!file) return;
    if (!fileLike(file)) throw Error('A folder occupies the preparation file.');
    const raw = await this.host.app.vault.read(file), draft = this.parse(raw); if (draft.id !== id) throw Error('Preparation identity changed.');
    return { ...draft, revision: await hashText(raw) };
  }
  async inspect(): Promise<{ drafts: PreparationDraft[]; warnings: { path: string; message: string }[] }> {
    const drafts: PreparationDraft[] = [], warnings: { path: string; message: string }[] = [];
    for (const f of notebookFiles(this.host.app.vault, new NotebookPaths(this.host.root()).drafts).filter(f => f.extension === 'json')) {
      try { const draft = await this.get(f.basename); if (draft && !['complete', 'discarded'].includes(draft.phase)) drafts.push(draft); } catch (e) { warnings.push({ path: f.path, message: String(e) }); }
    }
    return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
  }
  async save<D extends PreparationDraft>(draft: D, expected: string): Promise<D> {
    return this.host.exclusive(async () => {
      const current = await this.get(draft.id);
      if ((current?.revision ?? '') !== expected) throw Error('This draft changed in another view. Your entered details remain here; reopen the saved draft to compare.');
      if (current && current.phase !== 'editing') throw Error('This draft is completing or has closed. Reopen saved work.');
      if (current && current.kind !== draft.kind) throw Error('Preparation kind changed.');
      return this.write({ ...draft, root: this.host.root(), updatedAt: new Date().toISOString(), phase: 'editing' }, expected);
    });
  }
  private async write<D extends PreparationDraft>(draft: D, expected: string): Promise<D> {
    const safeDraft: PreparationDraft = structuredClone(draft);
    if (safeDraft.kind === 'outing' && safeDraft.data.placeQuery) safeDraft.data.placeQuery = serialisePlaceQuery(safeDraft.data.placeQuery);
    const { revision: _revision, ...data } = safeDraft;
    const encode = (value: unknown, key = ''): unknown => isUnknownArray(value) ? value.map(v => encode(v, key)) : isRecord(value) ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, encode(v,k)])) : typeof value === 'string' && value.startsWith(draft.root + '/') && (key.endsWith('Path') || ['area','path','unresolved','linkedSource'].includes(key)) ? wiki(value) : value;
    const encoded = { ...data, data: encode(data.data), ...(data.resultPath ? { resultPath: wiki(data.resultPath) } : {}) };
    const raw = JSON.stringify(encoded, null, 2) + '\n'; this.parse(raw);
    const path = this.path(draft.id), file = this.host.app.vault.getAbstractFileByPath(path);
    if (!file) { if (expected) throw Error('The preparation draft was removed.'); await this.host.folder(new NotebookPaths(this.host.root()).drafts); await this.host.app.vault.create(path, raw); }
    else {
      if (!fileLike(file)) throw Error('Preparation path is occupied.');
      const before = await this.host.app.vault.read(file); if (await hashText(before) !== expected) throw Error('Preparation draft changed.');
      await this.host.app.vault.process(file, current => { if (current !== before) throw Error('Preparation draft changed.'); return raw; });
    }
    return { ...draft, data: safeDraft.data, revision: await hashText(raw) };
  }
  async transition(id: string, expected: string, phase: PreparationDraft['phase'], resultPath?: string): Promise<PreparationDraft> {
    return this.host.exclusive(async () => {
      const draft = await this.get(id); if (!draft || draft.revision !== expected) throw Error('Preparation changed. Reopen it before continuing.');
      if (draft.phase === 'complete' || draft.phase === 'discarded') throw Error('This preparation has already closed.');
      if (draft.phase === 'completing' && phase !== 'complete' && phase !== 'completing') throw Error('Finish the saved completion before changing this draft.');
      return this.write({ ...draft, phase, ...(resultPath ? { resultPath } : {}), updatedAt: new Date().toISOString() }, expected);
    });
  }
  /** A failed comparison can reopen an edit only while its atomic note receipt is absent. */
  async reopenPlaceEdit(id: string, expected: string): Promise<PreparationDraft<PlaceEditPreparation>> {
    return this.host.exclusive(async () => {
      const draft = await this.get(id);
      if (!draft || draft.kind !== 'place-edit' || draft.phase !== 'completing' || draft.revision !== expected) throw Error('This place edit draft changed. Reopen saved work.');
      const file = this.host.app.vault.getAbstractFileByPath(draft.data.snapshot.path);
      if (fileLike(file) && placeEditReceiptFor(readNote(await this.host.app.vault.read(file)).properties.place_edit_receipts, id)) throw Error('This place edit was already saved. Finish the saved edit to close its draft without replaying changes.');
      return this.write({ ...draft, phase: 'editing' }, expected);
    });
  }
  async defer(id: string, expected: string): Promise<void> {
    const draft = await this.get(id); if (!draft || draft.revision !== expected) throw Error('Preparation changed.');
    await this.save({ ...draft, deferred: true }, expected);
  }
}
