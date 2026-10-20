import type { PlaceRecord } from '../types';
import type { VisitRecord, VisitRejectedAssociation } from '../visits/types';
import type { OutingRecord, OutingStop } from './types';

export interface OutingCatchupRow {
  stopId: string;
  sourcePath: string;
  name: string;
  sourceAvailable: boolean;
  visit?: VisitRecord;
  date: { date: string; origin: string };
  action?: 'add' | 'edit' | 'resume';
  issues: string[];
}
export interface OutingCatchupSavedWork {
  kind: 'draft' | 'operation';
  stopId: string;
  name: string;
  available: boolean;
}
export interface OutingCatchup {
  available: boolean;
  rows: OutingCatchupRow[];
  savedWork?: OutingCatchupSavedWork;
}

interface OutingDateContext {
  startedAt?: string;
  finishedAt?: string;
  planning?: { timeZone?: string; date?: string };
}
const localDate = (date: Date): string => [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** A late note starts from the outing's date, rather than the day it is typed. */
export function catchupVisitDate(record?: OutingDateContext, stop?: Pick<OutingStop, 'completedAt'>, now = new Date()): { date: string; origin: string } {
  let formatter: Intl.DateTimeFormat | undefined;
  if (record?.planning?.timeZone) {
    try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: record.planning.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { /* Invalid old timezone: use the device's local date. */ }
  }
  for (const [value, origin] of [[stop?.completedAt, 'recorded stop completion'], [record?.startedAt, 'outing start']] as const) {
    if (!value) continue;
    const date = new Date(value); if (!Number.isFinite(date.getTime())) continue;
    if (formatter) {
      const parts = formatter.formatToParts(date), part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
      return { date: part('year') + '-' + part('month') + '-' + part('day'), origin: 'Suggested from ' + origin + ' in the outing timezone' };
    }
    return { date: localDate(date), origin: 'Suggested from ' + origin + ' in the device timezone' };
  }
  if (validDate(record?.planning?.date)) return { date: record.planning.date, origin: 'Suggested from the planned outing date' };
  if (record?.finishedAt) {
    const finished = new Date(record.finishedAt);
    if (Number.isFinite(finished.getTime())) {
      if (formatter) {
        const parts = formatter.formatToParts(finished), part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
        return { date: part('year') + '-' + part('month') + '-' + part('day'), origin: 'Suggested from outing finish in the outing timezone' };
      }
      return { date: localDate(finished), origin: 'Suggested from outing finish in the device timezone' };
    }
  }
  return { date: localDate(now), origin: 'Suggested from today; the outing date is unavailable' };
}
function sourceName(path: string, places: readonly PlaceRecord[]): string {
  return places.find(place => place.path === path && place.kind === 'shop')?.name ?? path.split('/').at(-1)?.replace(/\.md$/, '') ?? 'Source unavailable';
}
/** Matches saved identity only; it never guesses from a source name or visit date. */
export function visitRefersToOutingStop(outing: Pick<OutingRecord, 'id' | 'path'>, stop: OutingStop, visit: VisitRejectedAssociation): boolean {
  return ((visit.outingId === outing.id || visit.outingPath === outing.path) && (visit.stopId === stop.id || visit.sourcePath === stop.sourcePath)) ||
    (visit.stopId === stop.id && visit.sourcePath === stop.sourcePath) || (!!stop.visitPath && visit.path === stop.visitPath) ||
    (!!stop.visitId && visit.id === stop.visitId) || (!!stop.visitOperationId && visit.legacyOperationId === stop.visitOperationId);
}
function linkedVisit(outing: OutingRecord, stop: OutingStop, visits: readonly VisitRecord[], rejected: readonly VisitRejectedAssociation[]): { visit?: VisitRecord; issues: string[] } {
  const issues: string[] = [], associated = (visit: VisitRejectedAssociation) => visitRefersToOutingStop(outing, stop, visit);
  const candidates = visits.filter(associated);
  if (rejected.some(associated)) issues.push('An excluded visit note refers to this stop. Review its identity or invalid details before adding or editing a visit.');
  if (!stop.visitPath) {
    if (stop.visitId || candidates.length) issues.push('A saved visit already refers to this stop. Review the outing and visit links before adding details.');
    return { issues };
  }
  const matches = visits.filter(visit => visit.path === stop.visitPath), visit = matches[0];
  if (!visit) return { issues: ['The linked visit is unavailable. Restore it or review its saved links before adding details.'] };
  if (matches.length !== 1 || candidates.some(candidate => candidate.path !== visit.path) ||
      outing.groups.flatMap(group => group.stops).some(other => other.id !== stop.id && (other.visitPath === stop.visitPath || (!!stop.visitId && other.visitId === stop.visitId)))) {
    issues.push('More than one visit or stop uses this visit identity. Review the saved links before editing.');
  }
  if (visit.id !== stop.visitId || visit.sourcePath !== stop.sourcePath || visit.outingId !== outing.id || visit.outingPath !== outing.path || visit.stopId !== stop.id) {
    issues.push('The linked visit belongs to another source, outing or stop. Review the saved links before editing.');
  }
  return issues.length ? { issues } : { visit, issues };
}
/** Read-only overview. Pending and skipped stops never become catch-up visits. */
export function buildOutingCatchup(outing: OutingRecord, visits: readonly VisitRecord[], places: readonly PlaceRecord[], rejected: readonly VisitRejectedAssociation[] = []): OutingCatchup {
  const stops = outing.groups.flatMap(group => group.stops), available = outing.status === 'active' || outing.status === 'finished';
  const saved = outing.operation ?? outing.draft;
  const savedStop = saved ? stops.find(stop => stop.id === saved.stopId) : undefined;
  const savedWork = saved ? {
    kind: outing.operation ? 'operation' as const : 'draft' as const,
    stopId: saved.stopId,
    name: savedStop ? sourceName(savedStop.sourcePath, places) : 'Unavailable stop',
    available: !!savedStop,
  } : undefined;
  const rows = stops.filter(stop => stop.status === 'visited').map(stop => {
    const sourceAvailable = places.some(place => place.path === stop.sourcePath && place.kind === 'shop');
    const linked = linkedVisit(outing, stop, visits, rejected), issues = linked.issues;
    if (!sourceAvailable) issues.push('The source note is unavailable. Restore it before editing this visit.');
    const row: OutingCatchupRow = { stopId: stop.id, sourcePath: stop.sourcePath, name: sourceName(stop.sourcePath, places), sourceAvailable, visit: linked.visit,
      date: linked.visit ? { date: linked.visit.visitDate, origin: 'Saved actual visit date' } : catchupVisitDate(outing, stop), issues };
    if (available && !issues.length && !outing.operation && (!outing.draft || outing.draft.stopId === stop.id)) row.action = outing.draft ? 'resume' : linked.visit ? 'edit' : 'add';
    return row;
  });
  return { available, rows, savedWork };
}
