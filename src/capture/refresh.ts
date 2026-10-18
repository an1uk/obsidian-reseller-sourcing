import type { CaptureDraft, PlaceRecord } from '../types';
import { canonicalPlaceIdentity, isGoogleMapsUrl, telephoneUrl, validateCoordinates, websiteUrl } from '../domain';
import { validGoogleHours, validSnapshotDate, readGoogleHours, readGoogleTopics } from '../domain/google-details';

export const CAPTURE_REFRESH_FIELDS = ['google_name', 'google_maps_url', 'address', 'website', 'telephone', 'google_hours', 'google_reviews', 'google_review_topics', 'coordinates'] as const;
export type CaptureRefreshField = typeof CAPTURE_REFRESH_FIELDS[number];
export interface CaptureRefreshFieldRow {
  key: CaptureRefreshField; label: string; current: unknown; incoming: unknown;
  available: boolean; changed: boolean; selected: boolean;
}
export interface CaptureRefreshReceipt {
  captureId: string; captureRevision: string; appliedAt: string; fields: CaptureRefreshField[];
  captureUrl: string; captureIdentity: string | null; targetSourceCaptureId: string;
}
export interface CaptureRefreshPreview {
  targetPath: string; targetName: string; captureId: string; captureRevision: string; capturedAt: string;
  fingerprint: string; fields: CaptureRefreshFieldRow[]; warnings: string[]; blockers: string[]; completed: boolean;
}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sourceTags = (properties: Record<string, unknown>): boolean => Array.isArray(properties.tags) && (properties.tags.includes('sourcing-source') || properties.tags.includes('charity-shop'));
const json = (value: unknown): string => JSON.stringify(value ?? null);
export function validRefreshListing(value: unknown): string {
  const raw = text(value);
  try {
    const u = new URL(raw);
    return isGoogleMapsUrl(raw) || (u.protocol === 'https:' && (u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps/')))) ? raw : '';
  } catch { return ''; }
}
/** Only strict portable receipts can authorize recovery; callers must also verify raw capture bytes and identity provenance. */
export function captureRefreshReceipts(properties: Record<string, unknown>): CaptureRefreshReceipt[] {
  if (!sourceTags(properties) || !Array.isArray(properties.source_refresh_receipts)) return [];
  const sourceCaptureId = properties.source_capture_id ?? '';
  if (typeof sourceCaptureId !== 'string') return [];
  return properties.source_refresh_receipts.filter((raw): raw is CaptureRefreshReceipt => {
    if (!object(raw) || typeof raw.captureId !== 'string' || !/^[a-f0-9]{64}$/.test(raw.captureId) ||
      typeof raw.captureRevision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.captureRevision) ||
      typeof raw.appliedAt !== 'string' || !Number.isFinite(Date.parse(raw.appliedAt)) || new Date(raw.appliedAt).toISOString() !== raw.appliedAt ||
      !Array.isArray(raw.fields) || raw.fields.some((key: unknown) => !CAPTURE_REFRESH_FIELDS.some(field => field === key)) ||
      new Set(raw.fields).size !== raw.fields.length || typeof raw.captureUrl !== 'string' || !validRefreshListing(raw.captureUrl) ||
      raw.captureIdentity !== canonicalPlaceIdentity(raw.captureUrl) || typeof raw.targetSourceCaptureId !== 'string' ||
      raw.targetSourceCaptureId !== sourceCaptureId) return false;
    return true;
  });
}
export function refreshReceiptFor(properties: Record<string, unknown>, draft: CaptureDraft): CaptureRefreshReceipt | undefined {
  return captureRefreshReceipts(properties).find(receipt => receipt.captureId === draft.captureId &&
    receipt.captureRevision === draft.sourceRevision && receipt.captureUrl === draft.url);
}
export function captureMatchesSource(draft: CaptureDraft, place: PlaceRecord): boolean {
  if (draft.kind !== 'shop' || place.kind !== 'shop') return false;
  if (refreshReceiptFor(place.properties, draft)) return true;
  if (!validRefreshListing(draft.url)) return false;
  const existing = text(place.properties.google_maps_url), identity = canonicalPlaceIdentity(draft.url);
  return !!existing && (existing === draft.url || !!identity && canonicalPlaceIdentity(existing) === identity);
}
const topics = (value: unknown): string[] => Array.isArray(value) && value.length > 0 &&
  value.every(row => typeof row === 'string' && /^.+ \(\d+(?:,\d{3})*\)$/.test(row) && row.length <= 1000)
  ? value.map(row => String(row).trim()) : [];
export function buildCaptureRefreshPreview(draft: CaptureDraft, target: PlaceRecord, rawTarget: string, visitBlocked = false): CaptureRefreshPreview {
  const p = target.properties, date = validSnapshotDate(draft.capturedAt.slice(0, 10)), warnings: string[] = [], blockers: string[] = [];
  if (draft.kind !== 'shop' || target.kind !== 'shop' || !sourceTags(p)) blockers.push('Choose an existing source note. Parking refresh is not supported.');
  if (!draft.sourcePath || !draft.sourceRevision || !/^[a-f0-9]{64}$/.test(draft.sourceRevision) || !/^[a-f0-9]{64}$/.test(draft.captureId)) blockers.push('Reopen the raw capture before reviewing source updates.');
  const completed = !!refreshReceiptFor(p, draft);
  if (!captureMatchesSource(draft, target)) blockers.push('The source no longer matches this exact Google listing. Reopen the capture review.');
  const receipts = captureRefreshReceipts(p);
  if (p.source_refresh_receipts !== undefined && (!Array.isArray(p.source_refresh_receipts) || receipts.length !== p.source_refresh_receipts.length))
    blockers.push('This source has an invalid refresh receipt. Inspect its properties before updating it.');
  if (receipts.some(receipt => receipt.captureId === draft.captureId && !refreshReceiptFor({ ...p, source_refresh_receipts: [receipt] }, draft)))
    blockers.push('This capture identity has conflicting saved refresh details. Inspect both records before retrying.');
  if (visitBlocked && !completed) blockers.push('Resume the unfinished outing visit save for this source before refreshing its Google details.');
  const rows: CaptureRefreshFieldRow[] = [];
  const row = (key: CaptureRefreshField, label: string, current: unknown, incoming: unknown, available: boolean) => {
    const changed = available && json(current) !== json(incoming);
    rows.push({ key, label, current, incoming: available ? incoming : null, available, changed, selected: changed && key !== 'coordinates' && !completed });
  };
  row('google_name', 'Google name', p.google_name ?? '', text(draft.name), !!text(draft.name));
  row('google_maps_url', 'Google Maps listing', p.google_maps_url ?? '', validRefreshListing(draft.url), !!validRefreshListing(draft.url));
  row('address', 'Address', p.address ?? '', text(draft.address), !!text(draft.address));
  row('website', 'Website', p.website ?? '', websiteUrl(draft.website), !!websiteUrl(draft.website));
  row('telephone', 'Telephone', p.telephone ?? '', text(draft.telephone), !!telephoneUrl(draft.telephone));
  const hours = validGoogleHours(draft.hours), oldHours = readGoogleHours(rawTarget);
  row('google_hours', 'Opening hours', { hours: oldHours.hours, checked: oldHours.checked }, { hours, checked: date }, hours.length === 7 && !!date);
  const reviewValid = typeof draft.googleRating === 'number' && Number.isFinite(draft.googleRating) && draft.googleRating >= 1 && draft.googleRating <= 5 &&
    typeof draft.googleReviewCount === 'number' && Number.isSafeInteger(draft.googleReviewCount) && draft.googleReviewCount >= 0 && !!date;
  row('google_reviews', 'Google rating and review count', { rating: p.google_rating ?? null, reviewCount: p.google_review_count ?? null, checked: p.google_checked ?? null },
    { rating: draft.googleRating, reviewCount: draft.googleReviewCount, checked: date }, reviewValid);
  const incomingTopics = topics(draft.topics), oldTopics = readGoogleTopics(rawTarget);
  row('google_review_topics', 'Google review topics', { topics: oldTopics.topics, checked: oldTopics.checked },
    { topics: incomingTopics, checked: date }, incomingTopics.length > 0 && !!date);
  row('coordinates', 'Coordinates', p.coordinates ?? [], validateCoordinates(draft.coordinates), !!validateCoordinates(draft.coordinates));
  for (const item of rows.filter(item => item.available && ['google_hours', 'google_reviews', 'google_review_topics'].includes(item.key))) {
    const previousDate = object(item.current) ? validSnapshotDate(item.current.checked) : '';
    if (previousDate && date < previousDate) warnings.push(item.label + ': this capture predates the saved snapshot (' + previousDate + ').');
  }
  if (!date) warnings.push('The capture has no valid checked date. Dated Google snapshots are unavailable.');
  const fingerprint = json({ targetPath: target.path, kind: target.kind, sourceIdentity: p.source_capture_id ?? '', tags: p.tags, captureId: draft.captureId,
    captureRevision: draft.sourceRevision, capturedAt: draft.capturedAt, fields: rows, receipts: p.source_refresh_receipts ?? [], blockers, completed });
  return { targetPath: target.path, targetName: target.path.split('/').at(-1)!.replace(/\.md$/i, ''), captureId: draft.captureId,
    captureRevision: draft.sourceRevision ?? '', capturedAt: draft.capturedAt, fingerprint, fields: rows, warnings, blockers, completed };
}
/** Build only the explicitly selected property patch; personal and organisational fields cannot enter this allowlist. */
export function captureRefreshPatch(preview: CaptureRefreshPreview, selected: CaptureRefreshField[]): Record<string, unknown> {
  if (new Set(selected).size !== selected.length || selected.some(key => !CAPTURE_REFRESH_FIELDS.includes(key))) throw new Error('Choose valid source update fields.');
  const patch: Record<string, unknown> = {};
  for (const key of selected) {
    const row = preview.fields.find(field => field.key === key);
    if (!row?.available || !row.changed) throw new Error('That captured value is unavailable or unchanged. Refresh the comparison.');
    if (key === 'google_reviews') {
      const value = row.incoming as { rating: number; reviewCount: number; checked: string };
      patch.google_rating = value.rating; patch.google_review_count = value.reviewCount; patch.google_checked = value.checked;
    } else if (key === 'google_hours') {
      const value = row.incoming as { hours: string[]; checked: string };
      patch.google_hours = value.hours; patch.google_hours_checked = value.checked;
    } else if (key === 'google_review_topics') {
      const value = row.incoming as { topics: string[]; checked: string };
      patch.google_review_topics = value.topics; patch.google_review_topics_checked = value.checked;
    } else patch[key] = row.incoming;
  }
  return patch;
}
