import { readGoogleHours, validGoogleHours } from '../domain/google-details';
import type { Coordinates, PlaceRecord } from '../types';
import { haversineKm, resolveParking, validateCoordinates } from '../domain';
import { readNote } from '../storage/markdown';
import type { OutingGroup, OutingStop } from './types';

export interface GroupSuggestion { groups: OutingGroup[]; issues: string[]; }
export interface OrderSuggestion { groups: OutingGroup[]; warnings: string[]; }
export interface WalkingSuggestion { group: OutingGroup; warnings: string[]; }
export interface SourceContext { hours: string[]; hoursChecked: string; reminder: string; reminderDate: string; }

/** Proposals never alter permanent parking preferences or existing outing progress. */
export function proposeOutingGroups(selectedSources: PlaceRecord[], allPlaces: PlaceRecord[], parkingOverrides: Record<string, string> = {}): GroupSuggestion {
  const places = new Map(allPlaces.map(place => [place.path, place]));
  const grouped = new Map<string, OutingGroup>(), issues: string[] = [], seen = new Set<string>();
  for (const selected of selectedSources) {
    if (seen.has(selected.path)) { issues.push('Source selected more than once: ' + selected.name + '.'); continue; }
    seen.add(selected.path);
    const source = places.get(selected.path);
    let parkingPath = '';
    if (!source || source.kind !== 'shop') issues.push('This source is no longer available: ' + selected.name + '.');
    else if (Object.hasOwn(parkingOverrides, source.path)) {
      const override = parkingOverrides[source.path];
      if (override === '') { /* Explicitly on foot. */ }
      else if (typeof override === 'string' && places.get(override)?.kind === 'parking') parkingPath = override;
      else issues.push('Choose a saved parking location or explicitly use on foot for ' + source.name + '.');
    } else {
      const parking = resolveParking(source, allPlaces);
      if ((parking.status === 'preferred' || parking.status === 'single') && parking.destination?.kind === 'parking') parkingPath = parking.destination.path;
      else if (parking.status === 'choice' || parking.status === 'invalid' || (parking.status === 'single' && !parking.destination)) {
        issues.push('Choose parking or explicitly use on foot for ' + source.name + ': its parking is ambiguous or has no usable location.');
      }
    }
    const key = parkingPath ? 'parking:' + parkingPath : 'source:' + selected.path;
    let group = grouped.get(key);
    if (!group) { group = { id: 'group:' + key, parkingPath, stops: [] }; grouped.set(key, group); }
    group.stops.push({ id: 'stop:source:' + selected.path, sourcePath: selected.path, status: 'pending' });
  }
  return { groups: [...grouped.values()], issues };
}

const lexical = (a: string, b: string): number => a === b ? 0 : a < b ? -1 : 1;
const done = (stop: OutingStop): boolean => stop.status !== 'pending';
function sourceCoordinates(path: string, places: PlaceRecord[]): Coordinates | null {
  const source = places.find(place => place.path === path && place.kind === 'shop');
  return validateCoordinates(source?.coordinates);
}
function groupCoordinates(group: OutingGroup, places: PlaceRecord[]): Coordinates | null {
  if (group.parkingPath) return validateCoordinates(places.find(place => place.path === group.parkingPath && place.kind === 'parking')?.coordinates);
  const first = group.stops.find(stop => !done(stop));
  return first ? sourceCoordinates(first.sourcePath, places) : null;
}
function nearest<T>(items: T[], origin: Coordinates, coordinates: (item: T) => Coordinates | null, key: (item: T) => string): { ordered: T[]; manual: T[] } {
  const candidates = items.filter(item => coordinates(item)), manual = items.filter(item => !coordinates(item)), ordered: T[] = [];
  let current = origin;
  while (candidates.length) {
    candidates.sort((a, b) => haversineKm(current, coordinates(a)!) - haversineKm(current, coordinates(b)!) || lexical(key(a), key(b)));
    const next = candidates.shift()!; ordered.push(next); current = coordinates(next)!;
  }
  return { ordered, manual };
}
function fillPending<T>(original: T[], pending: T[], frozen: (item: T) => boolean): T[] {
  let index = 0;
  return original.map(item => frozen(item) ? item : pending[index++]!);
}

/** Straight-line nearest-next proposal, retaining groups with recorded progress at their indices. */
export function suggestOutingOrder(groups: OutingGroup[], allPlaces: PlaceRecord[], firstGroupId?: string): OrderSuggestion {
  const frozen = (group: OutingGroup): boolean => group.stops.some(done);
  const pending = groups.filter(group => !frozen(group));
  if (!pending.length) return { groups: [...groups], warnings: [] };
  const first = firstGroupId ? pending.find(group => group.id === firstGroupId) : pending[0];
  if (!first) return { groups: [...groups], warnings: ['Choose a pending first group; groups with recorded progress keep their positions.'] };
  const origin = groupCoordinates(first, allPlaces);
  if (!origin) return { groups: [...groups], warnings: ['The first group has no usable coordinates. Choose another first group or keep a manual order.'] };
  const result = nearest(pending.filter(group => group !== first), origin, group => groupCoordinates(group, allPlaces), group => group.parkingPath || group.stops[0]?.sourcePath || group.id);
  const warnings = result.manual.map(group => 'No usable coordinates for group ' + group.id + '; keep it in manual order.');
  if (groups.some(frozen)) warnings.unshift('Groups with visited or skipped stops keep their positions.');
  return { groups: fillPending(groups, [first, ...result.ordered, ...result.manual], frozen), warnings };
}

/** Parking is the walking anchor unless a pending first source is explicitly chosen. */
export function suggestWalkingOrder(group: OutingGroup, allPlaces: PlaceRecord[], firstStopId?: string): WalkingSuggestion {
  const pending = group.stops.filter(stop => !done(stop));
  if (!pending.length) return { group: { ...group, stops: [...group.stops] }, warnings: [] };
  const first = firstStopId ? pending.find(stop => stop.id === firstStopId) : undefined;
  if (firstStopId && !first) return { group: { ...group, stops: [...group.stops] }, warnings: ['Choose a pending first source; visited and skipped stops keep their positions.'] };
  const defaultFirst = !first && !group.parkingPath ? pending[0] : undefined;
  const anchor = first ?? defaultFirst;
  const origin = anchor ? sourceCoordinates(anchor.sourcePath, allPlaces) : groupCoordinates(group, allPlaces);
  if (!origin) return { group: { ...group, stops: [...group.stops] }, warnings: ['No usable walking start coordinates. Choose a first source with coordinates or keep a manual order.'] };
  const result = nearest(pending.filter(stop => stop !== anchor), origin, stop => sourceCoordinates(stop.sourcePath, allPlaces), stop => stop.sourcePath);
  const warnings = result.manual.map(stop => 'No usable coordinates for ' + stop.sourcePath + '; keep it in manual order.');
  if (group.stops.some(done)) warnings.unshift('Visited and skipped stops keep their positions.');
  return { group: { ...group, stops: fillPending(group.stops, [...(anchor ? [anchor] : []), ...result.ordered, ...result.manual], done) }, warnings };
}

function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

/** Read the notebook's known captured-hours and visit formats; never infer opening status. */
export function extractSourceContext(text: string): SourceContext {
  let body = text;
  try { body = readNote(text).body; } catch { /* Preserve readable personal context. */ }
  body = body.replace(/\r\n/g, '\n');
  const captured = readGoogleHours(text);
  const hours = validGoogleHours(captured.hours);
  const context: SourceContext = { hours, hoursChecked: hours.length ? captured.checked : '', reminder: '', reminderDate: '' };
  const heading = /^## Visit log[ \t]*\n/m.exec(body);
  if (!heading) return context;
  const tail = body.slice(heading.index + heading[0].length), end = /^##[ \t]+/m.exec(tail);
  const log = end ? tail.slice(0, end.index) : tail;
  const entries = [...log.matchAll(/^###[ \t]+([^\n]+)\n/gm)];
  const reminders: { recorded: string; date: string; text: string; position: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!, recorded = entry[1]!.trim();
    if (!/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(recorded) || !validDate(recorded.slice(0, 10))) continue;
    const content = log.slice(entry.index! + entry[0].length, entries[i + 1]?.index ?? log.length);
    const visit = /^[ \t\n]*Visit date: (\d{4}-\d{2}-\d{2})[ \t]*(?:\n|$)/.exec(content);
    const date = validDate(visit?.[1]); if (!date) continue;
    const next = /^\*\*Next time\*\*[ \t]*\n/m.exec(content); if (!next) continue;
    const rest = content.slice(next.index + next[0].length), nextField = /^\*\*(?:Observations|Useful finds|Next time)\*\*[ \t]*$/m.exec(rest);
    const reminder = (nextField ? rest.slice(0, nextField.index) : rest).trim();
    if (reminder) reminders.push({ recorded, date, text: reminder, position: i });
  }
  reminders.sort((a, b) => lexical(b.recorded, a.recorded) || a.position - b.position);
  if (reminders[0]) { context.reminder = reminders[0].text; context.reminderDate = reminders[0].date; }
  return context;
}
