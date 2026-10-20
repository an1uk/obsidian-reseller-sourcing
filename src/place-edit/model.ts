import type { PlaceKind, PlaceRecord } from '../types';
import { canonicalPlaceIdentity, isGoogleMapsUrl, validateCoordinates, websiteUrl } from '../domain';
import { hasControlCharacters, isRecord, isUnknownArray } from '../domain/guards';

export type PlaceEditSection = 'basics' | 'location' | 'contacts' | 'assessment' | 'parking' | 'opening';
export interface PlaceEditValues {
  displayName: string; sourceType: string; brandTag: string; address: string; coordinatesText: string;
  website: string; telephone: string; mapsUrl: string; openingNotes: string;
  rating: number; comments: string; shortlist: boolean; closed: boolean;
  parkingOnSite: string; onSiteCost: string; onSiteAvailability: string; parkingCost: string; parkingAvailability: string;
}
export interface PlaceEditSnapshot {
  path: string; kind: PlaceKind; name: string; properties: Record<string, unknown>; values: PlaceEditValues;
}
export interface PlaceEditPreparation { snapshot: PlaceEditSnapshot; values: PlaceEditValues; section: PlaceEditSection; }
export interface PlaceEditReceipt { id: string; fingerprint: string; appliedAt: string; fields: string[]; }
export interface PlaceEditReviewRow { field: keyof PlaceEditValues; label: string; current: string | number | boolean; entered: string | number | boolean; conflict: boolean; }
export interface PlaceEditReview { current: PlaceEditSnapshot; rows: PlaceEditReviewRow[]; }
export const PLACE_EDIT_PROPERTIES = ['display_name', 'source_type', 'tags', 'address', 'coordinates', 'website', 'telephone', 'google_maps_url', 'opening_notes', 'rating', 'comments', 'shortlist', 'shop_closed', 'parking_on_site', 'on_site_parking_cost', 'on_site_parking_availability', 'parking_cost', 'parking_availability', 'source_capture_id'] as const;
const textKeys = ['displayName', 'sourceType', 'brandTag', 'address', 'coordinatesText', 'website', 'telephone', 'mapsUrl', 'openingNotes', 'comments', 'parkingOnSite', 'onSiteCost', 'onSiteAvailability', 'parkingCost', 'parkingAvailability'] as const;
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const brandTags = (value: unknown) => isUnknownArray(value) ? value.filter((tag): tag is string => typeof tag === 'string' && /^(?:source|charity-shop)\//.test(tag)) : [];
const classificationTags = (value: unknown) => isUnknownArray(value) ? value.filter((tag): tag is string => tag === 'places' || tag === 'sourcing-source' || tag === 'charity-shop').sort() : [];
export function placeDisplayName(properties: Record<string, unknown>, filename: string): string {
  return text(properties.display_name).trim() || text(properties.google_name).trim() || filename;
}
export function placeEditSnapshot(place: PlaceRecord): PlaceEditSnapshot {
  const p = place.properties;
  const values: PlaceEditValues = {
    displayName: text(p.display_name), sourceType: text(p.source_type, 'Charity shop'), brandTag: brandTags(p.tags)[0]?.replace(/^(?:source|charity-shop)\//, '') ?? '',
    address: text(p.address), coordinatesText: place.coordinates?.join(', ') ?? '', website: text(p.website), telephone: text(p.telephone), mapsUrl: text(p.google_maps_url), openingNotes: text(p.opening_notes),
    rating: typeof p.rating === 'number' && Number.isFinite(p.rating) ? p.rating : 0, comments: text(p.comments), shortlist: p.shortlist === true, closed: p.shop_closed === true,
    parkingOnSite: text(p.parking_on_site, 'unknown'), onSiteCost: text(p.on_site_parking_cost), onSiteAvailability: text(p.on_site_parking_availability), parkingCost: text(p.parking_cost), parkingAvailability: text(p.parking_availability),
  };
  return { path: place.path, kind: place.kind, name: place.name, properties: structuredClone(Object.fromEntries(PLACE_EDIT_PROPERTIES.filter(key => Object.hasOwn(p, key)).map(key => [key, p[key]]))), values };
}
export function isPlaceEditValues(value: unknown): value is PlaceEditValues {
  return isRecord(value) && textKeys.every(key => typeof value[key] === 'string') && typeof value.rating === 'number' && Number.isFinite(value.rating) && typeof value.shortlist === 'boolean' && typeof value.closed === 'boolean';
}
export function isPlaceEditPreparation(value: unknown, inside: (path: unknown) => path is string): value is PlaceEditPreparation {
  if (!isRecord(value) || !isRecord(value.snapshot)) return false;
  const s = value.snapshot;
  return inside(s.path) && (s.kind === 'shop' || s.kind === 'parking') && typeof s.name === 'string' && isRecord(s.properties) && Object.keys(s.properties).every(key => PLACE_EDIT_PROPERTIES.some(allowed => key === allowed)) && isPlaceEditValues(s.values) && isPlaceEditValues(value.values) && ['basics', 'location', 'contacts', 'assessment', 'parking', 'opening'].includes(text(value.section));
}
export function validateListingUrl(input: string): string {
  const value = input.trim(); if (!value) return '';
  let url: URL; try { url = new URL(value); } catch { throw Error('Use a valid Google Maps listing or shared link, or leave it blank.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:' || !isGoogleMapsUrl(value) && !(url.protocol === 'https:' && (url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')))) throw Error('Use a Google Maps listing or shared link.');
  if (url.username || url.password || hasControlCharacters(value)) throw Error('Use a valid Google Maps listing or shared link.');
  return value;
}
export function sameGoogleListing(left: string, right: string): boolean {
  const identity = canonicalPlaceIdentity(left);
  return !!left && (left === right || !!identity && identity === canonicalPlaceIdentity(right));
}
/** Only changed, allowlisted personal fields become a patch. Captured snapshots are not editable here. */
export function placeEditPatch(snapshot: PlaceEditSnapshot, values: PlaceEditValues, current: Record<string, unknown> = snapshot.properties): Record<string, unknown> {
  if (!isPlaceEditValues(values)) throw Error('Place details are invalid. Reopen the editor.');
  const patch: Record<string, unknown> = {}, before = snapshot.values;
  const stringField = (field: typeof textKeys[number], property: string, limit = 1000) => {
    if (values[field] === before[field]) return;
    const value = values[field].trim(); if (value.length > limit || hasControlCharacters(value.replace(/\r?\n/g, ''), false)) throw Error('Check ' + property.replace(/_/g, ' ') + ': use plain text up to ' + limit + ' characters.');
    patch[property] = value;
  };
  stringField('displayName', 'display_name', 200); stringField('address', 'address'); stringField('openingNotes', 'opening_notes', 10000);
  stringField('telephone', 'telephone');
  if (values.website !== before.website) { const value = values.website.trim(), normal = websiteUrl(value); if (value && !normal) throw Error('Enter a valid http or https website address, or leave it blank.'); patch.website = normal; }
  if (values.mapsUrl !== before.mapsUrl) patch.google_maps_url = validateListingUrl(values.mapsUrl);
  if (values.coordinatesText !== before.coordinatesText) {
    const value = values.coordinatesText.trim(), parts = value.split(',');
    const coordinates = value && parts.length === 2 && parts.every(part => !!part.trim()) ? validateCoordinates(parts.map(Number)) : null;
    if (value && !coordinates) throw Error('Use a valid latitude, longitude pair or leave coordinates blank.');
    patch.coordinates = coordinates ?? [];
  }
  if (snapshot.kind === 'shop') {
    if (values.sourceType !== before.sourceType) {
      stringField('sourceType', 'source_type', 80); if (!patch.source_type) throw Error('Choose a source type.');
      const tags = isUnknownArray(current.tags) ? current.tags : [];
      patch.tags = [...tags.filter(tag => tag !== 'charity-shop'), ...(!tags.includes('places') ? ['places'] : []), ...(!tags.includes('sourcing-source') ? ['sourcing-source'] : []), ...(values.sourceType.trim().toLowerCase() === 'charity shop' ? ['charity-shop'] : [])];
    }
    if (values.brandTag !== before.brandTag) {
      const raw = values.brandTag.trim().replace(/^(?:source|charity-shop)\//, '');
      const slug = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (raw && (!slug || slug.length > 100)) throw Error('Use a brand or name up to 100 characters, without its town.');
      const tags = isUnknownArray(patch.tags) ? patch.tags : isUnknownArray(current.tags) ? current.tags : [];
      patch.tags = [...tags.filter(tag => typeof tag !== 'string' || !/^(?:source|charity-shop)\//.test(tag)), ...(slug ? ['source/' + slug] : [])];
    }
    if (values.rating !== before.rating) { if (values.rating < 0 || values.rating > 5 || !Number.isInteger(values.rating * 2)) throw Error('Rating must use half-star steps from 0 to 5.'); patch.rating = values.rating; }
    stringField('comments', 'comments');
    if (values.shortlist !== before.shortlist) patch.shortlist = values.shortlist;
    if (values.closed !== before.closed) patch.shop_closed = values.closed;
    if (values.parkingOnSite !== before.parkingOnSite) { if (!['unknown', 'yes', 'no'].includes(values.parkingOnSite)) throw Error('Choose available, none or unknown for on-site parking.'); patch.parking_on_site = values.parkingOnSite; }
    stringField('onSiteCost', 'on_site_parking_cost'); stringField('onSiteAvailability', 'on_site_parking_availability');
  } else { stringField('parkingCost', 'parking_cost'); stringField('parkingAvailability', 'parking_availability'); }
  return patch;
}
export function assertPlaceEditComparison(snapshot: PlaceEditSnapshot, patch: Record<string, unknown>, current: Record<string, unknown>, values: PlaceEditValues): void {
  if (JSON.stringify(snapshot.properties.source_capture_id) !== JSON.stringify(current.source_capture_id)) throw Error('This place identity changed. Reopen Edit place to review the current record.');
  for (const key of Object.keys(patch)) {
    if (key === 'tags') {
      if (values.brandTag !== snapshot.values.brandTag && JSON.stringify(brandTags(snapshot.properties.tags)) !== JSON.stringify(brandTags(current.tags))) throw Error('The brand tags changed in another view. Your entered details are kept; reopen Edit place to compare.');
      if (values.sourceType !== snapshot.values.sourceType && JSON.stringify(classificationTags(snapshot.properties.tags)) !== JSON.stringify(classificationTags(current.tags))) throw Error('The source type tags changed in another view. Your entered details are kept; reopen Edit place to compare.');
      continue;
    }
    const before = snapshot.properties[key];
    const now = current[key];
    if (JSON.stringify(before) !== JSON.stringify(now)) throw Error('The ' + key.replace(/_/g, ' ') + ' changed in another view. Your entered details are kept; reopen Edit place to compare.');
  }
}
export function placeEditReceipts(value: unknown): PlaceEditReceipt[] {
  return isUnknownArray(value) ? value.filter((v): v is PlaceEditReceipt => isRecord(v) && typeof v.id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(v.id) && typeof v.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(v.fingerprint) && typeof v.appliedAt === 'string' && Number.isFinite(Date.parse(v.appliedAt)) && isUnknownArray(v.fields) && v.fields.every(field => typeof field === 'string' && PLACE_EDIT_PROPERTIES.some(key => key === field))) : [];
}
export function placeEditReceiptFor(value: unknown, id: string): PlaceEditReceipt | undefined {
  if (value === undefined) return;
  if (!isUnknownArray(value)) throw Error('Saved place edit receipts need review before another edit can be recorded.');
  const verified = placeEditReceipts(value);
  if (verified.length !== value.length || new Set(verified.map(receipt => receipt.id)).size !== verified.length) throw Error('Saved place edit receipts are malformed or ambiguous. Review the record before retrying; changes will not be replayed.');
  return verified.find(receipt => receipt.id === id);
}
const fieldProperties: Record<keyof PlaceEditValues, string> = {
  displayName: 'display_name', sourceType: 'source_type', brandTag: 'tags', address: 'address', coordinatesText: 'coordinates', website: 'website', telephone: 'telephone', mapsUrl: 'google_maps_url', openingNotes: 'opening_notes', rating: 'rating', comments: 'comments', shortlist: 'shortlist', closed: 'shop_closed', parkingOnSite: 'parking_on_site', onSiteCost: 'on_site_parking_cost', onSiteAvailability: 'on_site_parking_availability', parkingCost: 'parking_cost', parkingAvailability: 'parking_availability',
};
const fieldLabels: Record<keyof PlaceEditValues, string> = {
  displayName: 'Display name', sourceType: 'Source type', brandTag: 'Brand / name tag', address: 'Address', coordinatesText: 'Coordinates', website: 'Website', telephone: 'Telephone', mapsUrl: 'Google Maps link', openingNotes: 'Your opening notes', rating: 'Sourcing rating', comments: 'Takeaway', shortlist: 'Shortlist', closed: 'Permanently closed', parkingOnSite: 'Parking on site', onSiteCost: 'On-site cost', onSiteAvailability: 'On-site availability', parkingCost: 'Parking cost', parkingAvailability: 'Parking availability',
};
export function reviewPlaceEdit(snapshot: PlaceEditSnapshot, values: PlaceEditValues, current: PlaceEditSnapshot): PlaceEditReview {
  if (snapshot.path !== current.path || snapshot.kind !== current.kind || JSON.stringify(snapshot.properties.source_capture_id) !== JSON.stringify(current.properties.source_capture_id)) throw Error('This place identity changed. Review its note before starting a new edit.');
  const rows: PlaceEditReviewRow[] = [];
  for (const field of Object.keys(fieldProperties) as (keyof PlaceEditValues)[]) {
    if (values[field] === snapshot.values[field]) continue;
    const property = fieldProperties[field];
    const conflict = field === 'brandTag' ? JSON.stringify(brandTags(snapshot.properties.tags)) !== JSON.stringify(brandTags(current.properties.tags))
      : JSON.stringify(snapshot.properties[property]) !== JSON.stringify(current.properties[property]) || field === 'sourceType' && JSON.stringify(classificationTags(snapshot.properties.tags)) !== JSON.stringify(classificationTags(current.properties.tags));
    rows.push({ field, label: fieldLabels[field], current: current.values[field], entered: values[field], conflict });
  }
  return { current, rows };
}
/** Rebase only the draft. Conflicts use current values unless the user explicitly keeps their edit. */
export function rebasePlaceEdit(snapshot: PlaceEditSnapshot, values: PlaceEditValues, current: PlaceEditSnapshot, keepMine: readonly (keyof PlaceEditValues)[]): { snapshot: PlaceEditSnapshot; values: PlaceEditValues } {
  const review = reviewPlaceEdit(snapshot, values, current), result: PlaceEditValues = structuredClone(current.values);
  const copy = <K extends keyof PlaceEditValues>(key: K) => { result[key] = values[key]; };
  for (const row of review.rows) if (!row.conflict || keepMine.includes(row.field)) copy(row.field);
  return { snapshot: structuredClone(current), values: result };
}
