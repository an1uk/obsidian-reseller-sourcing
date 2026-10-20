import type { Coordinates, LocalityRecord, PlaceRecord } from '../types';
import { haversineKm, validateCoordinates } from '../domain/coordinates';
import { linkTarget, sourcingRating } from '../domain';
import { isRecord, isUnknownArray } from '../domain/guards';
import { distanceToKm } from '../units';

export type PlaceSortKey = 'name' | 'area' | 'type' | 'rating' | 'lastVisited' | 'shortlist' | 'distance';
export interface PlaceSort { key: PlaceSortKey; direction: 'asc' | 'desc'; }
export type NearbyReference =
  | { kind: 'place'; path: string }
  | { kind: 'point' | 'current'; coordinates: Coordinates; label?: string }
  | { kind: 'unavailable'; label?: string };
export interface PlaceQuery {
  text: string; area: string; kind: 'all' | 'shop' | 'parking'; sourceType: string;
  rating: 'any' | 'unrated' | 'minimum'; minimumRating: number; shortlist: boolean;
  status: 'active' | 'closed' | 'all'; visits: 'any' | 'with' | 'without';
  location: 'any' | 'present' | 'missing';
  nearby?: { reference: NearbyReference; radiusKm: number };
}
export interface PlaceQueryResult {
  places: PlaceRecord[]; distancesKm: Map<string, number>; matchingCount: number;
  mappedCount: number; missingLocationCount: number; nearbyUnavailable: boolean;
}
const DEFAULT_SORT: PlaceSort = { key: 'name', direction: 'asc' };
const SORT_KEYS: PlaceSortKey[] = ['name', 'area', 'type', 'rating', 'lastVisited', 'shortlist', 'distance'];
export function defaultPlaceQuery(): PlaceQuery {
  return { text: '', area: '', kind: 'shop', sourceType: '', rating: 'any', minimumRating: .5,
    shortlist: false, status: 'active', visits: 'any', location: 'any' };
}
/** Keep the physical radius stable when the display preference changes. */
export function defaultNearbyRadiusKm(): number { return distanceToKm(5, 'miles'); }
const text = (value: unknown): string => typeof value === 'string' ? value : '';
function enumValue<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find(option => option === value) ?? fallback;
}
function nearbyReference(value: unknown): NearbyReference {
  if (!isRecord(value)) return { kind: 'unavailable' };
  const label = typeof value.label === 'string' ? value.label : undefined;
  if (value.kind === 'place' && typeof value.path === 'string' && value.path.trim()) return { kind: 'place', path: value.path };
  if (value.kind === 'point' || value.kind === 'current') {
    const coordinates = validateCoordinates(value.coordinates);
    if (coordinates) return { kind: value.kind, coordinates, ...(label ? { label } : {}) };
  }
  return { kind: 'unavailable', ...(label ? { label } : {}) };
}
/** Validate persisted or legacy pane state without trusting host JSON. */
export function normalisePlaceQuery(value: unknown): PlaceQuery {
  const defaults = defaultPlaceQuery();
  if (!isRecord(value)) return defaults;
  const minimum = sourcingRating(value.minimumRating);
  const query: PlaceQuery = {
    text: text(value.text) || text(value.query), area: text(value.area),
    kind: enumValue(value.kind, ['all', 'shop', 'parking'], defaults.kind),
    sourceType: text(value.sourceType), rating: enumValue(value.rating, ['any', 'unrated', 'minimum'], 'any'),
    minimumRating: minimum > 0 ? minimum : defaults.minimumRating,
    shortlist: value.shortlist === true, status: enumValue(value.status, ['active', 'closed', 'all'], 'active'),
    visits: enumValue(value.visits, ['any', 'with', 'without'], 'any'),
    location: enumValue(value.location, ['any', 'present', 'missing'], 'any'),
  };
  if (value.nearby !== undefined && value.nearby !== null) {
    const nearby = isRecord(value.nearby) ? value.nearby : {};
    query.nearby = { reference: nearbyReference(nearby.reference), radiusKm:
      typeof nearby.radiusKm === 'number' && Number.isFinite(nearby.radiusKm) && nearby.radiusKm > 0
        ? nearby.radiusKm : defaultNearbyRadiusKm() };
  }
  return query;
}
export function normalisePlaceSort(value: unknown): PlaceSort {
  if (!isRecord(value)) return { ...DEFAULT_SORT };
  const key = enumValue(value.key, SORT_KEYS, 'name');
  return { key, direction: enumValue(value.direction, ['asc', 'desc'], initialDirection(key)) };
}
function initialDirection(key: PlaceSortKey): PlaceSort['direction'] {
  return key === 'rating' || key === 'lastVisited' || key === 'shortlist' ? 'desc' : 'asc';
}
export function nextPlaceSort(current: PlaceSort, key: PlaceSortKey): PlaceSort {
  return { key, direction: current.key === key ? current.direction === 'asc' ? 'desc' : 'asc' : initialDirection(key) };
}
/** Current device coordinates are memory-only, including in preparation criteria. */
export function serialisePlaceQuery(value: PlaceQuery): PlaceQuery {
  const query = normalisePlaceQuery(value);
  if (query.nearby?.reference.kind === 'current') {
    query.nearby.reference = { kind: 'unavailable', label: 'Current location must be requested again' };
  }
  return query;
}
export function placeSourceType(place: PlaceRecord): string {
  return place.kind === 'parking' ? 'Parking' : text(place.properties.source_type).trim() || 'Charity shop';
}
export function placeBrandNames(place: PlaceRecord): string[] {
  const tags = place.properties.tags;
  return (isUnknownArray(tags) ? tags : typeof tags === 'string' ? [tags] : [])
    .filter((tag): tag is string => typeof tag === 'string')
    .filter(tag => /^(?:source|charity-shop)\//.test(tag))
    .map(tag => tag.replace(/^(?:source|charity-shop)\//, '').replace(/-/g, ' '));
}
function areaForPlace(place: PlaceRecord, areas: readonly LocalityRecord[]): LocalityRecord | undefined {
  const target = linkTarget(place.locality);
  if (!target) return undefined;
  const exact = areas.find(area => linkTarget(area.path) === target);
  if (exact || target.includes('/')) return exact;
  const named = areas.filter(area => linkTarget(area.path).split('/').pop() === target);
  return named.length === 1 ? named[0] : undefined;
}
export function areaLabelForPlace(place: PlaceRecord, areas: readonly LocalityRecord[]): string {
  return areaForPlace(place, areas)?.label || linkTarget(place.locality).split('/').pop() || 'Unassigned';
}
function inArea(place: PlaceRecord, requested: string, areas: readonly LocalityRecord[]): boolean {
  if (!requested) return true;
  if (requested === 'unassigned') return !linkTarget(place.locality);
  const desired = linkTarget(requested);
  let area = areaForPlace(place, areas);
  const target = linkTarget(area?.path ?? place.locality);
  if (target === desired || target.startsWith(desired + '/')) return true;
  const seen = new Set<string>();
  while (area && !seen.has(area.path)) {
    seen.add(area.path);
    const parent = linkTarget(area.parentPath);
    if (parent === desired) return true;
    area = areas.find(candidate => linkTarget(candidate.path) === parent);
  }
  return false;
}
function searchText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function dateKey(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : null;
}
function lex(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
}
function compareValue(a: string | number | null, b: string | number | null, direction: PlaceSort['direction']): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const compared = typeof a === 'number' && typeof b === 'number' ? a - b : lex(String(a), String(b));
  return direction === 'desc' ? -compared : compared;
}
function sortValue(place: PlaceRecord, key: PlaceSortKey, areas: readonly LocalityRecord[], distances: ReadonlyMap<string, number>): string | number | null {
  switch (key) {
    case 'name': return place.name;
    case 'area': return linkTarget(place.locality) ? areaLabelForPlace(place, areas) : null;
    case 'type': return placeSourceType(place);
    case 'rating': return place.kind === 'shop' ? sourcingRating(place.properties.rating) || null : null;
    case 'lastVisited': return place.kind === 'shop' ? dateKey(place.properties.last_visited) : null;
    case 'shortlist': return place.kind === 'shop' ? Number(place.properties.shortlist === true) : null;
    case 'distance': return distances.get(place.path) ?? null;
  }
}
export function queryPlaces(
  records: readonly PlaceRecord[], areas: readonly LocalityRecord[], visitedPaths: ReadonlySet<string>,
  input: PlaceQuery, requestedSort: PlaceSort = DEFAULT_SORT,
): PlaceQueryResult {
  const query = normalisePlaceQuery(input), sort = normalisePlaceSort(requestedSort);
  const terms = searchText(query.text).split(' ').filter(Boolean);
  const sourceOnly = Boolean(query.sourceType || query.rating !== 'any' || query.shortlist || query.visits !== 'any' || query.status === 'closed');
  const candidates = records.filter(place => {
    if (query.kind !== 'all' && place.kind !== query.kind || sourceOnly && place.kind !== 'shop') return false;
    if (!inArea(place, query.area, areas)) return false;
    const closed = place.kind === 'shop' && place.properties.shop_closed === true;
    if (query.status === 'active' && closed || query.status === 'closed' && !closed) return false;
    if (query.sourceType && placeSourceType(place) !== query.sourceType) return false;
    const rating = sourcingRating(place.properties.rating);
    if (query.rating === 'unrated' && rating !== 0 || query.rating === 'minimum' && rating < query.minimumRating) return false;
    if (query.shortlist && place.properties.shortlist !== true) return false;
    const visited = visitedPaths.has(place.path);
    if (query.visits === 'with' && !visited || query.visits === 'without' && visited) return false;
    const coordinates = validateCoordinates(place.coordinates);
    if (query.location === 'present' && !coordinates || query.location === 'missing' && coordinates) return false;
    if (terms.length) {
      const haystack = searchText([place.name, text(place.properties.address), text(place.properties.comments), ...placeBrandNames(place)].join(' '));
      if (!terms.every(term => haystack.includes(term))) return false;
    }
    return true;
  });
  const distancesKm = new Map<string, number>();
  let nearbyUnavailable = false, places = candidates;
  if (query.nearby) {
    const reference = query.nearby.reference;
    const centre = reference.kind === 'place'
      ? validateCoordinates(records.find(place => place.path === reference.path)?.coordinates)
      : reference.kind === 'unavailable' ? null : validateCoordinates(reference.coordinates);
    if (!centre) { nearbyUnavailable = true; places = []; }
    else {
      for (const place of candidates) {
        const coordinates = validateCoordinates(place.coordinates);
        if (coordinates) distancesKm.set(place.path, haversineKm(centre, coordinates));
      }
      const radiusKm = query.nearby.radiusKm;
      places = candidates.filter(place => {
        const distance = distancesKm.get(place.path);
        return distance !== undefined && distance <= radiusKm;
      });
    }
  }
  const missingLocationCount = candidates.filter(place => !validateCoordinates(place.coordinates)).length;
  places = [...places].sort((a, b) =>
    compareValue(sortValue(a, sort.key, areas, distancesKm), sortValue(b, sort.key, areas, distancesKm), sort.direction)
    || lex(a.name, b.name) || lex(a.path, b.path));
  return { places, distancesKm, matchingCount: places.length,
    mappedCount: places.filter(place => Boolean(validateCoordinates(place.coordinates))).length,
    missingLocationCount, nearbyUnavailable };
}
