import { propertyText } from '../domain/guards';
import { isOutingFocus, outingFocusFingerprint, outingFocusView } from './focus';
import { validateCoordinates } from '../domain/coordinates';
import { validateVisitInput, visitInputShape } from '../visits/store';
import { visitRefersToOutingStop } from './catch-up';
import type { VisitStore } from '../visits/store';
import type { App, TFile } from 'obsidian';
import type { PlaceRecord } from '../types';
import { safeFileName } from '../domain';
import { NotebookPaths } from '../storage/paths';
import { appendVisit, hashText, linkPath, localDate, readNote, updateNoteProperty, wiki, writeNote } from '../storage/markdown';
import type { OutingGroup, OutingPlanInput, OutingRecord, OutingStop, OutingStopStatus, OutingVisitInput, OutingVisitOptions, OutingPlanningOptions, OutingOptimisationPreview, PlanningHours, OutingFocusState } from './types';

import { buildOutingOptimisationPreview, resolvePlanningAnchor, validatePlanningOptions } from './planning';
import { extractSourceContext } from './domain';
import { hasControlCharacters, isUnknownArray } from '../domain/guards';
import { notebookFiles } from '../storage/files';

export interface OutingInspection {
  records: OutingRecord[];
  problems: { path: string; message: string }[];
}
interface OutingProblem {
  path: string;
  message: string;
  id?: string;
  preparationId?: string;
  status?: OutingRecord['status'];
  exampleBackground?: boolean;
}
interface OutingHost {
  visits: VisitStore;
  app: App;
  root(): string;
  examples?: boolean;
  exclusive<T>(action: () => Promise<T>): Promise<T>;
  listPlaces(): Promise<PlaceRecord[]>;
  folder(path: string): Promise<void>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const fileLike = (v: unknown): v is TFile => object(v) && 'extension' in v;
const timestamp = () => new Date().toISOString();
const allStops = (outing: OutingRecord) => outing.groups.flatMap(group => group.stops);
function outingShape(value: unknown): value is Omit<OutingRecord, 'path' | 'revision'> {
  if (!object(value) || !text(value.id) || !text(value.name) || typeof value.createdAt !== 'string' || value.status !== 'planned' && value.status !== 'active' && value.status !== 'finished' || !isUnknownArray(value.groups)) return false;
  for (const group of value.groups) {
    if (!object(group) || typeof group.id !== 'string' || typeof group.parkingPath !== 'string' || !isUnknownArray(group.stops)) return false;
    for (const stop of group.stops) if (!object(stop) || typeof stop.id !== 'string' || typeof stop.sourcePath !== 'string' || stop.status !== 'pending' && stop.status !== 'visited' && stop.status !== 'skipped' || !['completedAt', 'visitOperationId', 'visitPath', 'visitId', 'skipReason'].every(key => stop[key] === undefined || typeof stop[key] === 'string')) return false;
  }
  if (value.draft !== undefined) {
    const draft = value.draft;
    if (!object(draft) || typeof draft.operationId !== 'string' || typeof draft.stopId !== 'string' || !visitInputShape(draft.input) || typeof draft.updatedAt !== 'string' || draft.visitRevision !== undefined && typeof draft.visitRevision !== 'string') return false;
  }
  if (value.operation !== undefined) {
    const op = value.operation;
    if (!object(op) || !visitInputShape(op.input) || !['id', 'stopId', 'sourcePath', 'recordedAt', 'sourceBeforeHash', 'sourceIdentity'].every(key => typeof op[key] === 'string') || !['visitPath', 'visitId', 'visitRevision'].every(key => op[key] === undefined || typeof op[key] === 'string') || op.kind !== undefined && op.kind !== 'linked-visit' || op.confirmedSkipped !== undefined && typeof op.confirmedSkipped !== 'boolean') return false;
  }
  if (value.focus !== undefined && !isOutingFocus(value.focus)) return false;
  return ['preparationId', 'startedAt', 'finishedAt'].every(key => value[key] === undefined || typeof value[key] === 'string') && (value.exampleBackground === undefined || typeof value.exampleBackground === 'boolean');
}

/** Durable outing state lives in ordinary linked Markdown, sharing the notebook's mutation queue. */
export class OutingStore {
  constructor(private host: OutingHost) {}
  private file(path: string): TFile {
    if (!path.startsWith(this.host.root() + '/Outings/') || path.includes('\\') || hasControlCharacters(path, false) || path.split('/').some(p => p === '..' || p.startsWith('.'))) throw new Error('Choose an outing in this notebook.');
    const file = this.host.app.vault.getAbstractFileByPath(path);
    if (!fileLike(file) || file.extension !== 'md') throw new Error('This outing note no longer exists.');
    return file;
  }
  private async load(path: string, suppliedRaw?: string): Promise<{ record: OutingRecord; raw: string }> {
    const file = this.file(path), raw = suppliedRaw ?? await this.host.app.vault.read(file);
    const properties = readNote(raw).properties, data = properties.outing;
    if (!this.host.examples && properties.sourcing_example === true) throw new Error('Fictional outings belong in Examples.');
    if (!Array.isArray(properties.tags) || !properties.tags.includes('sourcing-outing') || !object(data) || data.schema !== 1 ||
        !text(data.id) || !text(data.name) || !['planned', 'active', 'finished'].includes(text(data.status)) || !Array.isArray(data.groups)) throw new Error('This outing has invalid properties. Review its note before continuing.');
    if (!outingShape(data)) throw Error('This outing has invalid saved fields. Preserve its note for review.');
    const record: OutingRecord = { ...structuredClone(data), path, revision: await hashText(raw) };
    const ids = new Set<string>(), sources = new Set<string>();
    for (const group of record.groups) {
      if (!object(group) || !text(group.id) || ids.has(group.id) || typeof group.parkingPath !== 'string' || !Array.isArray(group.stops)) throw new Error('This outing has invalid groups.');
      ids.add(group.id); group.parkingPath = linkPath(group.parkingPath);
      for (const stop of group.stops) {
        if (!object(stop) || !text(stop.id) || ids.has(stop.id) || !text(stop.sourcePath) || !['pending', 'visited', 'skipped'].includes(text(stop.status))) throw new Error('This outing has invalid stops.');
        ids.add(stop.id); stop.sourcePath = linkPath(stop.sourcePath);
        if (stop.visitPath) stop.visitPath = linkPath(stop.visitPath);
        if (stop.visitPath && (!stop.visitId || !stop.visitPath.startsWith(this.host.root() + '/Visits/'))) throw Error('This outing has an invalid visit link.');
        if (sources.has(stop.sourcePath)) throw new Error('This outing contains the same source twice.');
        sources.add(stop.sourcePath);
      }
    }
    if (record.draft && (!object(record.draft) || !text(record.draft.operationId) || !allStops(record).some(s => s.id === record.draft!.stopId) || !object(record.draft.input))) throw new Error('This outing has an invalid visit draft.');
    if (record.operation) {
      const operation = record.operation;
      if (!object(operation) || !text(operation.id) || !text(operation.sourcePath) || !text(operation.sourceBeforeHash) || !text(operation.recordedAt) || !object(operation.input) || !allStops(record).some(s => s.id === operation.stopId)) throw new Error('This outing has an invalid saved visit operation.');
      operation.sourcePath = linkPath(operation.sourcePath);
      if (operation.kind !== undefined && operation.kind !== 'linked-visit') throw Error('This outing has an unsupported visit operation.');
      if (operation.visitPath) operation.visitPath = linkPath(operation.visitPath);
    }
    if (record.planning) record.planning = this.normalisePlanning(record.planning);
    if (record.focus?.parkedParkingPath) record.focus.parkedParkingPath = linkPath(record.focus.parkedParkingPath);
    return { record, raw };
  }
  async get(path: string): Promise<OutingRecord> { return (await this.load(path)).record; }
  private async scan(): Promise<{ records: OutingRecord[]; problems: OutingProblem[] }> {
    const records: OutingRecord[] = [], problems: OutingProblem[] = [];
    for (const file of notebookFiles(this.host.app.vault, this.host.root() + '/Outings').filter(f => f.extension === 'md')) {
      let header: Record<string, unknown> | undefined;
      try {
        const raw = await this.host.app.vault.read(file), properties = readNote(raw).properties;
        if (!this.host.examples && properties.sourcing_example === true || !Array.isArray(properties.tags) || !properties.tags.includes('sourcing-outing')) continue;
        if (object(properties.outing)) header = properties.outing;
        records.push((await this.load(file.path, raw)).record);
      } catch (error) {
        problems.push({
          path: file.path, message: error instanceof Error ? error.message : 'This outing could not be read. Preserve its note for review.',
          ...(header && text(header.id) ? { id: text(header.id) } : {}),
          ...(header && text(header.preparationId) ? { preparationId: text(header.preparationId) } : {}),
          ...(header?.status === 'planned' || header?.status === 'active' || header?.status === 'finished' ? { status: header.status } : {}),
          ...(header?.exampleBackground === true ? { exampleBackground: true } : {}),
        });
      }
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
    return { records, problems };
  }
  /** Browsing may show valid outings alongside exact notes needing review. */
  async inspect(): Promise<OutingInspection> {
    const { records, problems } = await this.scan();
    return { records, problems: problems.map(({ path, message }) => ({ path, message })) };
  }
  private reviewProblem(problem: OutingProblem): Error {
    return Error('Review the outing at "' + problem.path + '" before continuing: ' + problem.message);
  }
  /** Recovery and moves require a complete inventory, rather than a partial browsing result. */
  async list(): Promise<OutingRecord[]> {
    const { records, problems } = await this.scan();
    if (problems[0]) throw this.reviewProblem(problems[0]);
    return records;
  }
  private encode(record: OutingRecord): Record<string, unknown> {
    const { path: _path, revision: _revision, ...data } = structuredClone(record);
    for (const group of data.groups) {
      group.parkingPath = group.parkingPath ? wiki(group.parkingPath) : '';
      for (const stop of group.stops) { stop.sourcePath = wiki(stop.sourcePath); if (stop.visitPath) stop.visitPath = wiki(stop.visitPath); }
    }
    if (data.operation) { data.operation.sourcePath = wiki(data.operation.sourcePath); if (data.operation.visitPath) data.operation.visitPath = wiki(data.operation.visitPath); }
    if (data.planning) {
      if (data.planning.start?.kind === 'record') data.planning.start.path = wiki(data.planning.start.path);
      if (data.planning.end.kind === 'record') data.planning.end.path = wiki(data.planning.end.path);
    }
    if (data.focus?.parkedParkingPath) data.focus.parkedParkingPath = wiki(data.focus.parkedParkingPath);
    return { ...data, schema: 1 };
  }
  private async persist(record: OutingRecord, raw: string): Promise<OutingRecord> {
    const value = this.encode(record);
    await this.host.app.vault.process(this.file(record.path), current => {
      if (current !== raw) throw new Error('The outing changed. Reopen it before saving.');
      return updateNoteProperty(current, 'outing', value);
    });
    return this.get(record.path);
  }
  private check(record: OutingRecord, revision?: string, allowOperation = false): void {
    if (revision && revision !== record.revision) throw new Error('The outing changed. Reopen it before saving.');
    if (record.operation && !allowOperation) throw new Error('Resume the unfinished visit save before changing this outing.');
  }
  private active(record: OutingRecord): void {
    if (record.status !== 'active') throw new Error('Start or resume this outing first.');
  }
  private stop(record: OutingRecord, id: string): OutingStop {
    const stop = allStops(record).find(s => s.id === id);
    if (!stop) throw new Error('This stop is no longer in the outing.');
    return stop;
  }
  private async groups(input: OutingGroup[], previous?: OutingRecord): Promise<OutingGroup[]> {
    if (!Array.isArray(input) || !input.length) throw new Error('Add at least one source to the outing.');
    const places = await this.host.listPlaces(), ids = new Set<string>(), sources = new Set<string>(), parking = new Set<string>();
    const groups: OutingGroup[] = [];
    for (const group of input) {
      if (!group.id || ids.has(group.id) || !Array.isArray(group.stops) || !group.stops.length) throw new Error('Each outing group needs an identifier and at least one source.');
      ids.add(group.id);
      const parkingPath = group.parkingPath || '';
      const oldGroup = previous?.groups.find(old => old.id === group.id && old.parkingPath === parkingPath);
      const retainedHistory = !!oldGroup && oldGroup.stops.every(stop => stop.status !== 'pending') &&
        group.stops.length === oldGroup.stops.length && group.stops.every(stop => oldGroup.stops.some(old => old.id === stop.id && old.sourcePath === stop.sourcePath));
      if (parkingPath && ((!places.some(p => p.path === parkingPath && p.kind === 'parking') && !retainedHistory) || parking.has(parkingPath))) throw new Error('Choose one valid group for each parking location.');
      if (parkingPath) parking.add(parkingPath);
      const stops: OutingStop[] = [];
      for (const stop of group.stops) {
        if (!stop.id || ids.has(stop.id) || sources.has(stop.sourcePath)) throw new Error('Each source can appear only once in an outing.');
        ids.add(stop.id); sources.add(stop.sourcePath);
        const old = previous && allStops(previous).find(s => s.id === stop.id && s.sourcePath === stop.sourcePath);
        const place = places.find(p => p.path === stop.sourcePath && p.kind === 'shop');
        if (!old && (!place || place.properties.shop_closed === true)) throw new Error('Choose an available source in this notebook.');
        stops.push(old ? structuredClone(old) : { id: stop.id, sourcePath: stop.sourcePath, status: 'pending' });
      }
      groups.push({ id: group.id, parkingPath, stops });
    }
    if (previous) {
      const removed = allStops(previous).filter(s => !groups.some(g => g.stops.some(n => n.id === s.id && n.sourcePath === s.sourcePath)));
      if (removed.some(s => s.status !== 'pending' || s.id === previous.draft?.stopId)) throw new Error('Keep completed stops and the saved draft in the outing.');
    }
    return groups;
  }
  private normalisePlanning(value: unknown): OutingPlanningOptions {
    const options = validatePlanningOptions(value);
    if (options.start?.kind === 'record') options.start.path = linkPath(options.start.path);
    if (options.end.kind === 'record') options.end.path = linkPath(options.end.path);
    return options;
  }
  private async checkedPlanning(value: unknown, groups: OutingGroup[]): Promise<OutingPlanningOptions> {
    const options = this.normalisePlanning(value), places = await this.host.listPlaces();
    for (const anchor of [options.start, options.end]) {
      if (anchor?.kind === 'record' && !places.some(place => place.path === anchor.path)) throw new Error('Choose a planning endpoint in this notebook. The saved record may have moved or been deleted.');
    }
    if (!resolvePlanningAnchor(options.start, places)) throw new Error('Choose a starting point with valid coordinates.');
    if (options.end.kind !== 'last' && options.end.kind !== 'return' && !resolvePlanningAnchor(options.end, places)) throw new Error('Choose a finishing point with valid coordinates.');
    const stopIds = new Set(groups.flatMap(group => group.stops.map(stop => stop.id)));
    if (Object.keys(options.stopOverrides).some(id => !stopIds.has(id))) throw new Error('A planning override belongs to a stop no longer in this outing. Review the plan.');
    return options;
  }
  /** Read only sources recognised by this immutable notebook context. */
  async planningHours(record: Pick<OutingRecord, 'groups'>): Promise<Record<string, PlanningHours>> {
    const places = await this.host.listPlaces(), allowed = new Set(places.filter(place => place.kind === 'shop').map(place => place.path));
    const hours: Record<string, PlanningHours> = {};
    for (const stop of record.groups.flatMap(group => group.stops)) {
      if (Object.hasOwn(hours, stop.sourcePath)) continue;
      const file = allowed.has(stop.sourcePath) ? this.host.app.vault.getAbstractFileByPath(stop.sourcePath) : null;
      if (!fileLike(file)) { hours[stop.sourcePath] = { hours: [], hoursChecked: '' }; continue; }
      const context = extractSourceContext(await this.host.app.vault.read(file));
      hours[stop.sourcePath] = { hours: context.hours, hoursChecked: context.hoursChecked };
    }
    return hours;
  }
  async previewPlanning(path: string, value: OutingPlanningOptions): Promise<OutingOptimisationPreview> {
    const { record } = await this.load(path), options = await this.checkedPlanning(value, record.groups);
    const [places, hours] = await Promise.all([this.host.listPlaces(), this.planningHours(record)]);
    return buildOutingOptimisationPreview(record, places, hours, options);
  }
  async applyPlanning(path: string, value: OutingPlanningOptions, expectedFingerprint: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record);
      if (record.draft) throw new Error('Finish, resume or discard the saved visit draft before applying a journey plan.');
      const options = await this.checkedPlanning(value, record.groups);
      const [places, hours] = await Promise.all([this.host.listPlaces(), this.planningHours(record)]);
      const preview = buildOutingOptimisationPreview(record, places, hours, options);
      if (!expectedFingerprint || preview.fingerprint !== expectedFingerprint) throw new Error('The journey changed. Preview the plan again before saving.');
      if (preview.blockers.length) throw new Error(preview.blockers.join(' '));
      record.groups = await this.groups(preview.groups, record);
      record.planning = options;
      return this.persist(record, raw);
    });
  }
  private retainPlanningStops(record: OutingRecord): void {
    if (!record.planning) return;
    const ids = new Set(allStops(record).map(stop => stop.id));
    for (const id of Object.keys(record.planning.stopOverrides)) if (!ids.has(id)) delete record.planning.stopOverrides[id];
  }
  async create(input: OutingPlanInput, preparationId?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const name = input.name.trim(); if (!name) throw new Error('Name the outing.');
      if (preparationId && !/^[a-zA-Z0-9-]{8,100}$/.test(preparationId)) throw Error('Invalid outing preparation identity.');
      if (preparationId) {
        const { records, problems } = await this.scan();
        const uncertain = problems.find(problem => !problem.id || problem.id === preparationId || problem.preparationId === preparationId);
        if (uncertain) throw this.reviewProblem(uncertain);
        const existing = records.filter(r => r.id === preparationId);
        if (existing.length > 1) throw Error('Several outings share this preparation identity. Review them before retrying.');
        if (existing[0]) { if (existing[0].preparationId !== preparationId) throw Error('Preparation identity is already in use. Review the saved outing.'); return existing[0]; }
      }
      const groups = await this.groups(input.groups), date = input.planning?.date ?? localDate();
      const path = new NotebookPaths(this.host.root()).outing(safeFileName(name), date);
      if (this.host.app.vault.getAbstractFileByPath(path)) throw new Error('An outing already uses that filename. Choose another name.');
      const record: OutingRecord = { id: preparationId ?? crypto.randomUUID(), ...(preparationId ? { preparationId } : {}), path, name, status: 'planned', groups, createdAt: timestamp(), revision: '' };
      if (input.planning) record.planning = await this.checkedPlanning(input.planning, groups);
      await this.host.folder(path.slice(0, path.lastIndexOf('/')));
      await this.host.app.vault.create(path, writeNote({ ...(this.host.examples ? { sourcing_example: true } : {}), tags: ['sourcing-outing'], cssclasses: ['charity-sourcing-outing'], outing: this.encode(record) }, '```charity-sourcing\nview: outing\n```\n\n## Notes\n\n'));
      return this.get(path);
    });
  }
  async validatePreparation(input: OutingPlanInput, existingPath?: string, revision?: string): Promise<void> {
    const previous = existingPath ? await this.get(existingPath) : undefined;
    if (previous) { this.check(previous, revision); if (previous.draft) throw Error('Finish the saved visit first.'); }
    if (!input.name.trim()) throw Error('Name the outing.');
    const groups = await this.groups(input.groups, previous);
    if (input.planning) await this.checkedPlanning(input.planning, groups);
    if (!previous && this.host.app.vault.getAbstractFileByPath(new NotebookPaths(this.host.root()).outing(safeFileName(input.name), input.planning?.date ?? localDate()))) throw Error('An outing already uses that name. Change the name before saving.');
  }
  async updatePlan(path: string, input: OutingPlanInput, revision?: string, preparationId?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path);
      if (preparationId && record.preparationId === preparationId) return record;
      this.check(record, revision);
      if (record.draft) throw Error('Finish the saved visit before changing this outing.');
      if (preparationId) record.preparationId = preparationId;
      const name = input.name.trim(); if (!name) throw new Error('Name the outing.');
      record.groups = await this.groups(input.groups, record); record.name = name;
      if (input.planning) record.planning = await this.checkedPlanning(input.planning, record.groups);
      this.retainPlanningStops(record);
      return this.persist(record, raw);
    });
  }
  async add(path: string, groupId: string, sourcePath: string, revision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision);
      const groups = structuredClone(record.groups), group = groups.find(g => g.id === groupId);
      if (!group) throw new Error('Choose a group in the outing.');
      group.stops.push({ id: crypto.randomUUID(), sourcePath, status: 'pending' });
      record.groups = await this.groups(groups, record); this.retainPlanningStops(record); return this.persist(record, raw);
    });
  }
  async remove(path: string, stopId: string, revision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision); this.stop(record, stopId);
      const groups = record.groups.map(g => ({ ...g, stops: g.stops.filter(s => s.id !== stopId) })).filter(g => g.stops.length);
      record.groups = await this.groups(groups, record); this.retainPlanningStops(record); return this.persist(record, raw);
    });
  }
  async reorder(path: string, groupIds: string[], stopIdsByGroup: Record<string, string[]> = {}, revision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision);
      const ordered = <T extends { id: string }>(items: T[], ids: string[]): T[] => {
        if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some(id => !items.some(item => item.id === id))) throw new Error('Reordering must keep every existing stop and group.');
        return ids.map(id => items.find(item => item.id === id)!);
      };
      record.groups = ordered(record.groups, groupIds);
      for (const group of record.groups) if (stopIdsByGroup[group.id]) group.stops = ordered(group.stops, stopIdsByGroup[group.id]);
      return this.persist(record, raw);
    });
  }
  /** View choices share the same revision checks and serial operation as progress changes. */
  async setFocus(path: string, focus: OutingFocusState, revision: string, expectedFingerprint: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path);
      if (!isOutingFocus(focus) || !revision) throw Error('This focus stage needs review.');
      const candidate = structuredClone(focus), places = await this.host.listPlaces();
      const view = outingFocusView(record, places), previous = record.focus ?? view.state;
      const displayOnly = candidate.phase === previous.phase && candidate.stopId === previous.stopId &&
        candidate.parkedGroupId === previous.parkedGroupId && candidate.parkedParkingPath === previous.parkedParkingPath &&
        JSON.stringify(candidate.parkedCoordinates) === JSON.stringify(previous.parkedCoordinates);
      this.check(record, revision, displayOnly);
      if (record.draft && !displayOnly) throw Error('Resume or discard the saved visit draft before changing the focus stage.');
      if (candidate.enabled && record.status !== 'active') throw Error('Start or resume the outing before using Out and about.');
      if (!expectedFingerprint || expectedFingerprint !== outingFocusFingerprint(record, places)) throw Error('A source, parking location or outing changed. Reopen the outing before changing stage.');
      if (!displayOnly) {
        if (candidate.stopId !== (view.stop?.id ?? '')) throw Error('The current source changed. Reopen the outing before changing stage.');
        if (candidate.parkedGroupId) {
          const group = record.groups.find(value => value.id === candidate.parkedGroupId && value.parkingPath === candidate.parkedParkingPath);
          const parking = places.find(place => place.path === candidate.parkedParkingPath && place.kind === 'parking');
          const pin = validateCoordinates(parking?.coordinates), confirmed = validateCoordinates(candidate.parkedCoordinates);
          if (!group || !parking || !pin || !confirmed || pin[0] !== confirmed[0] || pin[1] !== confirmed[1]) throw Error('The saved parking location is unavailable or its pin changed. Review the full outing.');
          if (candidate.parkedGroupId !== view.state.parkedGroupId && (candidate.parkedGroupId !== view.group?.id || candidate.phase !== 'walk')) throw Error('Confirm the selected parking before using it as your parked location.');
        }
        if (candidate.phase === 'return' && !candidate.parkedGroupId) throw Error('Confirm where you parked before returning to the car.');
        if (candidate.phase === 'drive' && (!view.parking || !validateCoordinates(view.parking.coordinates))) throw Error('The selected parking needs a valid pin before driving directions are available.');
        if (!view.stop && (candidate.phase !== 'return' && (candidate.phase !== 'visit' || candidate.parkedGroupId))) throw Error('No remaining source needs this stage.');
      }
      record.focus = candidate;
      return this.persist(record, raw);
    });
  }
  async start(path: string, revision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision);
      const { records, problems } = await this.scan();
      const uncertain = problems.find(problem => problem.path !== path && (problem.status === undefined || problem.status === 'active' && !(this.host.examples && problem.exampleBackground)));
      if (uncertain) throw this.reviewProblem(uncertain);
      if (records.some(o => o.path !== path && o.status === 'active' && !(this.host.examples && o.exampleBackground))) throw new Error('Finish the current outing before starting another.');
      record.status = 'active'; record.startedAt ??= timestamp(); delete record.finishedAt; delete record.exampleBackground;
      return this.persist(record, raw);
    });
  }
  async finish(path: string, revision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision); this.active(record);
      record.status = 'finished'; record.finishedAt = timestamp(); return this.persist(record, raw);
    });
  }
  async saveDraft(path: string, stopId: string, input: OutingVisitInput, revision?: string, visitRevision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision); this.stop(record, stopId);
      if (record.draft && record.draft.stopId !== stopId) throw new Error('Resume or discard the existing visit draft first.');
      record.draft = { operationId: record.draft?.operationId ?? crypto.randomUUID(), stopId, input: structuredClone(input), updatedAt: timestamp(), ...((visitRevision ?? record.draft?.visitRevision) ? { visitRevision: visitRevision ?? record.draft?.visitRevision } : {}) };
      return this.persist(record, raw);
    });
  }
  async discardDraft(path: string, revision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision); delete record.draft; return this.persist(record, raw);
    });
  }
  async completeStop(path: string, stopId: string, status: Exclude<OutingStopStatus, 'pending'>, revision?: string, skipReason?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision); this.active(record);
      if (!['visited', 'skipped'].includes(status)) throw new Error('Choose visited or skipped.');
      const stop = this.stop(record, stopId);
      if (record.draft?.stopId === stopId) throw new Error('Save or discard this visit draft first.');
      if (stop.status !== 'pending') throw new Error('Undo this stop before changing its outcome.');
      stop.status = status; stop.completedAt = timestamp();
      if (status === 'skipped' && skipReason?.trim()) stop.skipReason = skipReason.trim();
      return this.persist(record, raw);
    });
  }
  async undo(path: string, stopId: string, revision?: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path); this.check(record, revision);
      const stop = this.stop(record, stopId);
      // Undo changes outing progress only. Source visit records and assessments remain historical facts.
      stop.status = 'pending'; delete stop.completedAt; delete stop.skipReason;
      return this.persist(record, raw);
    });
  }
  private identity(place: PlaceRecord): string { return propertyText(place.properties.source_capture_id); }
  async recordVisit(path: string, stopId: string, input: OutingVisitInput, options: OutingVisitOptions = {}): Promise<OutingRecord> {
    return this.host.exclusive(() => this.writeVisit(path, stopId, input, options));
  }
  async resumeVisit(path: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const record = await this.get(path);
      if (!record.operation) throw new Error('This outing has no unfinished visit save.');
      return this.writeVisit(path, record.operation.stopId, record.operation.input, { operationId: record.operation.id });
    });
  }
  async cancelPendingVisit(path: string): Promise<OutingRecord> {
    return this.host.exclusive(async () => {
      const { record, raw } = await this.load(path), op = record.operation;
      if (!op) throw new Error('This outing has no unfinished visit save.');
      if (op.kind === 'linked-visit') {
        const operationPath = this.host.root() + '/System/Visit operations/' + op.id + '.json';
        if (this.host.app.vault.getAbstractFileByPath(operationPath)) await this.host.visits.cancelOperationNow(op.id);
        record.draft = { operationId: crypto.randomUUID(), stopId: op.stopId, input: structuredClone(op.input), updatedAt: timestamp(), ...(op.visitRevision ? { visitRevision: op.visitRevision } : {}) };
        delete record.operation; return this.persist(record, raw);
      }
      const place = (await this.host.listPlaces()).find(p => p.path === op.sourcePath && p.kind === 'shop');
      if (!place || this.identity(place) !== op.sourceIdentity) throw new Error('Restore the original source note before reviewing this unfinished visit.');
      const sourceFile = this.host.app.vault.getAbstractFileByPath(place.path);
      if (!fileLike(sourceFile)) throw new Error('Restore the source note before reviewing this unfinished visit.');
      const sourceText = await this.host.app.vault.read(sourceFile), properties = readNote(sourceText).properties;
      if (propertyText(properties.source_capture_id) !== op.sourceIdentity) throw new Error('Restore the original source note before reviewing this unfinished visit.');
      if (properties.sourcing_visit_receipts !== undefined && !Array.isArray(properties.sourcing_visit_receipts)) throw new Error('Review the source visit receipts before cancelling this attempt.');
      const receipts = isUnknownArray(properties.sourcing_visit_receipts) ? properties.sourcing_visit_receipts : [];
      if (receipts.some(value => object(value) && value.id === op.id)) throw new Error('This visit is already saved. Resume its completion instead of cancelling.');
      record.draft = { operationId: crypto.randomUUID(), stopId: op.stopId, input: structuredClone(op.input), updatedAt: timestamp() };
      delete record.operation;
      return this.persist(record, raw);
    });
  }
  private async writeVisit(path: string, stopId: string, value: OutingVisitInput, options: OutingVisitOptions): Promise<OutingRecord> {
    let { record, raw } = await this.load(path);
    const stop = this.stop(record, stopId), operationId = options.operationId ?? record.operation?.id ?? record.draft?.operationId ?? crypto.randomUUID();
    if (record.operation && !record.operation.kind || !record.operation && !stop.visitPath && stop.status === 'visited' && stop.visitOperationId === operationId) return this.writeLegacyVisit(path, stopId, value, options);
    const input = validateVisitInput(value);
    this.check(record, undefined, true);
    if (!record.operation && stop.visitOperationId === operationId && stop.visitPath) {
      const visit = await this.host.visits.resumeOperationNow(operationId, input);
      if (visit.id !== stop.visitId || visit.sourcePath !== stop.sourcePath || visit.outingId !== record.id || visit.stopId !== stopId) throw Error('The saved visit identity does not match this outing stop.');
      return record;
    }
    if (!record.operation) this.check(record, options.revision);
    if (record.draft && record.draft.stopId !== stopId) throw Error('Resume or discard the existing visit draft first.');
    const place = (await this.host.listPlaces()).find(p => p.path === stop.sourcePath && p.kind === 'shop');
    if (!place) throw Error('Restore the source note before saving its visit.');
    const sourceFile = this.host.app.vault.getAbstractFileByPath(place.path);
    if (!fileLike(sourceFile)) throw Error('The source note no longer exists.');
    if (record.operation) {
      const op = record.operation;
      if (op.kind !== 'linked-visit' || op.id !== operationId || op.stopId !== stopId || op.sourcePath !== place.path || JSON.stringify(op.input) !== JSON.stringify(input)) throw Error('Resume the saved visit operation before changing its details.');
      if (op.sourceIdentity !== this.identity(place)) throw Error('The source note was replaced. Review visit recovery.');
    } else {
      if (stop.status === 'skipped' && !options.confirmSkipped) throw Error('Confirm recording this skipped stop as visited before saving.');
      let existing;
      if (stop.visitPath) {
        existing = await this.host.visits.get(stop.visitPath);
        const expectedRevision = options.visitRevision ?? record.draft?.visitRevision;
        if (!expectedRevision || expectedRevision !== existing.revision) throw Error('The linked visit changed or has no reviewed comparison. Reopen its details before saving; personal text has been kept.');
        if (existing.id !== stop.visitId || existing.sourcePath !== place.path || existing.outingId !== record.id || existing.stopId !== stopId) throw Error('This stop points to a different visit. Review its links before editing.');
      }
      if (!stop.visitPath) {
        const inspection = await this.host.visits.inspect();
        if ([...inspection.visits, ...(inspection.rejectedAssociations ?? [])].some(visit => visitRefersToOutingStop(record, stop, visit))) {
          throw Error('A saved visit already refers to this outing stop. Review its links before adding another visit.');
        }
      }
      await this.host.visits.assertSourceAvailableNow(place.path, operationId);
      const sourceRaw = await this.host.app.vault.read(sourceFile);
      record.operation = { kind: 'linked-visit', id: operationId, stopId, sourcePath: place.path, input: structuredClone(input), recordedAt: timestamp(), sourceBeforeHash: await hashText(sourceRaw), sourceIdentity: this.identity(place),
        ...(existing ? { visitPath: existing.path, visitId: existing.id, visitRevision: existing.revision } : {}), ...(options.confirmSkipped ? { confirmedSkipped: true } : {}) };
      record = await this.persist(record, raw);
    }
    const op = record.operation!;
    const saveOptions = { operationId: op.id, recordedAt: op.recordedAt, outingPath: path, outingId: record.id, stopId };
    const visit = op.visitPath
      ? await this.host.visits.updateNow(op.visitPath, op.input, op.visitRevision ?? '', saveOptions)
      : await this.host.visits.createNow(place.path, op.input, saveOptions);
    const latest = await this.load(path);
    if (latest.record.operation?.id !== op.id) throw Error('The visit was saved, but the outing changed. Review it before finishing recovery.');
    const savedStop = this.stop(latest.record, stopId);
    if (savedStop.sourcePath !== op.sourcePath) throw Error('The outing source link changed. The saved visit is retained for review.');
    savedStop.status = 'visited'; savedStop.completedAt ??= op.recordedAt; savedStop.visitOperationId = op.id;
    savedStop.visitPath = visit.path; savedStop.visitId = visit.id; delete savedStop.skipReason;
    delete latest.record.operation; if (latest.record.draft?.stopId === stopId) delete latest.record.draft;
    return this.persist(latest.record, latest.raw);
  }
  private async writeLegacyVisit(path: string, stopId: string, input: OutingVisitInput, options: OutingVisitOptions): Promise<OutingRecord> {
    let { record, raw } = await this.load(path);
    this.check(record, undefined, true); this.active(record);
    const stop = this.stop(record, stopId);
    const operationId = options.operationId ?? record.operation?.id ?? record.draft?.operationId ?? crypto.randomUUID();
    const completedRetry = stop.status === 'visited' && stop.visitOperationId === operationId;
    if (!record.operation && !completedRetry) this.check(record, options.revision);
    if (stop.status !== 'pending' && !completedRetry) throw new Error('This stop is already complete.');
    if (record.draft && record.draft.stopId !== stopId) throw new Error('Resume or discard the existing visit draft first.');
    const place = (await this.host.listPlaces()).find(p => p.path === stop.sourcePath && p.kind === 'shop');
    if (!place) throw new Error('The source note is missing. Restore it before saving this visit.');
    const sourceFile = this.host.app.vault.getAbstractFileByPath(place.path);
    if (!fileLike(sourceFile)) throw new Error('The source note is missing.');
    if (completedRetry) {
      const properties = readNote(await this.host.app.vault.read(sourceFile)).properties;
      const receipts = isUnknownArray(properties.sourcing_visit_receipts) ? properties.sourcing_visit_receipts : [];
      const receipt = receipts.find(value => object(value) && value.id === operationId);
      if (!object(receipt) || receipt.inputHash !== await hashText(JSON.stringify(input)) || receipt.outingId !== record.id || receipt.stopId !== stopId) throw new Error('This visit identifier has conflicting saved details.');
      return record;
    }
    if (record.operation) {
      const op = record.operation;
      if (op.id !== operationId || op.stopId !== stopId || op.sourcePath !== place.path || JSON.stringify(op.input) !== JSON.stringify(input)) throw new Error('Resume the saved visit operation before changing its details.');
      if (op.sourceIdentity !== this.identity(place)) throw new Error('The source note was replaced. Review the saved visit before continuing.');
    } else {
      const sourceRaw = await this.host.app.vault.read(sourceFile), recordedAt = timestamp();
      appendVisit(sourceRaw, input, new Date(recordedAt)); // Validate before persisting an operation.
      record.operation = { id: operationId, stopId, sourcePath: place.path, input: structuredClone(input), recordedAt, sourceBeforeHash: await hashText(sourceRaw), sourceIdentity: this.identity(place) };
      record = await this.persist(record, raw); raw = (await this.load(path)).raw;
    }
    const op = record.operation!;
    const sourceRaw = await this.host.app.vault.read(sourceFile), properties = readNote(sourceRaw).properties;
    if (propertyText(properties.source_capture_id) !== op.sourceIdentity) throw new Error('The source note was replaced. Review the saved visit before continuing.');
    if (properties.sourcing_visit_receipts !== undefined && !Array.isArray(properties.sourcing_visit_receipts)) throw new Error('The source has invalid visit receipts. Review its properties before continuing.');
    const receipts = isUnknownArray(properties.sourcing_visit_receipts) ? properties.sourcing_visit_receipts : [];
    const receipt = receipts.find(value => object(value) && value.id === op.id);
    const inputHash = await hashText(JSON.stringify(op.input));
    if (receipt) {
      if (!object(receipt) || receipt.inputHash !== inputHash || receipt.outingId !== record.id || receipt.stopId !== stopId) throw new Error('This visit identifier has conflicting saved details.');
    } else {
      if (await hashText(sourceRaw) !== op.sourceBeforeHash) throw new Error('The source changed during this visit save. Review it before retrying; no visit was added.');
      let next = appendVisit(sourceRaw, op.input, new Date(op.recordedAt));
      next = updateNoteProperty(next, 'sourcing_visit_receipts', [...receipts, { id: op.id, inputHash, outingId: record.id, stopId, recordedAt: op.recordedAt }]);
      await this.host.app.vault.process(sourceFile, current => {
        if (current !== sourceRaw) throw new Error('The source changed before this visit could be saved.');
        return next;
      });
    }
    const latest = await this.load(path);
    if (latest.record.operation?.id !== op.id) throw new Error('The outing changed while saving. The source visit is saved; review the outing before continuing.');
    const savedStop = this.stop(latest.record, stopId);
    savedStop.status = 'visited'; savedStop.completedAt = op.recordedAt; savedStop.visitOperationId = op.id; delete savedStop.skipReason;
    delete latest.record.operation; if (latest.record.draft?.stopId === stopId) delete latest.record.draft;
    return this.persist(latest.record, latest.raw);
  }
}
