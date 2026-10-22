import type { WorkspaceRoute, WorkspaceViewState } from './types';
import type { VisitsHubState } from '../ui/visit-history';
import { isRecord, isUnknownArray } from '../domain/guards';
import { checkedRoute } from './routes';
import { normalisePlaceQuery, normalisePlaceSort, serialisePlaceQuery } from './place-query';

function historyState(value: unknown): value is VisitsHubState {
  if (!isRecord(value) || ['from', 'to', 'query'].some(key => value[key] !== undefined && typeof value[key] !== 'string') || value.view !== undefined && value.view !== 'history' && value.view !== 'insights' || value.period !== undefined && value.period !== 'all' && value.period !== 'this-week' && value.period !== 'previous-week' && value.period !== 'custom') return false;
  if (value.expandedVisits !== undefined && (!isRecord(value.expandedVisits) || Object.values(value.expandedVisits).some(v => typeof v !== 'boolean'))) return false;
  if (value.insights !== undefined) {
    const insights = value.insights;
    if (!isRecord(insights) || ['sourcePath', 'areaPath', 'from', 'to', 'query'].some(key => insights[key] !== undefined && typeof insights[key] !== 'string') || ['includeSuspected', 'coloursExpanded'].some(key => insights[key] !== undefined && typeof insights[key] !== 'boolean') || insights.sort !== undefined && insights.sort !== 'date' && insights.sort !== 'items' && insights.sort !== 'score') return false;
  }
  return true;
}
/** Layout state is untrusted sync data; malformed sections reset independently. */
export function checkedViewState(raw: unknown): WorkspaceViewState | undefined {
  if (!isRecord(raw) || typeof raw.root !== 'string') return;
  const state: WorkspaceViewState = { root: raw.root, route: checkedRoute(raw.root, raw.route), positions: {} };
  const places = raw.places;
  if (isRecord(places) && typeof places.query === 'string' && typeof places.area === 'string' && (places.kind === 'shop' || places.kind === 'parking' || places.kind === '') && typeof places.shortlist === 'boolean' && (places.view === 'map' || places.view === 'list')) state.places = { query: places.query, area: places.area, kind: places.kind, shortlist: places.shortlist, view: places.view, criteria: serialisePlaceQuery(normalisePlaceQuery(places.criteria ?? places)), sort: normalisePlaceSort(places.sort) };
  if (historyState(raw.history)) state.history = raw.history;
  if (isRecord(raw.positions)) for (const [key, position] of Object.entries(raw.positions)) {
    if (!isRecord(position) || typeof position.scroll !== 'number' || !Number.isFinite(position.scroll) || position.scroll < 0 || position.focus !== undefined && typeof position.focus !== 'string' || position.expanded !== undefined && (!isUnknownArray(position.expanded) || !position.expanded.every(v => typeof v === 'string'))) continue;
    state.positions ??= {};
    state.positions[key] = { scroll: position.scroll, ...(typeof position.focus === 'string' ? { focus: position.focus } : {}), ...(isUnknownArray(position.expanded) ? { expanded: position.expanded.filter((v): v is string => typeof v === 'string') } : {}) };
  }
  return state;
}

/** Keep pane navigation and restoration state attached to records after reviewed moves. */
export function remapWorkspacePaths(state: WorkspaceViewState, history: WorkspaceRoute[], from: string, to: string, subtree = false): void {
  const remap = (path: string) => path === from ? to : subtree && path.startsWith(from + '/') ? to + path.slice(from.length) : path;
  const route = (value: WorkspaceRoute) => { if ('path' in value) value.path = remap(value.path); };
  route(state.route); history.forEach(route);
  const places = state.places;
  if (places) {
    places.area = remap(places.area);
    if (places.criteria) {
      places.criteria.area = remap(places.criteria.area);
      const reference = places.criteria.nearby?.reference;
      if (reference?.kind === 'place') reference.path = remap(reference.path);
    }
  }
  if (state.history?.expandedVisits) state.history.expandedVisits = Object.fromEntries(Object.entries(state.history.expandedVisits).map(([path, expanded]) => [remap(path), expanded]));
  const insights = state.history?.insights;
  if (insights?.sourcePath) insights.sourcePath = remap(insights.sourcePath);
  if (insights?.areaPath) insights.areaPath = remap(insights.areaPath);
  if (state.positions) {
    const positions: NonNullable<WorkspaceViewState['positions']> = {};
    for (const [key, position] of Object.entries(state.positions)) {
      let nextKey = key;
      try {
        const saved: unknown = JSON.parse(key);
        if (isRecord(saved) && typeof saved.path === 'string') nextKey = JSON.stringify({ ...saved, path: remap(saved.path) });
      } catch { /* Older restoration keys remain usable as stored. */ }
      positions[nextKey] = { ...position, ...(position.focus?.startsWith('place:') ? { focus: 'place:' + remap(position.focus.slice(6)) } : {}) };
    }
    state.positions = positions;
  }
}
