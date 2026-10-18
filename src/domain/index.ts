import type { Coordinates, LocalityRecord, PlaceRecord } from '../types';
import { haversineKm, isGoogleMapsUrl, validateCoordinates } from './coordinates';
import { hasControlCharacters, isUnknownArray } from './guards';
export * from './coordinates';
export * from './hierarchy';

export function safeFileName(value: string, fallback = 'Untitled'): string {
  const name = Array.from(value.normalize('NFC'), character => hasControlCharacters(character, false) ? ' ' : character).join('').replace(/[<>:"/\\|?*#[\]^]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 180).replace(/[. ]+$/, '');
  if (!name || name === '.' || name === '..') return fallback;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}
export function validateRootPath(value: string): string {
  const path = value.trim().replace(/\\/g, '/');
  if (!path || /[{}]/.test(path) || path.startsWith('/') || path.endsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.') || safeFileName(p) !== p)) throw Error('Choose a relative vault folder using ordinary folder names.');
  return path;
}
export function sourcingRating(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 && Number.isInteger(value * 2) ? value : 0;
}
export function formatRating(value: unknown): string {
  const rating = sourcingRating(value);
  return rating === 0 ? '0 · Not rated' : `${rating} / 5 · ${'★'.repeat(Math.floor(rating))}${rating % 1 ? '½' : ''}`;
}
export function ratingColor(value: unknown): string {
  const rating = sourcingRating(value);
  return rating === 0 ? '#3b82f6' : rating < 2 ? '#dc2626' : rating < 4 ? '#d97706' : '#16a34a';
}
export function linkTarget(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].replace(/\.md$/i, '').replace(/\\/g, '/');
}
export const normalizeWikiLink = linkTarget;
function linkedRecord<T extends { path: string }>(value: unknown, records: T[]): T | null {
  const target = linkTarget(value);
  if (!target) return null;
  const exact = records.filter(p => p.path.replace(/\.md$/i, '') === target);
  if (exact.length === 1) return exact[0];
  if (target.includes('/')) return null;
  const byName = records.filter(p => p.path.split('/').pop()!.replace(/\.md$/i, '') === target);
  return byName.length === 1 ? byName[0] : null;
}
export function localitySuggestions(coordinates: Coordinates | null, localities: LocalityRecord[], places: PlaceRecord[], radiusKm = 1): { locality: LocalityRecord; distanceKm: number }[] {
  if (!coordinates || !validateCoordinates(coordinates) || !Number.isFinite(radiusKm) || radiusKm < 0) return [];
  return localities.map(locality => ({ locality, distanceKm: Math.min(...places.filter(p => linkedRecord(p.locality, localities)?.path === locality.path && validateCoordinates(p.coordinates)).map(p => haversineKm(coordinates, p.coordinates!))) })).filter(p => p.distanceKm <= radiusKm).sort((a, b) => a.distanceKm - b.distanceKm || a.locality.name.localeCompare(b.locality.name));
}
export interface ParkingResolution { status: 'preferred' | 'single' | 'choice' | 'shop' | 'invalid'; choices: PlaceRecord[]; destination: PlaceRecord | null }
export function resolveParking(shop: PlaceRecord, places: PlaceRecord[]): ParkingResolution {
  const parking = places.filter(p => p.kind === 'parking');
  const shops = places.filter(p => p.kind === 'shop');
  if (!shops.some(p => p.path === shop.path)) shops.push(shop);
  const choices = parking.filter(p => {
    const links = p.properties.parking_for;
    return (isUnknownArray(links) ? links : [links]).some(v => linkedRecord(v, shops)?.path === shop.path);
  });
  const preferredLink = shop.properties.parking_location;
  if (linkTarget(preferredLink)) {
    const preferred = linkedRecord(preferredLink, parking);
    if (preferred && !choices.some(p => p.path === preferred.path)) choices.unshift(preferred);
    return { status: validateCoordinates(preferred?.coordinates) ? 'preferred' : 'invalid', choices, destination: validateCoordinates(preferred?.coordinates) ? preferred : null };
  }
  if (choices.length > 1) return { status: 'choice', choices, destination: null };
  if (choices.length === 1) return { status: validateCoordinates(choices[0].coordinates) ? 'single' : 'invalid', choices, destination: validateCoordinates(choices[0].coordinates) ? choices[0] : null };
  return { status: 'shop', choices, destination: validateCoordinates(shop.coordinates) ? shop : null };
}
export function googleMapsUrl(place: PlaceRecord): string {
  const saved = place.properties.google_maps_url;
  if (typeof saved === 'string') {
    try {
      const u = new URL(saved);
      if (isGoogleMapsUrl(saved) || (u.protocol === 'https:' && (u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps/'))))) return saved;
    } catch { /* Fall back to validated coordinates. */ }
  }
  const c = validateCoordinates(place.coordinates);
  return c ? `https://www.google.com/maps/search/?api=1&query=${c.join(',')}` : '';
}

export { websiteUrl, telephoneUrl } from './contacts';
