import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { canonicalPlaceIdentity, parseGooglePlaceUrl } from '../src/domain';
import { captureMatchesSource, captureRefreshReceipts, type CaptureRefreshReceipt } from '../src/capture/refresh';
import { sameGoogleListing } from '../src/place-edit/model';
import { readNote, updateNoteProperty, writeNote } from '../src/storage/markdown';
import { fixture, newDraft } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { DEFAULT_SETTINGS } from '../src/types';

const full = 'https://www.google.com/maps/place/Shop/@1,2,9z/data=!4m6!3m5!1s0xa:0xb!8m2!3d12.3!4d45.6!16sabc';
const unlocated = 'https://www.google.com/maps/place/Shop/@20,30,7z/data=!4m3!3m2!1s0xa:0xb!16sabc';
const panned = unlocated.replace('@20,30,7z', '@40,50,8z');
const identity = 'google:0xa:0xb';
const properties = (url: string) => ({
  sourcing_capture: 1, template_version: 2, capture_kind: 'shop', google_name: 'Captured name', google_maps_url: url,
  google_rating_raw: '4.7', google_review_count_raw: '20', captured_at: '2026-10-22T12:00:00Z',
});

test('selected listing identity remains exact when coordinates are absent, invalid or ambiguous', () => {
  for (const url of [unlocated, panned, full.replace('!3d12.3', '!3d999'),
    full.replace('!4m6!3m5', '!4m9!3m8').replace('!16sabc', '!8m2!3d1!4d2!16sabc')]) {
    const parsed = parseGooglePlaceUrl(url);
    assert.equal(parsed.coordinates, null, url);
    assert.ok(parsed.issue);
    assert.equal(parsed.placeId, '0xa:0xb');
    assert.equal(canonicalPlaceIdentity(url), identity);
    assert.equal(sameGoogleListing(full, url), true);
  }
  assert.deepEqual(parseGooglePlaceUrl(full).coordinates, [12.3, 45.6]);
  assert.equal(sameGoogleListing(unlocated, panned), true);
});

test('unlocated identity comes only from the unique selected node, never previous or camera context', () => {
  const previous = 'https://www.google.com/maps/place/Shop/@1,2,3z/data=!4m11!1m7!3m6!1s0x1:0x2!2sPrevious!8m2!3d12.3!4d45.6!16sabc!3m2!1s0xa:0xb!16sdef';
  assert.equal(canonicalPlaceIdentity(previous), identity);
  assert.equal(parseGooglePlaceUrl(previous).coordinates, null);
  for (const url of [
    'https://www.google.com/maps/place/Shop/@1,2,3z',
    unlocated.replace('!4m3', '!4m99'),
    'https://www.google.com/maps/place/Shop/data=!4m6!3m2!1s0xa:0xb!16sx!3m2!1s0xc:0xd!16sy',
    'https://www.google.com/maps/place/Shop/data=!4m4!3m3!1s0xa:0xb!1s0xc:0xd!16sx',
    previous.replace('!3m2!1s0xa:0xb!16sdef', '!3m2!2sSelected!16sdef'),
  ]) {
    assert.equal(parseGooglePlaceUrl(url).coordinates, null);
    assert.equal(parseGooglePlaceUrl(url).placeId, undefined);
    assert.equal(canonicalPlaceIdentity(url), null, url);
  }
});

test('raw coordinate-less captures refresh the existing source and cannot create duplicates after panning', async () => {
  for (const originalUrl of [full, unlocated]) {
    const f = fixture(); f.app.vault.rename = f.vault.renameFile.bind(f.vault); await f.store.setup();
    const area = await f.store.ensureLocality('Exampletown');
    const source = await f.store.saveCapture({ ...newDraft('original'), url: originalUrl }, area.path, 'Original');
    const capture = await f.vault.create(f.store.root + '/Capture inbox/Unlocated.md', writeNote(properties(panned), 'Raw capture text'));
    const draft = await f.store.draft(capture), place = (await f.store.listPlaces())[0]!;
    assert.equal(draft.coordinates, null);
    assert.equal(captureMatchesSource(draft, place), true);
    assert.deepEqual((await f.store.captureRefreshMatches(draft)).map(item => item.path), [source.path]);
    await assert.rejects(f.store.saveCapture(draft, area.path, 'Duplicate'), /already has a note/);
    assert.equal((await f.store.listPlaces()).length, 1);
    const preview = await f.store.previewCaptureRefresh(draft, source.path);
    assert.deepEqual(preview.blockers, []);
    assert.equal(preview.fields.find(row => row.key === 'coordinates')!.available, false);
    await f.store.applyCaptureRefresh(draft, preview, ['google_name', 'google_reviews']);
    const saved = readNote(await f.vault.read(source)).properties;
    assert.equal(saved.google_name, 'Captured name');
    assert.deepEqual(saved.coordinates, [12.3, 45.6]);
    assert.equal(captureRefreshReceipts(saved)[0]!.captureIdentity, identity);
    assert.equal((await f.store.listPlaces()).length, 1);
  }
});

test('receipt validation accepts only the exact former identity for newly recognised unlocated listings', () => {
  const receipt = (url: string, captureIdentity: string | null): CaptureRefreshReceipt => ({
    captureId: 'a'.repeat(64), captureRevision: 'b'.repeat(64), appliedAt: '2026-10-22T12:00:00.000Z',
    fields: ['google_name'], captureUrl: url, captureIdentity, targetSourceCaptureId: 'original',
  });
  const accepted = (url: string, captureIdentity: string | null) => captureRefreshReceipts({
    tags: ['sourcing-source'], source_capture_id: 'original', source_refresh_receipts: [receipt(url, captureIdentity)],
  }).length;
  assert.equal(accepted(unlocated, identity), 1);
  assert.equal(accepted(unlocated, null), 1);
  assert.equal(accepted(unlocated + '?query_place_id=ChIJlegacy', 'google:ChIJlegacy'), 1);
  assert.equal(accepted(unlocated + '?cid=123456', 'google-cid:123456'), 1);
  assert.equal(accepted(unlocated + '?query_place_id=ChIJlegacy', null), 0);
  assert.equal(accepted(full, null), 0);
  assert.equal(accepted(full + '?cid=123456', 'google-cid:123456'), 0);
  assert.equal(accepted(unlocated, 'google:other'), 0);
});

test('a legacy null-identity receipt completes archival without replaying source updates', async () => {
  const f = fixture(); f.app.vault.rename = f.vault.renameFile.bind(f.vault); await f.store.setup();
  const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture({ ...newDraft('original'), url: unlocated }, area.path, 'Original');
  const raw = writeNote(properties(unlocated), 'Unchanged raw capture');
  const capture = await f.vault.create(f.store.root + '/Capture inbox/Pending.md', raw), draft = await f.store.draft(capture);
  const receipt: CaptureRefreshReceipt = {
    captureId: draft.captureId, captureRevision: draft.sourceRevision!, appliedAt: '2026-10-22T12:00:00.000Z',
    fields: ['google_name'], captureUrl: unlocated, captureIdentity: null, targetSourceCaptureId: 'original',
  };
  await f.vault.process(source, text => updateNoteProperty(updateNoteProperty(updateNoteProperty(text,
    'source_refresh_receipts', [receipt]), 'google_name', 'Later manual correction'), 'google_maps_url', 'https://www.google.com/maps/place/Corrected'));
  const before = await f.vault.read(source), preview = await f.store.previewCaptureRefresh(draft, source.path);
  assert.equal(preview.completed, true); assert.deepEqual(preview.blockers, []);
  await f.store.applyCaptureRefresh(draft, preview, ['google_name']);
  assert.equal(await f.vault.read(source), before);
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(f.store.paths.archives + '/' + draft.captureId + '.md') as TFile), raw);
  assert.equal(captureRefreshReceipts(readNote(await f.vault.read(source)).properties).length, 1);
  const settings = structuredClone(DEFAULT_SETTINGS), secondDevice = new SourcingStore(f.app, settings, async () => {});
  const attachment = await secondDevice.inspectExistingNotebook(f.store.root);
  assert.deepEqual(attachment.blockers, []);
  await secondDevice.attachExistingNotebook(f.store.root, attachment.fingerprint);
  assert.equal(settings.captureReceipts[draft.captureId], source.path);
  assert.equal(await f.vault.read(source), before);
});
