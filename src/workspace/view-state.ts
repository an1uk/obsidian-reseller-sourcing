import type { WorkspaceViewState } from './types';
import type { VisitsHubState } from '../ui/visit-history';
import { isRecord, isUnknownArray } from '../domain/guards';
import { checkedRoute } from './routes';

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
  if (isRecord(places) && typeof places.query === 'string' && typeof places.area === 'string' && (places.kind === 'shop' || places.kind === 'parking' || places.kind === '') && typeof places.shortlist === 'boolean' && (places.view === 'map' || places.view === 'list')) state.places = { query: places.query, area: places.area, kind: places.kind, shortlist: places.shortlist, view: places.view };
  if (historyState(raw.history)) state.history = raw.history;
  if (isRecord(raw.positions)) for (const [key, position] of Object.entries(raw.positions)) {
    if (!isRecord(position) || typeof position.scroll !== 'number' || !Number.isFinite(position.scroll) || position.scroll < 0 || position.focus !== undefined && typeof position.focus !== 'string' || position.expanded !== undefined && (!isUnknownArray(position.expanded) || !position.expanded.every(v => typeof v === 'string'))) continue;
    state.positions ??= {};
    state.positions[key] = { scroll: position.scroll, ...(typeof position.focus === 'string' ? { focus: position.focus } : {}), ...(isUnknownArray(position.expanded) ? { expanded: position.expanded.filter((v): v is string => typeof v === 'string') } : {}) };
  }
  return state;
}
