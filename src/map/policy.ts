import type { Coordinates, PlaceRecord } from '../types';
import { isUnknownArray } from '../domain/guards';

export const MAP_VIEW_TYPE = 'charity-sourcing-map';
export const LOCALITY_HEIGHT = 680;
export const PLACE_HEIGHT = 400;
export const PLACE_ZOOM = 16;
export const LOCALITY_MAX_ZOOM = 15;

export function validCoordinates(value: unknown): value is Coordinates {
  if (!isUnknownArray(value) || value.length !== 2) return false;
  const [lat, lng] = value;
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;
}
export function mapCoordinates([lat, lng]: Coordinates): [number, number] { return [lng, lat]; }
export function fitOptions(mobile: boolean) { return { padding: mobile ? 32 : 64, maxZoom: LOCALITY_MAX_ZOOM, duration: 0 }; }
export function ratingColour(rating: unknown): string {
  const n = typeof rating === 'number' ? rating : Number(rating);
  return !Number.isFinite(n) || n <= 0 || n > 5 || !Number.isInteger(n * 2) ? '#2563eb' : n < 2 ? '#dc2626' : n < 4 ? '#d97706' : '#16a34a';
}
export function isWithinRoot(path: string, root: string): boolean { return path.startsWith(root.replace(/\/+$/, '') + '/'); }
export interface MapVisibilityOptions { includeClosed?: boolean; focusPath?: string; }
export function visiblePlaces(records: PlaceRecord[], root: string, options: MapVisibilityOptions = {}): PlaceRecord[] {
  return records.filter(r => isWithinRoot(r.path, root) && validCoordinates(r.coordinates)
    && (options.includeClosed || r.path === options.focusPath || r.kind !== 'shop' || r.properties.shop_closed !== true));
}

/** Camera changes from the user pause data-driven fitting, but never remove pins. */
export class FitPolicy {
  automatic = true;
  userMoved(): void { this.automatic = false; }
  resume(): void { this.automatic = true; }
}

/** Nested practice notebooks are a separate ownership domain. */
export function hostOwnsPath(host: { settings: { root: string }; ownsPath?: (path: string) => boolean }, path: string): boolean {
  return host.ownsPath ? host.ownsPath(path) : isWithinRoot(path, host.settings.root);
}
