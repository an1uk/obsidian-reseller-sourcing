import { validateCoordinates } from '../domain/coordinates';
import type { Coordinates, PlaceRecord } from '../types';
import type { OutingRecord, OutingStopStatus, PlanningAnchor, PlanningHours } from './types';

export type OutingRouteScope = 'remaining' | 'all';
export type RouteExportTarget = 'android-app' | 'desktop' | 'mobile-browser';
export const ROUTE_DESTINATION_LIMITS: Readonly<Record<RouteExportTarget, number>> = Object.freeze({
  'android-app': 9, desktop: 10, 'mobile-browser': 4,
});
export const ROUTE_TARGET_LABELS: Readonly<Record<RouteExportTarget, string>> = Object.freeze({
  'android-app': 'Google Maps Android app', desktop: 'Desktop', 'mobile-browser': 'Mobile browser',
});
export interface OutingRouteSource { path: string; name: string; status: OutingStopStatus; }
export interface OutingRouteDestination {
  groupIds: string[]; path: string; kind: 'parking' | 'source' | 'endpoint'; name: string;
  coordinates: Coordinates; sources: OutingRouteSource[]; endpoint?: 'start' | 'finish' | 'return';
}
export interface OutingRouteProblem { groupId: string; path: string; name: string; message: string; }
export interface OutingRouteExcluded { groupId: string; label: string; }
export interface OutingRoutePart {
  index: number; origin: OutingRouteDestination | null;
  destinations: OutingRouteDestination[]; url: string;
}
export interface OutingRoutePreview {
  scope: OutingRouteScope; target: RouteExportTarget; destinationLimit: number;
  fingerprint: string; destinations: OutingRouteDestination[];
  start: OutingRouteDestination | null; finish: OutingRouteDestination | null;
  problems: OutingRouteProblem[]; excluded: OutingRouteExcluded[];
  parts: OutingRoutePart[]; blockers: string[]; warnings: string[];
}
/** Retained for callers using the mobile-browser default. */
export const MAX_ROUTE_WAYPOINTS = 3;
export const MAX_ROUTE_URL_LENGTH = 2048;
const fallbackName = (path: string): string => path.split('/').at(-1)?.replace(/\.md$/i, '') || 'Missing destination';
const recordPath = (path: string): string => path.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.replace(/#.*$/, '');

/** Expand JavaScript's exponent notation without rounding the saved numeric pin. */
function decimal(value: number): string {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const sign = text.startsWith('-') ? '-' : '', unsigned = sign ? text.slice(1) : text;
  const [coefficient, exponent] = unsigned.split(/[eE]/), dot = coefficient!.indexOf('.');
  const digits = coefficient!.replace('.', ''), point = (dot < 0 ? digits.length : dot) + Number(exponent);
  return sign + (point <= 0 ? '0.' + '0'.repeat(-point) + digits :
    point >= digits.length ? digits + '0'.repeat(point - digits.length) :
      digits.slice(0, point) + '.' + digits.slice(point));
}
const coordinateText = (coordinates: Coordinates): string => coordinates.map(decimal).join(',');
function routeUrl(origin: OutingRouteDestination | null, destinations: OutingRouteDestination[]): string {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1'); url.searchParams.set('travelmode', 'driving');
  if (origin) url.searchParams.set('origin', coordinateText(origin.coordinates));
  url.searchParams.set('destination', coordinateText(destinations.at(-1)!.coordinates));
  if (destinations.length > 1) url.searchParams.set('waypoints', destinations.slice(0, -1).map(value => coordinateText(value.coordinates)).join('|'));
  return url.toString();
}

/** Dynamic programming retains the fewest feasible parts, including unusually long numeric pins. */
function splitRoutes(destinations: OutingRouteDestination[], start: OutingRouteDestination | null, limit: number): { parts: OutingRoutePart[]; blockers: string[] } {
  const count = destinations.length, best: { count: number; length: number; url: string }[] = [];
  best[count] = { count: 0, length: 0, url: '' };
  for (let offset = count - 1; offset >= 0; offset--) {
    const origin = offset ? destinations[offset - 1]! : start;
    best[offset] = { count: Infinity, length: 0, url: '' };
    for (let length = 1; length <= limit && offset + length <= count; length++) {
      const url = routeUrl(origin, destinations.slice(offset, offset + length));
      if (url.length > MAX_ROUTE_URL_LENGTH) break;
      const total = 1 + best[offset + length]!.count;
      if (total < best[offset]!.count || (total === best[offset]!.count && length > best[offset]!.length))
        best[offset] = { count: total, length, url };
    }
  }
  if (count && !Number.isFinite(best[0]!.count)) return { parts: [], blockers: ['A destination cannot fit within a Google Maps route URL. Open its individual directions instead.'] };
  const parts: OutingRoutePart[] = [];
  for (let offset = 0; offset < count;) {
    const next = best[offset]!, origin = offset ? destinations[offset - 1]! : start;
    parts.push({ index: parts.length, origin, destinations: destinations.slice(offset, offset + next.length), url: next.url });
    offset += next.length;
  }
  return { parts, blockers: [] };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function anchorDestination(anchor: PlanningAnchor | null | undefined, byPath: Map<string, PlaceRecord>, role: 'start' | 'finish' | 'return', selectedPaths: Set<string>): OutingRouteDestination | null {
  if (!anchor) return null;
  if (anchor.kind === 'record') {
    const barePath = recordPath(anchor.path), path = byPath.has(barePath) || /\.md$/i.test(barePath) ? barePath : barePath + '.md'; selectedPaths.add(path);
    const saved = byPath.get(path), coordinates = validateCoordinates(saved?.coordinates);
    return saved && (saved.kind === 'shop' || saved.kind === 'parking') && coordinates
      ? { path, kind: saved.kind === 'parking' ? 'parking' : 'source', name: saved.name, coordinates, groupIds: [], sources: [], endpoint: role } : null;
  }
  if (anchor.kind === 'coordinates') {
    const coordinates = validateCoordinates(anchor.coordinates);
    return coordinates ? { path: '', kind: 'endpoint', name: anchor.label?.trim() || (role === 'start' ? 'Starting point' : role === 'return' ? 'Return to starting point' : 'Finishing point'), coordinates, groupIds: [], sources: [], endpoint: role } : null;
  }
  return null;
}

/**
 * Read-only driving export of the saved outing order. A parking choice is
 * authoritative; a source pin is used only when the outing selects no parking.
 * The default stays mobile-safe for existing programmatic callers.
 */
export function buildOutingRoutePreview(
  record: OutingRecord,
  places: readonly PlaceRecord[],
  scope: OutingRouteScope = 'remaining',
  excludedGroupIds: readonly string[] = [],
  target: RouteExportTarget = 'mobile-browser',
  hoursFacts: Readonly<Record<string, PlanningHours>> = {},
): OutingRoutePreview {
  if (scope !== 'remaining' && scope !== 'all') throw new Error('Choose remaining stops or the whole outing.');
  if (!Object.hasOwn(ROUTE_DESTINATION_LIMITS, target)) throw new Error('Choose a Google Maps export target.');
  const byPath = new Map(places.map(place => [place.path, place])), exclusions = new Set(excludedGroupIds);
  const destinations: OutingRouteDestination[] = [], problems: OutingRouteProblem[] = [], excluded: OutingRouteExcluded[] = [];
  const blockers: string[] = [], selectedPaths = new Set<string>(), sourcePaths = new Set<string>();
  const warnings = ['The receiving Google Maps app or browser can have a lower stop limit. Check every destination after opening; choose Mobile browser if needed.'];
  if (record.operation) blockers.push('Complete or resolve the unfinished visit save before exporting a route.');
  const groups = record.groups.map(group => ({ ...group, stops: group.stops.filter(stop => scope === 'all' || stop.status === 'pending') }))
    .filter(group => group.stops.length > 0);
  for (const group of groups) {
    const sources = group.stops.map(stop => {
      selectedPaths.add(stop.sourcePath); sourcePaths.add(stop.sourcePath);
      return { path: stop.sourcePath, name: byPath.get(stop.sourcePath)?.name || fallbackName(stop.sourcePath), status: stop.status };
    });
    const path = group.parkingPath || sources[0]!.path, kind = group.parkingPath ? 'parking' as const : 'source' as const;
    selectedPaths.add(path);
    const saved = byPath.get(path), name = saved?.name || fallbackName(path);
    const coordinates = validateCoordinates(saved?.coordinates);
    const isCorrectKind = saved?.kind === (kind === 'parking' ? 'parking' : 'shop');
    if (!saved || !isCorrectKind || !coordinates) {
      problems.push({
        groupId: group.id, path, name,
        message: kind === 'parking'
          ? 'Selected parking is missing or has no valid coordinates. Repair it or explicitly exclude this group; its source pin will not be substituted.'
          : 'The first included source is missing or has no valid coordinates. Repair it or explicitly exclude this group.',
      });
    }
    if (exclusions.has(group.id)) {
      excluded.push({ groupId: group.id, label: (kind === 'parking' ? 'Parking: ' : 'Source location: ') + name }); continue;
    }
    if (!saved || !isCorrectKind || !coordinates) continue;
    const destination: OutingRouteDestination = { groupIds: [group.id], path, kind, name, coordinates, sources };
    const previous = destinations.at(-1);
    if (kind === 'parking' && previous?.kind === 'parking' && previous.path === path) {
      previous.groupIds.push(group.id); previous.sources.push(...sources);
    } else destinations.push(destination);
  }
  let start: OutingRouteDestination | null = null, finish: OutingRouteDestination | null = null;
  if (record.planning) {
    const savedStart = anchorDestination(record.planning.start, byPath, 'start', selectedPaths);
    if (!savedStart) blockers.push('The saved starting point is missing or has no valid coordinates. Edit the journey plan; no substitute will be used.');
    if (record.status === 'planned' || scope === 'all') start = savedStart;
    else warnings.push('Remaining stops start from your current location in Google Maps. The saved finishing point is retained.');
    if (record.planning.end.kind === 'return') {
      finish = anchorDestination(record.planning.start, byPath, 'return', selectedPaths);
    } else if (record.planning.end.kind !== 'last') {
      finish = anchorDestination(record.planning.end, byPath, 'finish', selectedPaths);
      if (!finish) blockers.push('The saved finishing point is missing or has no valid coordinates. Edit the journey plan; no substitute will be used.');
    }
    if (finish && destinations.length) {
      const previous = destinations.at(-1)!;
      if (coordinateText(previous.coordinates) === coordinateText(finish.coordinates)) previous.endpoint = finish.endpoint;
      else destinations.push(finish);
    }
    warnings.push('Google Maps receives the locations and order only. Opening hours, visit durations and local estimates stay in Obsidian.');
  }
  if (!groups.length) blockers.push(scope === 'remaining' ? 'There are no remaining stops to route.' : 'This outing has no stops to route.');
  else if (!destinations.length && !problems.some(problem => !exclusions.has(problem.groupId)))
    blockers.push('No destinations remain after the selected exclusions.');
  let parts: OutingRoutePart[] = [];
  const destinationLimit = ROUTE_DESTINATION_LIMITS[target];
  if (!blockers.length && !problems.some(problem => !exclusions.has(problem.groupId))) {
    const split = splitRoutes(destinations, start, destinationLimit); parts = split.parts; blockers.push(...split.blockers);
  }
  const relevantPlaces = [...selectedPaths].sort().map(path => {
    const saved = byPath.get(path);
    return { path, kind: saved?.kind ?? null, name: saved?.name ?? null, coordinates: validateCoordinates(saved?.coordinates) };
  });
  const relevantHours = Object.fromEntries([...sourcePaths].sort().map(path => [path, hoursFacts[path] ?? null]));
  // Exact canonical snapshot avoids hash collisions and excludes personal prose.
  const fingerprint = JSON.stringify(canonical({
    revision: record.revision, outingPath: record.path, outingId: record.id, scope, target, destinationLimit,
    planning: record.planning ?? null, hours: record.planning ? relevantHours : null,
    operation: record.operation?.id ?? null, start, finish,
    groups: groups.map(group => ({ id: group.id, parkingPath: group.parkingPath,
      stops: group.stops.map(stop => ({ id: stop.id, path: stop.sourcePath, status: stop.status })) })),
    places: relevantPlaces, destinations, problems, excluded, blockers,
  }));
  return { scope, target, destinationLimit, fingerprint, destinations, start, finish, problems, excluded, parts, blockers, warnings };
}
