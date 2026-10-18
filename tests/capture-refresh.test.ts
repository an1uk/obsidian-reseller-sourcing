import test from 'node:test';
import assert from 'node:assert/strict';
import type { CaptureDraft, PlaceRecord } from '../src/types';
import { buildCaptureRefreshPreview, captureMatchesSource, captureRefreshPatch, captureRefreshReceipts } from '../src/capture/refresh';
import { writeNote } from '../src/storage/markdown';
import { newDraft } from './storage-fixtures';

const url = 'https://www.google.com/maps/place/Shop/@1,2,9z/data=!4m6!3m5!1s0xa:0xb!8m2!3d12.3!4d45.6!16sabc';
const hours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => day + ', 09:00 to 17:00');
const draft = (): CaptureDraft => ({ ...newDraft('a'.repeat(64)), sourcePath: 'Reseller sourcing/Capture inbox/New.md', sourceRevision: 'b'.repeat(64), url, hours, website: 'example.org', telephone: '+44 1632 960456' });
const place = (properties: Record<string, unknown> = {}): PlaceRecord => ({ path: 'Reseller sourcing/Sources/Town/Shop.md', name: 'Shop', kind: 'shop', locality: '', coordinates: [12.4, 45.7],
  properties: { tags: ['sourcing-source'], source_capture_id: 'original', google_name: 'Old shop', google_maps_url: url, rating: 4.5, ...properties } });
const preview = (capture = draft(), target = place(), body = 'Personal notes\n') => buildCaptureRefreshPreview(capture, target, writeNote(target.properties, body));

test('refresh matching is exact listing or existing canonical identity, never same name or nearby coordinates', () => {
  assert.equal(captureMatchesSource(draft(), place()), true);
  assert.equal(captureMatchesSource({ ...draft(), url: url.replace('@1,2,9z', '@70,80,4z') }, place()), true);
  assert.equal(captureMatchesSource({ ...draft(), url: 'https://www.google.com/maps/place/Shop' }, place()), false);
  assert.equal(captureMatchesSource(draft(), { ...place(), kind: 'parking' }), false);
  assert.equal(captureMatchesSource({ ...draft(), kind: 'parking' }, place()), false);
  assert.equal(captureMatchesSource({ ...draft(), url: '' }, place({ google_maps_url: '' })), false);
});

test('nonempty valid changes preselect independently while coordinates stay unchecked', () => {
  const p = preview();
  assert.equal(p.blockers.length, 0);
  assert.equal(p.fields.find(row => row.key === 'google_name')?.selected, true);
  assert.equal(p.fields.find(row => row.key === 'coordinates')?.available, true);
  assert.equal(p.fields.find(row => row.key === 'coordinates')?.selected, false);
  const patch = captureRefreshPatch(p, ['google_name', 'website', 'google_reviews', 'google_hours', 'google_review_topics']);
  assert.equal(patch.google_name, 'Fixture Charity'); assert.equal(patch.website, 'https://example.org/');
  assert.equal(patch.google_checked, '2026-10-14'); assert.equal(patch.google_hours_checked, '2026-10-14');
  assert.equal(patch.google_review_topics_checked, '2026-10-14');
  assert.equal(patch.coordinates, undefined); assert.equal(patch.rating, undefined);
  assert.throws(() => captureRefreshPatch(p, ['rating' as never]), /valid/);
  assert.throws(() => captureRefreshPatch(p, ['address', 'address']), /valid/);
});

test('missing invalid and incomplete incoming fields cannot erase existing values', () => {
  const p = preview({ ...draft(), name: '', address: '', website: 'javascript:alert(1)', telephone: 'not a number',
    coordinates: [100, 0], hours: hours.slice(0, 6), topics: [], googleRating: 4.3, googleReviewCount: null });
  for (const key of ['google_name', 'address', 'website', 'telephone', 'coordinates', 'google_hours', 'google_review_topics', 'google_reviews']) {
    const row = p.fields.find(row => row.key === key)!;
    assert.equal(row.available, false, key); assert.equal(row.selected, false, key); assert.equal(row.incoming, null, key);
    assert.throws(() => captureRefreshPatch(p, [key as never]), /unavailable/);
  }
  const zero = preview({ ...draft(), googleReviewCount: 0 });
  assert.equal(zero.fields.find(row => row.key === 'google_reviews')?.available, true);
  assert.equal(captureRefreshPatch(zero, ['google_reviews']).google_review_count, 0);
});

test('hours require each distinct weekday and legacy hours participate in comparison without body rewrite', () => {
  const target = place({ google_checked: '2026-10-16' });
  const body = '> [!info]- Opening hours and Google details\n> **Opening hours**\n' + hours.map(row => '> - ' + row).join('\n') + '\n> **Review topics**\n> - staff (2)\n';
  const p = preview(draft(), target, body);
  assert.deepEqual((p.fields.find(row => row.key === 'google_hours')!.current as { hours: string[] }).hours, hours);
  assert.ok(p.warnings.some(warning => warning.startsWith('Opening hours:')));
  const duplicateDay = preview({ ...draft(), hours: [hours[0]!, ...hours.slice(0, 6)] });
  assert.equal(duplicateDay.fields.find(row => row.key === 'google_hours')?.available, false);
});

test('review snapshot dates are independent and older captures are warnings requiring review', () => {
  const p = preview(draft(), place({ google_rating: 4.5, google_review_count: 100, google_checked: '2026-10-17',
    google_hours: hours, google_hours_checked: '2026-10-15', google_review_topics: ['staff (12)'], google_review_topics_checked: '2026-10-16' }));
  assert.equal(p.warnings.length, 3);
  const patch = captureRefreshPatch(p, ['telephone']);
  assert.deepEqual(Object.keys(patch), ['telephone']);
  const undated = preview({ ...draft(), capturedAt: '' });
  assert.equal(undated.fields.find(row => row.key === 'google_reviews')?.available, false);
  assert.equal(undated.fields.find(row => row.key === 'address')?.available, true);
});

test('fingerprint ignores personal text and assessment but catches compared values and source identity', () => {
  const a = preview();
  assert.equal(preview(draft(), place({ rating: 0, comments: 'new personal fact' }), 'Another personal body\n').fingerprint, a.fingerprint);
  assert.notEqual(preview(draft(), place({ website: 'https://new.example/' })).fingerprint, a.fingerprint);
  assert.notEqual(preview(draft(), place({ source_capture_id: 'replaced' })).fingerprint, a.fingerprint);
  assert.ok(preview(draft(), place(), '').blockers.length === 0);
  assert.ok(buildCaptureRefreshPreview(draft(), place(), writeNote(place().properties, ''), true).blockers.some(value => /unfinished/.test(value)));
});

test('strict portable receipts preserve capture identity across later listing changes and reject malformed metadata', () => {
  const p = preview(), receipt = { captureId: p.captureId, captureRevision: p.captureRevision, appliedAt: '2026-10-17T12:00:00.000Z',
    fields: ['address'], captureUrl: url, captureIdentity: 'google:0xa:0xb', targetSourceCaptureId: 'original' };
  const target = place({ google_maps_url: 'https://www.google.com/maps/place/Changed', source_refresh_receipts: [receipt] });
  assert.equal(captureRefreshReceipts(target.properties).length, 1);
  const completed = preview(draft(), target); assert.equal(completed.completed, true); assert.equal(completed.blockers.length, 0);
  assert.equal(completed.fields.some(row => row.selected), false);
  for (const bad of [{ ...receipt, fields: ['rating'] }, { ...receipt, captureRevision: 'bad' }, { ...receipt, targetSourceCaptureId: 'other' }, { ...receipt, captureIdentity: 'wrong' }]) {
    const props = { ...target.properties, source_refresh_receipts: [bad] };
    assert.equal(captureRefreshReceipts(props).length, 0);
    assert.ok(preview(draft(), place(props)).blockers.some(value => /invalid refresh receipt/.test(value)));
  }
});
