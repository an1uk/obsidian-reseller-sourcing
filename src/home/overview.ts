import type { TFile } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { OutingRecord } from '../outings/types';
import type { PlaceRecord } from '../types';
import { hashText, readNote } from '../storage/markdown';
import { validateVisitInput } from '../visits/store';

/** A read model only: actions re-enter the existing stores and their safeguards. */
export type ResumeKind = 'visit-operation' | 'outing-operation' | 'visit-draft' | 'outing-draft' | 'active-outing';
export interface ResumeItem {
  kind: ResumeKind; id: string; path: string; label: string; updatedAt: string; revision: string;
  sourcePath?: string; sourceName?: string; operationId?: string;
  visitPath?: string; visitRevision?: string; outingPath?: string; stopId?: string;
}
export interface HomeWarning { path?: string; message: string; }
export interface HomeOverview {
  root: string; places: PlaceRecord[]; sources: PlaceRecord[]; outings: OutingRecord[];
  captures: number; sourcesAvailable: boolean; primary?: ResumeItem; others: ResumeItem[]; warnings: HomeWarning[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const owns = (context: NotebookContext, path: string, folder: string) => path.startsWith(context.root + '/' + folder + '/') &&
  !/[\\\x00-\x1f]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
const priority = (item: ResumeItem) => item.kind.endsWith('operation') ? 0 : item.kind.endsWith('draft') ? 1 : 2;
const summaryOrder = (a: ResumeItem, b: ResumeItem) => priority(a) - priority(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Inspect each saved item independently; a corrupt item never hides other work. No writes occur. */
export async function inspectHome(context: NotebookContext): Promise<HomeOverview> {
  const overview: HomeOverview = { root: context.root, places: [], sources: [], outings: [], captures: 0, sourcesAvailable: false, others: [], warnings: [] };
  const items: ResumeItem[] = [], warning = (path: string | undefined, error: unknown) => overview.warnings.push({ ...(path ? { path } : {}), message: message(error) });
  try {
    overview.places = await context.store.listPlaces();
    overview.sources = overview.places.filter(place => place.kind === 'shop');
    overview.sourcesAvailable = true;
  } catch (error) { warning(undefined, 'Sources could not be read: ' + message(error)); }
  try { overview.captures = (await context.store.captures()).length; }
  catch (error) { warning(undefined, 'Captures could not be read: ' + message(error)); }
  const sourceByPath = new Map(overview.sources.map(place => [place.path, place]));
  const sourceFor = (path: string) => {
    const source = sourceByPath.get(path);
    if (!source || !owns(context, path, 'Places') && !owns(context, path, 'Sources') && !owns(context, path, 'Shops') || !!source.properties.sourcing_example !== (context.kind === 'examples')) throw Error('The saved source is missing or belongs to another notebook context.');
    return source;
  };
  let savedWork;
  try {
    savedWork = await context.store.visits.inspectSavedWork();
    overview.warnings.push(...savedWork.warnings);
  } catch (error) { warning(undefined, 'Saved visits could not be inspected: ' + message(error)); }
  const outings = context.app.vault.getMarkdownFiles().filter(file => owns(context, file.path, 'Outings'));
  for (const file of outings) {
    try {
      const properties = readNote(await context.app.vault.read(file)).properties;
      if (!Array.isArray(properties.tags) || !properties.tags.includes('sourcing-outing')) continue;
      if (!!properties.sourcing_example !== (context.kind === 'examples')) continue;
      const outing = await context.store.outings.get(file.path);
      const stops = outing.groups.flatMap(group => group.stops);
      for (const stop of stops) sourceFor(stop.sourcePath);
      overview.outings.push(outing);
      if (outing.operation) {
        const operation = outing.operation, stop = stops.find(stop => stop.id === operation.stopId)!;
        const source = sourceFor(operation.sourcePath);
        if (!stop || stop.sourcePath !== source.path || String(source.properties.source_capture_id ?? '') !== operation.sourceIdentity ||
            !validTime(operation.recordedAt) || !/^[a-f0-9]{64}$/.test(operation.sourceBeforeHash)) throw Error('The unfinished outing save has conflicting source identity or comparison details.');
        validateVisitInput(operation.input);
        if (operation.visitPath && (!owns(context, operation.visitPath, 'Visits') || operation.visitPath !== stop.visitPath || operation.visitId !== stop.visitId)) throw Error('The unfinished outing save points to a different visit.');
        items.push({ kind: 'outing-operation', id: operation.id, path: outing.path, label: 'Review interrupted visit save', sourcePath: source.path, sourceName: source.name,
          updatedAt: operation.recordedAt, revision: outing.revision, outingPath: outing.path, stopId: stop.id, operationId: operation.id,
          ...(operation.visitPath ? { visitPath: operation.visitPath, visitRevision: operation.visitRevision } : {}) });
      } else if (outing.draft) {
        const draft = outing.draft, stop = stops.find(stop => stop.id === draft.stopId)!;
        const source = sourceFor(stop.sourcePath), input: unknown = draft.input;
        if (!validTime(draft.updatedAt) || !object(input) || ![input.observations, input.finds, input.nextTime, input.visitDate].every(value => typeof value === 'string') ||
            [input.itemsPurchased, input.haulPotential].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))) throw Error('The saved outing draft has invalid details or saved date.');
        if (stop.visitPath) {
          const visit = await context.store.visits.get(stop.visitPath);
          if (visit.sourcePath !== source.path || visit.id !== stop.visitId || visit.outingId !== outing.id || visit.stopId !== stop.id ||
              !draft.visitRevision || draft.visitRevision !== visit.revision) throw Error('The linked visit changed after this outing draft was reviewed. Review both before continuing.');
        } else if (draft.visitRevision) throw Error('The outing draft has a visit comparison without a visit link.');
        items.push({ kind: 'outing-draft', id: draft.operationId, path: outing.path, label: 'Continue saved visit', sourcePath: source.path, sourceName: source.name,
          updatedAt: draft.updatedAt, revision: outing.revision, outingPath: outing.path, stopId: stop.id,
          ...(stop.visitPath ? { visitPath: stop.visitPath, visitRevision: draft.visitRevision } : {}) });
      } else if (outing.status === 'active') {
        const updatedAt = outing.startedAt ?? outing.createdAt;
        if (!validTime(updatedAt)) throw Error('This active outing has an invalid starting date.');
        items.push({ kind: 'active-outing', id: outing.id, path: outing.path, label: outing.name, updatedAt, revision: outing.revision, outingPath: outing.path });
      }
    } catch (error) { warning(file.path, error); }
  }
  if (savedWork) {
    // A linked visit journal and its outing operation are one saved action.
    const outingOperations = new Set(items.filter(item => item.kind === 'outing-operation').map(item => item.operationId));
    for (const operation of savedWork.operations) {
      if (outingOperations.has(operation.id)) continue;
      try {
        const source = sourceFor(operation.sourcePath);
        if (operation.outingPath) {
          // A journal whose outing still exists is recovered through that outing only.
          const outing = overview.outings.find(outing => outing.path === operation.outingPath && outing.id === operation.outingId);
          if (!outing || !outing.groups.some(group => group.stops.some(stop => stop.id === operation.stopId && stop.sourcePath === operation.sourcePath))) throw Error('The saved visit outing is missing or its stop identity changed.');
          warning(context.root + '/System/Visit operations/' + operation.id + '.json', 'This outing-linked visit needs review in its outing before continuing.');
          continue;
        }
        const path = context.root + '/System/Visit operations/' + operation.id + '.json', file = context.app.vault.getAbstractFileByPath(path);
        if (!file || !('extension' in file)) throw Error('The saved visit operation no longer exists.');
        items.push({ kind: 'visit-operation', id: operation.id, path, label: 'Review interrupted visit save', sourcePath: source.path, sourceName: source.name,
          updatedAt: operation.recordedAt, revision: await hashText(await context.app.vault.read(file as TFile)), operationId: operation.id, visitPath: operation.visitPath });
      } catch (error) { warning(context.root + '/System/Visit operations/' + operation.id + '.json', error); }
    }
    for (const draft of savedWork.drafts) {
      items.push({ kind: 'visit-draft', id: draft.path, path: draft.path, label: 'Continue saved visit', sourcePath: draft.sourcePath, sourceName: draft.sourceName,
        updatedAt: draft.updatedAt, revision: draft.revision, ...(draft.visitPath ? { visitPath: draft.visitPath, visitRevision: draft.visitRevision } : {}) });
    }
  }
  overview.outings.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.path.localeCompare(b.path));
  items.sort(summaryOrder);
  overview.primary = items[0]; overview.others = items.slice(1);
  return overview;
}
