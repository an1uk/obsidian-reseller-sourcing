import { haversineKm, resolveParking, validateCoordinates } from '../domain';
import type { LocalityRecord, PlaceRecord } from '../types';
import { defaultPlaceQuery, queryPlaces } from '../workspace/place-query';
import { buildOutingOptimisationPreview, defaultPlanningOptions, resolvePlanningAnchor, validatePlanningOptions } from './planning';
import type { JourneyEstimate, OutingGroup, OutingPlanningOptions, OutingRecord, PlanningHours } from './types';

/** Raw fields preserve incomplete edits without turning them into a valid planning promise. */
export interface ShortTripForm {
  startKind: 'record' | 'coordinates'; savedPath: string; latitude: string; longitude: string;
  budgetMinutes: string; maxStops: string; date: string; departureTime: string; timeZone: string; visitMinutes: string;
}
export interface ShortTripOptions {
  budgetMinutes: number; maxStops: number; areaPath: string; shortlist: boolean;
  planning: OutingPlanningOptions; form?: ShortTripForm;
}
export interface ShortTripPreview {
  fingerprint: string; options: ShortTripOptions; groups: OutingGroup[]; planning: OutingPlanningOptions;
  estimate: JourneyEstimate | null; warnings: string[]; blockers: string[];
  excluded: { coordinates: number; parking: number; duplicate: number };
  candidateCount: number; evaluatedCount: number;
}
const MAX_CANDIDATES = 24;
const lexical = (a: string, b: string): number => a === b ? 0 : a < b ? -1 : 1;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => lexical(a, b)).map(([key, item]) => [key, canonical(item)])) : value;
const bounded = (value: unknown, min: number, max: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw Error(label + ' must be a whole number from ' + min + ' to ' + max + '.');
  return value;
};
export function shortTripForm(options: ShortTripOptions): ShortTripForm {
  if (options.form) return structuredClone(options.form);
  const p = options.planning, start = p.start;
  return { startKind: start?.kind === 'coordinates' ? 'coordinates' : 'record', savedPath: start?.kind === 'record' ? start.path : '',
    latitude: start?.kind === 'coordinates' ? String(start.coordinates[0]) : '', longitude: start?.kind === 'coordinates' ? String(start.coordinates[1]) : '',
    budgetMinutes: String(options.budgetMinutes), maxStops: String(options.maxStops), date: p.date, departureTime: p.departureTime, timeZone: p.timeZone, visitMinutes: String(p.defaultVisitMinutes) };
}
export function defaultShortTripOptions(now = new Date()): ShortTripOptions {
  const planning = defaultPlanningOptions(now);
  planning.departureTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return { budgetMinutes: 60, maxStops: 3, areaPath: '', shortlist: false, planning };
}
export function validateShortTripOptions(value: unknown): ShortTripOptions {
  const input = value as ShortTripOptions;
  if (!input || typeof input !== 'object' || typeof input.areaPath !== 'string' || input.areaPath.length > 1000 || typeof input.shortlist !== 'boolean') throw Error('Short-trip settings are invalid.');
  const result: ShortTripOptions = { budgetMinutes: bounded(input.budgetMinutes, 1, 1440, 'Available minutes'), maxStops: bounded(input.maxStops, 1, 5, 'Maximum stops'),
    areaPath: input.areaPath, shortlist: input.shortlist, planning: validatePlanningOptions(input.planning) };
  if (input.form !== undefined) {
    const form = input.form;
    if (!form || typeof form !== 'object' || !['record', 'coordinates'].includes(form.startKind)) throw Error('Starting point fields are invalid.');
    const fields = ['savedPath', 'latitude', 'longitude', 'budgetMinutes', 'maxStops', 'date', 'departureTime', 'timeZone', 'visitMinutes'] as const;
    if (fields.some(key => typeof form[key] !== 'string' || form[key].length > (key === 'savedPath' ? 1000 : 200))) throw Error('Short-trip fields are invalid.');
    result.form = { startKind: form.startKind, ...Object.fromEntries(fields.map(key => [key, form[key]])) } as ShortTripForm;
  }
  return result;
}
export function isShortTripOptions(value: unknown): value is ShortTripOptions { try { validateShortTripOptions(value); return true; } catch { return false; } }
/** Only an explicit preview promotes raw field text into validated planning inputs. */
export function materialiseShortTripOptions(value: ShortTripOptions): ShortTripOptions {
  const input = validateShortTripOptions(value), form = shortTripForm(input), p = input.planning;
  const latitude = form.latitude.trim(), longitude = form.longitude.trim();
  const start = form.startKind === 'record' ? form.savedPath ? { kind: 'record' as const, path: form.savedPath } : null
    : { kind: 'coordinates' as const, coordinates: [latitude ? Number(latitude) : NaN, longitude ? Number(longitude) : NaN] as [number, number], label: 'Entered starting point' };
  const planning = validatePlanningOptions({ ...p, mode: 'hours', date: form.date, departureTime: form.departureTime, timeZone: form.timeZone,
    defaultVisitMinutes: Number(form.visitMinutes), start, stopOverrides: {} });
  return { ...input, budgetMinutes: bounded(Number(form.budgetMinutes), 1, 1440, 'Available minutes'),
    maxStops: bounded(Number(form.maxStops), 1, 5, 'Maximum stops'), planning, form };
}
interface Candidate { source: PlaceRecord; parking: PlaceRecord; distance: number; }
function candidateSelection(places: readonly PlaceRecord[], areas: readonly LocalityRecord[], options: ShortTripOptions) {
  const start = resolvePlanningAnchor(options.planning.start, places), excluded = { coordinates: 0, parking: 0, duplicate: 0 };
  const counts = new Map<string, number>();
  for (const place of places) counts.set(place.path, (counts.get(place.path) ?? 0) + 1);
  const uniquePlaces = places.filter(place => counts.get(place.path) === 1);
  const query = { ...defaultPlaceQuery(), area: options.areaPath, shortlist: options.shortlist };
  const matching = queryPlaces(places, areas, new Set(), query).places;
  const candidates: Candidate[] = [];
  for (const source of matching) {
    if (counts.get(source.path) !== 1) { excluded.duplicate++; continue; }
    if (!validateCoordinates(source.coordinates)) { excluded.coordinates++; continue; }
    const parking = resolveParking(source, [...uniquePlaces]);
    if (!['preferred', 'single'].includes(parking.status) || parking.destination?.kind !== 'parking' || !validateCoordinates(parking.destination.coordinates)) { excluded.parking++; continue; }
    candidates.push({ source, parking: parking.destination, distance: start ? haversineKm(start, parking.destination.coordinates!) + haversineKm(parking.destination.coordinates!, source.coordinates!) : 0 });
  }
  candidates.sort((a, b) => a.distance - b.distance || lexical(a.source.path, b.source.path));
  return { candidates, excluded, uniquePlaces };
}
/** Read captured hours only for the bounded set that can take part in this suggestion. */
export function shortTripHoursSources(places: readonly PlaceRecord[], areas: readonly LocalityRecord[], value: ShortTripOptions): PlaceRecord[] {
  return candidateSelection(places, areas, materialiseShortTripOptions(value)).candidates.slice(0, MAX_CANDIDATES).map(item => item.source);
}
/** Bounded greedy extension: at most 24 + 23 + ... + 20 planner calls, never a subset search. */
export function buildShortTripPreview(places: readonly PlaceRecord[], areas: readonly LocalityRecord[], hours: Record<string, PlanningHours>, value: ShortTripOptions): ShortTripPreview {
  const options = materialiseShortTripOptions(value), planning = options.planning, start = resolvePlanningAnchor(planning.start, places);
  const warnings = ['Estimates use straight-line distances and local assumptions, not road routing or live traffic.',
    'This driving suggestion uses saved parking only. Each parking group includes walking back to the car.',
    'Opening hours are a dated snapshot. Check exceptional and holiday opening before travelling.'];
  const blockers: string[] = [];
  if (!start) blockers.push('Choose a saved starting point with valid coordinates, or enter latitude and longitude.');
  if (options.areaPath && options.areaPath !== 'unassigned' && !areas.some(area => area.path === options.areaPath)) blockers.push('The selected area is unavailable. Choose an area again.');
  const { candidates, excluded, uniquePlaces } = candidateSelection(places, areas, options);
  const nearby = candidates.slice(0, MAX_CANDIDATES);
  if (candidates.length > MAX_CANDIDATES) warnings.push('Considering the 24 closest eligible sources. This small suggestion is not an exhaustive route search.');
  if (excluded.coordinates) warnings.push(excluded.coordinates + ' source(s) excluded because coordinates are missing or invalid.');
  if (excluded.parking) warnings.push(excluded.parking + ' source(s) excluded because saved parking is missing, ambiguous or has no valid coordinates. Choose parking in standard outing preparation to include them.');
  if (excluded.duplicate) warnings.push(excluded.duplicate + ' ambiguous source record(s) excluded.');
  const fingerprint = JSON.stringify(canonical({ options, areas: [...areas].sort((a, b) => lexical(a.path, b.path)),
    places: [...places].sort((a, b) => lexical(a.path, b.path)).map(place => ({ path: place.path, name: place.name, kind: place.kind, locality: place.locality, coordinates: place.coordinates,
      closed: place.properties.shop_closed, shortlist: place.properties.shortlist, preferred: place.properties.parking_location, parkingFor: place.properties.parking_for })),
    hours: Object.fromEntries(Object.entries(hours).sort(([a], [b]) => lexical(a, b))) }));
  const result: ShortTripPreview = { fingerprint, options, planning, groups: [], estimate: null, warnings, blockers, excluded, candidateCount: candidates.length, evaluatedCount: 0 };
  if (blockers.length) return result;
  const groupsFor = (chosen: Candidate[]): OutingGroup[] => {
    const groups = new Map<string, OutingGroup>();
    for (const item of chosen) {
      let group = groups.get(item.parking.path);
      if (!group) { group = { id: 'short-trip:parking:' + item.parking.path, parkingPath: item.parking.path, stops: [] }; groups.set(item.parking.path, group); }
      group.stops.push({ id: 'short-trip:source:' + item.source.path, sourcePath: item.source.path, status: 'pending' });
    }
    return [...groups.values()];
  };
  let selected: Candidate[] = [];
  for (let depth = 0; depth < options.maxStops; depth++) {
    let best: { chosen: Candidate[]; groups: OutingGroup[]; estimate: JourneyEstimate; warnings: string[] } | undefined;
    for (const candidate of nearby) {
      if (selected.some(item => item.source.path === candidate.source.path)) continue;
      const chosen = [...selected, candidate], groups = groupsFor(chosen);
      const record: OutingRecord = { id: 'short-trip', path: '', name: 'Short trip', status: 'planned', groups, createdAt: '', revision: '' };
      const evaluated = buildOutingOptimisationPreview(record, uniquePlaces, hours, planning); result.evaluatedCount++;
      if (evaluated.blockers.length) { if (!result.groups.length) result.blockers = [...new Set([...result.blockers, ...evaluated.blockers])]; continue; }
      const estimate = evaluated.proposed;
      if (estimate.openingConflicts || !Number.isFinite(estimate.totalMinutes) || estimate.totalMinutes > options.budgetMinutes + 1e-8) continue;
      if (!best || estimate.unconfirmedHours < best.estimate.unconfirmedHours || estimate.unconfirmedHours === best.estimate.unconfirmedHours &&
        (estimate.totalMinutes < best.estimate.totalMinutes - 1e-8 || Math.abs(estimate.totalMinutes - best.estimate.totalMinutes) < 1e-8 &&
          lexical(chosen.map(item => item.source.path).join('\n'), best.chosen.map(item => item.source.path).join('\n')) < 0)) {
        best = { chosen, groups: evaluated.groups, estimate, warnings: evaluated.warnings };
      }
    }
    if (!best) break;
    selected = best.chosen; result.groups = best.groups; result.estimate = best.estimate; result.blockers = [];
    for (const warning of best.warnings) if (/no checked date/.test(warning)) result.warnings.push(warning);
  }
  if (result.estimate?.unconfirmedHours) result.warnings.push(result.estimate.unconfirmedHours + ' proposed source(s): hours unconfirmed.');
  result.warnings = [...new Set(result.warnings)];
  if (!result.groups.length && !result.blockers.length) result.blockers.push(candidates.length
    ? 'No eligible journey fits these minutes and known opening hours. Try more time, another departure or a different area.'
    : 'No sources have usable saved parking and coordinates in this selection. Change the area or shortlist, or choose parking in standard outing preparation.');
  return result;
}
