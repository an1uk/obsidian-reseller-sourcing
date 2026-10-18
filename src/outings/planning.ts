import { haversineKm, validateCoordinates } from '../domain/coordinates';
import type { Coordinates, PlaceRecord } from '../types';
import type { JourneyEstimate, OutingGroup, OutingOptimisationPreview, OutingPlanningOptions, OutingRecord, OutingStop, PlanningAnchor, PlanningHours } from './types';

const MINUTE = 60_000, DAY = 86_400_000;
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const cleanPath = (path: string): string => path.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.replace(/\.md$/i, '');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const finite = (value: unknown, min: number, max: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(label + ' is outside its supported range.');
  return value;
};
function dateString(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00Z')) ||
    new Date(value + 'T00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Choose a valid outing date.');
  return value;
}
function timeString(value: unknown, allowEnd = false): string {
  if (typeof value !== 'string' || !(allowEnd && value === '24:00') && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Use a valid time in HH:MM format.');
  return value;
}
function anchorValue(value: unknown): PlanningAnchor {
  const anchor = value as PlanningAnchor;
  if (!anchor || typeof anchor !== 'object') throw new Error('Choose a starting point or endpoint.');
  if (anchor.kind === 'record' && typeof anchor.path === 'string' && anchor.path.trim() && !anchor.path.includes('#')) return { kind: 'record', path: anchor.path.trim() };
  if (anchor.kind === 'coordinates') {
    const coordinates = validateCoordinates(anchor.coordinates);
    if (coordinates) return { kind: 'coordinates', coordinates, ...(typeof anchor.label === 'string' ? { label: anchor.label.slice(0, 200) } : {}) };
  }
  throw new Error('Choose a saved place or valid coordinates for the endpoint.');
}
export function defaultPlanningOptions(now = new Date()): OutingPlanningOptions {
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return { mode: 'hours', date, departureTime: '09:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    start: null, end: { kind: 'last' }, defaultVisitMinutes: 20, stopOverrides: {},
    estimates: { driveMultiplier: 1.4, driveKph: 30, walkMultiplier: 1.2, walkKph: 4.5, parkingMinutes: 5 } };
}
export function validatePlanningOptions(value: unknown): OutingPlanningOptions {
  const input = value as OutingPlanningOptions;
  if (!input || typeof input !== 'object' || !['hours', 'distance'].includes(input.mode)) throw new Error('Choose a journey planning mode.');
  const date = dateString(input.date), departureTime = timeString(input.departureTime);
  if (typeof input.timeZone !== 'string' || !input.timeZone.trim()) throw new Error('Choose a supported time zone.');
  try { new Intl.DateTimeFormat('en-GB', { timeZone: input.timeZone }).format(); } catch { throw new Error('Choose a supported time zone.'); }
  const end = input.end?.kind === 'return' || input.end?.kind === 'last' ? { kind: input.end.kind } as OutingPlanningOptions['end'] : anchorValue(input.end);
  const estimates = input.estimates;
  if (!estimates || typeof estimates !== 'object') throw new Error('Provide journey estimation assumptions.');
  const stopOverrides: OutingPlanningOptions['stopOverrides'] = {};
  if (!input.stopOverrides || typeof input.stopOverrides !== 'object' || Array.isArray(input.stopOverrides)) throw new Error('Visit overrides must be a keyed list.');
  for (const [key, override] of Object.entries(input.stopOverrides)) {
    if (!override || typeof override !== 'object') throw new Error('A visit override is invalid.');
    const result: OutingPlanningOptions['stopOverrides'][string] = {};
    if (override.visitMinutes !== undefined) result.visitMinutes = finite(override.visitMinutes, 1, 1440, 'Visit duration');
    if (override.hours !== undefined) {
      if (typeof override.hours.closed !== 'boolean' || !Array.isArray(override.hours.intervals) || override.hours.intervals.length > 12) throw new Error('Opening-hours override is invalid.');
      result.hours = { closed: override.hours.closed, intervals: override.hours.intervals.map(interval => ({ open: timeString(interval.open), close: timeString(interval.close, true) })) };
      if (!result.hours.closed && !result.hours.intervals.length) throw new Error('Add an opening period or mark this source closed.');
      if (result.hours.intervals.some(interval => interval.open === interval.close)) throw new Error('Opening and closing times cannot be identical.');
    }
    Object.defineProperty(stopOverrides, key, { value: result, enumerable: true, configurable: true, writable: true });
  }
  const output: OutingPlanningOptions = { mode: input.mode, date, departureTime, timeZone: input.timeZone,
    start: input.start === null ? null : anchorValue(input.start), end,
    defaultVisitMinutes: finite(input.defaultVisitMinutes, 1, 1440, 'Default visit duration'), stopOverrides,
    estimates: { driveMultiplier: finite(estimates.driveMultiplier, 1, 10, 'Driving distance multiplier'),
      driveKph: finite(estimates.driveKph, 1, 200, 'Driving speed'), walkMultiplier: finite(estimates.walkMultiplier, 1, 10, 'Walking distance multiplier'),
      walkKph: finite(estimates.walkKph, 0.5, 20, 'Walking speed'), parkingMinutes: finite(estimates.parkingMinutes, 0, 120, 'Parking allowance') } };
  if (input.latestFinishTime) output.latestFinishTime = timeString(input.latestFinishTime);
  return output;
}
export function resolvePlanningAnchor(anchor: PlanningAnchor | null, places: readonly PlaceRecord[]): Coordinates | null {
  if (!anchor) return null;
  if (anchor.kind === 'coordinates') return validateCoordinates(anchor.coordinates);
  const matches = places.filter(place => cleanPath(place.path) === cleanPath(anchor.path));
  return matches.length === 1 ? validateCoordinates(matches[0]!.coordinates) : null;
}
function formatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
function localParts(epoch: number, format: Intl.DateTimeFormat): number[] {
  const fields = Object.fromEntries(format.formatToParts(epoch).map(part => [part.type, part.value]));
  return ['year', 'month', 'day', 'hour', 'minute'].map(key => Number(fields[key]));
}
/** Find every instant for a wall time: zero means DST gap, two means overlap. */
export function planningWallTimeInstants(date: string, time: string, zone: string): number[] {
  const format = formatter(zone), target = [...date.split('-').map(Number), ...time.split(':').map(Number)], guess = Date.UTC(target[0]!, target[1]! - 1, target[2]!, target[3]!, target[4]!);
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 3) {
    const epoch = guess + delta * 3_600_000, parts = localParts(epoch, format);
    offsets.add(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!) - epoch);
  }
  return [...offsets].map(offset => guess - offset).filter(epoch => localParts(epoch, format).every((part, index) => part === target[index])).sort((a, b) => a - b);
}
export function formatPlanningTime(epoch: number, options: Pick<OutingPlanningOptions, 'timeZone'>): string {
  if (!Number.isFinite(epoch)) return 'Unavailable';
  return new Intl.DateTimeFormat('en-GB', { timeZone: options.timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(epoch);
}
interface DayHours { known: boolean; intervals: { open: number; close: number }[]; }
interface SourceHours { known: boolean; intervals: { open: number; close: number }[]; checked: string; }
function clockMinutes(text: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2] ?? 0), meridiem = match[3]?.toLowerCase();
  if (minute > 59 || meridiem && (hour < 1 || hour > 12) || !meridiem && (!match[2] || hour > 24 || hour === 24 && minute !== 0)) return null;
  if (meridiem) hour = hour % 12 + (meridiem === 'pm' ? 12 : 0);
  return hour * 60 + minute;
}
/** Conservative English row parser; unknown prose never becomes an opening promise. */
export function parsePlanningHours(rows: readonly string[], day: string): DayHours {
  const matches = rows.filter(row => new RegExp('^' + day + '\\b', 'i').test(row.trim()));
  if (matches.length !== 1) return { known: false, intervals: [] };
  const raw = matches[0]!.trim().replace(new RegExp('^' + day + '\\s*[:,]?\\s*', 'i'), '').replace(/[\u00a0\u202f]/g, ' ').trim();
  if (/^closed$/i.test(raw)) return { known: true, intervals: [] };
  if (/^(?:open\s+)?24\s+hours?$/i.test(raw)) return { known: true, intervals: [{ open: 0, close: 1440 }] };
  const pieces = raw.split(/\s*(?:,|;|\band\b)\s*/i), intervals: DayHours['intervals'] = [];
  for (const piece of pieces) {
    const pair = piece.split(/\s*(?:[\u2010-\u2015-]|\bto\b)\s*/i);
    if (pair.length !== 2) return { known: false, intervals: [] };
    const open = clockMinutes(pair[0]!), close = clockMinutes(pair[1]!);
    if (open === null || close === null || open >= 1440 || open === close) return { known: false, intervals: [] };
    intervals.push({ open, close: close <= open ? close + 1440 : close });
  }
  return { known: intervals.length > 0, intervals };
}
function adjacentDate(date: string, days: number): string { return new Date(Date.parse(date + 'T00:00Z') + days * DAY).toISOString().slice(0, 10); }
function epochAtMinute(date: string, minute: number, zone: string): number | null {
  const next = adjacentDate(date, Math.floor(minute / 1440)), within = minute % 1440;
  const time = String(Math.floor(within / 60)).padStart(2, '0') + ':' + String(within % 60).padStart(2, '0');
  const values = planningWallTimeInstants(next, time, zone);
  return values.length === 1 ? values[0]! : null;
}
function hoursFor(stop: OutingStop, hours: Record<string, PlanningHours>, options: OutingPlanningOptions): SourceHours {
  const override = options.stopOverrides[stop.id]?.hours, captured = hours[stop.sourcePath] ?? { hours: [], hoursChecked: '' };
  const date = options.date, weekday = new Date(date + 'T00:00Z').getUTCDay();
  const today: DayHours = override ? { known: true, intervals: override.closed ? [] : override.intervals.map(interval => {
    const open = Number(interval.open.slice(0, 2)) * 60 + Number(interval.open.slice(3));
    let close = Number(interval.close.slice(0, 2)) * 60 + Number(interval.close.slice(3)); if (close <= open) close += 1440;
    return { open, close };
  }) } : parsePlanningHours(captured.hours, dayNames[weekday]!);
  const previous = override ? { known: false, intervals: [] } : parsePlanningHours(captured.hours, dayNames[(weekday + 6) % 7]!);
  const intervals: SourceHours['intervals'] = [];
  let known = today.known;
  for (const row of [{ date, hours: today, prior: false }, { date: adjacentDate(date, -1), hours: previous, prior: true }]) {
    for (const interval of row.hours.intervals) {
      if (row.prior && interval.close <= 1440) continue;
      const open = epochAtMinute(row.date, interval.open, options.timeZone), close = epochAtMinute(row.date, interval.close, options.timeZone);
      if (open === null || close === null || close <= open) { known = false; continue; }
      intervals.push({ open, close });
    }
  }
  return { known, intervals: intervals.sort((a, b) => a.open - b.open), checked: override ? 'Outing override' : captured.hoursChecked };
}
const cloneGroups = (groups: readonly OutingGroup[]): OutingGroup[] => groups.map(group => ({ ...group, stops: group.stops.map(stop => ({ ...stop })) }));
const frozenGroup = (group: OutingGroup): boolean => group.stops.some(stop => stop.status !== 'pending');
const fillPending = <T>(original: T[], pending: T[], frozen: (item: T) => boolean): T[] => { let index = 0; return original.map(item => frozen(item) ? item : pending[index++]!); };
function emptyEstimate(startAt = NaN): JourneyEstimate { return { drivingKm: 0, walkingKm: 0, totalKm: 0, totalMinutes: 0, waitingMinutes: 0, openingConflicts: 0, unconfirmedHours: 0, startAt, finishAt: startAt, latestFinishMissed: false, timeline: [] }; }
export function buildOutingOptimisationPreview(record: OutingRecord, places: readonly PlaceRecord[], hours: Record<string, PlanningHours>, input: OutingPlanningOptions): OutingOptimisationPreview {
  const options = validatePlanningOptions(input), warnings: string[] = [], blockers: string[] = [], groups = cloneGroups(record.groups);
  const byPath = new Map(places.map(place => [place.path, place]));
  const start = resolvePlanningAnchor(options.start, places), end = options.end.kind === 'last' ? null : options.end.kind === 'return' ? start : resolvePlanningAnchor(options.end, places);
  if (!start) blockers.push('Choose a starting point with valid coordinates.');
  if (options.end.kind !== 'last' && !end) blockers.push('Choose a finishing point with valid coordinates.');
  if (record.draft || record.operation) blockers.push('Finish or discard the unfinished outing visit before applying a journey plan.');
  const instants = planningWallTimeInstants(options.date, options.departureTime, options.timeZone);
  if (instants.length !== 1) blockers.push(instants.length ? 'Departure time is ambiguous during a daylight-saving clock change. Choose another time.' : 'Departure time does not exist during a daylight-saving clock change. Choose another time.');
  const startAt = instants[0] ?? NaN;
  const latest = options.latestFinishTime ? planningWallTimeInstants(options.date, options.latestFinishTime, options.timeZone) : [];
  if (options.latestFinishTime && latest.length !== 1) blockers.push('Latest finishing time is ambiguous or does not exist. Choose another time.');
  if (latest[0] !== undefined && latest[0] < startAt) blockers.push('Latest finishing time must follow departure on the outing date.');
  const point = (path: string, kind?: 'shop' | 'parking'): Coordinates | null => {
    const place = byPath.get(path); return place && (!kind || place.kind === kind) ? validateCoordinates(place.coordinates) : null;
  };
  const pending = (group: OutingGroup): OutingStop[] => group.stops.filter(stop => stop.status === 'pending');
  const anchor = (group: OutingGroup): Coordinates | null => group.parkingPath ? point(group.parkingPath, 'parking') : point(pending(group)[0]?.sourcePath ?? '', 'shop');
  const sourceHours = new Map<string, SourceHours>();
  const relevant = new Set<string>();
  for (const group of groups) {
    if (!pending(group).length) continue;
    if (group.parkingPath) relevant.add(group.parkingPath);
    if (!anchor(group)) blockers.push(group.parkingPath ? 'Selected parking is missing or has invalid coordinates for ' + group.id + '; a source pin will not be substituted.' : 'The first pending source has no valid coordinates in ' + group.id + '.');
    for (const stop of pending(group)) {
      relevant.add(stop.sourcePath);
      if (!point(stop.sourcePath, 'shop')) blockers.push('Source has no usable coordinates: ' + stop.sourcePath + '.');
      sourceHours.set(stop.id, hoursFor(stop, hours, options));
    }
  }
  for (const value of [options.start, options.end]) if (value?.kind === 'record') {
    const found = places.find(place => cleanPath(place.path) === cleanPath(value.path)); if (found) relevant.add(found.path);
  }
  if (!groups.some(group => pending(group).length)) blockers.push('There are no remaining sources to plan.');
  if (groups.some(frozenGroup)) warnings.push('Visited and skipped stops retain their positions; groups with progress stay in place. Estimates cover remaining visits only.');
  warnings.push('Local estimates use straight-line distances and your assumptions, not road routing or live traffic.');
  warnings.push('Opening hours are a dated snapshot; holiday and exceptional opening must be checked.');
  const evaluate = (order: OutingGroup[]): JourneyEstimate => {
    const result = emptyEstimate(startAt); let current = start!, now = startAt;
    const travel = (a: Coordinates, b: Coordinates, walking: boolean): void => {
      const km = haversineKm(a, b) * (walking ? options.estimates.walkMultiplier : options.estimates.driveMultiplier);
      if (walking) result.walkingKm += km; else result.drivingKm += km;
      now += km / (walking ? options.estimates.walkKph : options.estimates.driveKph) * 60 * MINUTE;
    };
    for (const group of order) {
      const remaining = pending(group); if (!remaining.length) continue;
      const location = anchor(group)!; travel(current, location, false); current = location;
      if (group.parkingPath) now += options.estimates.parkingMinutes * MINUTE;
      let walking = location;
      for (const stop of remaining) {
        const destination = point(stop.sourcePath, 'shop')!;
        travel(walking, destination, true); walking = destination;
        const arrival = now, visitMinutes = options.stopOverrides[stop.id]?.visitMinutes ?? options.defaultVisitMinutes;
        const snapshot = sourceHours.get(stop.id)!;
        const interval = snapshot.intervals.find(interval => Math.max(now, interval.open) + visitMinutes * MINUTE <= interval.close);
        let status: 'open' | 'closed' | 'unconfirmed';
        if (interval) { now = Math.max(now, interval.open); status = 'open'; }
        else status = snapshot.known ? 'closed' : 'unconfirmed';
        const waitMinutes = (now - arrival) / MINUTE, visitStarts = now;
        now += visitMinutes * MINUTE;
        result.waitingMinutes += waitMinutes;
        if (status === 'closed') result.openingConflicts++;
        if (status === 'unconfirmed') result.unconfirmedHours++;
        result.timeline.push({ groupId: group.id, stopId: stop.id, sourcePath: stop.sourcePath, arrival, visitStarts, departure: now, waitMinutes, visitMinutes, hoursStatus: status, hoursChecked: snapshot.checked });
      }
      // A parking group always returns to its car, even when the next group is nearby.
      if (group.parkingPath) { travel(walking, location, true); current = location; }
      else current = walking;
    }
    if (end) travel(current, end, false);
    result.totalKm = result.drivingKm + result.walkingKm; result.finishAt = now; result.totalMinutes = (now - startAt) / MINUTE;
    result.latestFinishMissed = latest[0] !== undefined && now > latest[0];
    return result;
  };
  let current = emptyEstimate(startAt), proposed = current, best = groups;
  if (!blockers.some(message => !message.startsWith('Finish or discard'))) {
    current = evaluate(groups); proposed = current;
    const score = (estimate: JourneyEstimate): number[] => options.mode === 'distance'
      ? [estimate.totalKm, estimate.waitingMinutes, estimate.finishAt]
      : [estimate.openingConflicts, estimate.latestFinishMissed ? 1 : 0, estimate.totalKm, estimate.waitingMinutes, estimate.finishAt];
    const better = (a: JourneyEstimate, b: JourneyEstimate): boolean => {
      const x = score(a), y = score(b);
      for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]! - y[i]!) < 1e-8) continue; return x[i]! < y[i]!; } return false;
    };
    let budget = 700;
    const consider = (candidate: OutingGroup[]): boolean => {
      if (--budget < 0) return false;
      const estimate = evaluate(candidate);
      if (better(estimate, proposed)) { best = candidate; proposed = estimate; return true; } return false;
    };
    const editable = groups.filter(group => !frozenGroup(group));
    const nearestGroups = (first?: OutingGroup): OutingGroup[] => {
      const remaining = editable.filter(group => group !== first), ordered = first ? [first] : []; let origin = first ? anchor(first)! : start!;
      while (remaining.length) {
        remaining.sort((a, b) => haversineKm(origin, anchor(a)!) - haversineKm(origin, anchor(b)!) || a.id.localeCompare(b.id));
        const next = remaining.shift()!; ordered.push(next); origin = anchor(next)!;
      }
      return fillPending(groups, ordered, frozenGroup);
    };
    consider(nearestGroups());
    for (const first of editable.slice(0, 12)) consider(nearestGroups(first));
    const walkingNearest = (order: OutingGroup[]): OutingGroup[] => order.map(group => {
      const remaining = pending(group), ordered: OutingStop[] = []; let origin = anchor(group)!;
      while (remaining.length) {
        remaining.sort((a, b) => haversineKm(origin, point(a.sourcePath)!) - haversineKm(origin, point(b.sourcePath)!) || a.id.localeCompare(b.id));
        const next = remaining.shift()!; ordered.push(next); origin = point(next.sourcePath)!;
      }
      return { ...group, stops: fillPending(group.stops, ordered, stop => stop.status !== 'pending') };
    });
    consider(walkingNearest(best));
    for (let pass = 0; pass < 5 && budget > 0; pass++) {
      let improved = false;
      const movable = best.map((group, index) => !frozenGroup(group) ? index : -1).filter(index => index >= 0);
      for (let i = 0; i < movable.length && budget > 0; i++) for (let j = i + 1; j < movable.length && budget > 0; j++) {
        const candidate = cloneGroups(best), selected = movable.slice(i, j + 1), reversed = selected.map(index => candidate[index]!).reverse();
        selected.forEach((index, k) => { candidate[index] = reversed[k]!; }); improved = consider(candidate) || improved;
      }
      for (let gi = 0; gi < best.length && budget > 0; gi++) {
        const positions = best[gi]!.stops.map((stop, index) => stop.status === 'pending' ? index : -1).filter(index => index >= 0);
        for (let i = 0; i < positions.length && budget > 0; i++) for (let j = i + 1; j < positions.length && budget > 0; j++) {
          const candidate = cloneGroups(best), stops = candidate[gi]!.stops, a = positions[i]!, b = positions[j]!;
          [stops[a], stops[b]] = [stops[b]!, stops[a]!]; improved = consider(candidate) || improved;
        }
      }
      if (!improved) break;
    }
    if ([...sourceHours.values()].some(snapshot => snapshot.known && !snapshot.checked)) warnings.push('Some recognised opening hours have no checked date; confirm them before travelling.');
    if (proposed.unconfirmedHours) warnings.push(proposed.unconfirmedHours + ' remaining source(s): Hours unconfirmed.');
    if (proposed.openingConflicts) warnings.push(proposed.openingConflicts + ' remaining visit(s) do not fit known opening hours; no source has been removed.');
    if (proposed.latestFinishMissed) warnings.push('The proposed journey finishes after your latest finishing time.');
  }
  const fingerprint = JSON.stringify(canonical({ record: { id: record.id, path: record.path, revision: record.revision, groups: record.groups, draft: record.draft ?? null, operation: record.operation ?? null },
    options, places: [...relevant].sort().map(path => ({ path, kind: byPath.get(path)?.kind ?? null, coordinates: point(path) })),
    hours: groups.flatMap(group => pending(group)).map(stop => ({ stopId: stop.id, path: stop.sourcePath, hours: hours[stop.sourcePath] ?? null })) }));
  return { fingerprint, options, groups: cloneGroups(best), current, proposed, warnings, blockers: [...new Set(blockers)] };
}
