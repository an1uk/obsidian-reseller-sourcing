/** Display preferences only: saved geometry and calculations remain metric. */
export type DistanceUnit = 'miles' | 'km';
const KM_PER_MILE = 1.609344;

export function normaliseDistanceUnit(value: unknown): DistanceUnit {
  return value === 'km' ? 'km' : 'miles';
}
export function distanceFromKm(km: number, unit: DistanceUnit): number {
  return unit === 'km' ? km : km / KM_PER_MILE;
}
export function distanceToKm(value: number, unit: DistanceUnit): number {
  return unit === 'km' ? value : value * KM_PER_MILE;
}
export function formatDistance(km: number, unit: DistanceUnit, digits = 1): string {
  if (!Number.isFinite(km)) return 'Unavailable';
  return distanceFromKm(km, unit).toFixed(digits) + ' ' + unit;
}
export function speedSuffix(unit: DistanceUnit): string {
  return unit === 'miles' ? 'mph' : 'km/h';
}
