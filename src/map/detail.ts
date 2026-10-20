import { resolveParking } from '../domain';
import type { PlaceRecord } from '../types';
import { hostOwnsPath } from './policy';

/** Detail maps contain the selected place and its actual shared-parking associations. */
export function detailMapPlaces(place: PlaceRecord, records: PlaceRecord[], host: { settings: { root: string }; ownsPath?: (path: string) => boolean }): PlaceRecord[] {
  const scoped = records.filter(record => hostOwnsPath(host, record.path));
  if (!hostOwnsPath(host, place.path)) return [];
  const related = place.kind === 'shop'
    ? resolveParking(place, scoped).choices.map(record => record.path)
    : scoped.filter(record => record.kind === 'shop' && resolveParking(record, scoped).choices.some(parking => parking.path === place.path)).map(record => record.path);
  const paths = new Set([place.path, ...related]);
  return scoped.filter(record => paths.has(record.path));
}
