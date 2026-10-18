import test from 'node:test';
import assert from 'node:assert/strict';
import type { App, TFile } from 'obsidian';
import { SourcingStore } from '../src/storage/store';
import { appendVisit, readNote, writeNote } from '../src/storage/markdown';
import { ASSET_VERSION } from '../src/storage/assets';
import { DEFAULT_SETTINGS } from '../src/types';
import type { CaptureDraft, Settings } from '../src/types';

import { fixture, newDraft } from './storage-fixtures';

test('setup creates owned components, repeats safely and preserves user-edited components', async () => {
  const f = fixture();
  const first = await f.store.setup(); assert.equal(first.created.length, 8); assert.deepEqual(first.conflicts, []);
  const count = f.vault.getFiles().length;
  const repeat = await f.store.setup(); assert.equal(f.vault.getFiles().length, count); assert.deepEqual(repeat.created, []);
  const home = f.vault.getAbstractFileByPath('Reseller sourcing/Home.md') as TFile;
  await f.vault.process(home, text => text + '\nMy home notes\n');
  const conflict = await f.store.setup(); assert.ok(conflict.conflicts.includes(home.path)); assert.match(await f.vault.read(home), /My home notes/);
  f.vault.entries.delete('Reseller sourcing/System/Templates/Source.md');
  assert.ok((await f.store.setup()).created.includes('Reseller sourcing/System/Templates/Source.md'));
  assert.equal(f.settings.setupVersion, ASSET_VERSION);
});
test('initial setup refuses occupied unrelated root and never escapes its root', async () => {
  const f = fixture(); await f.vault.create('Reseller sourcing/My note.md', 'Personal');
  await assert.rejects(f.store.setup(), /empty folder/);
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath('Reseller sourcing/My note.md') as TFile), 'Personal');
  f.settings.root = '../Maps'; await assert.rejects(f.store.setup(), /relative vault folder/);
});
test('localities use a shared Places folder without repeated maps and place notes retain normal width', async () => {
  const f = fixture(); await f.store.setup();
  const locality = await f.store.ensureLocality('Riverside');
  assert.equal((await f.store.ensureLocality('riverside')).path, locality.path);
  assert.ok(f.vault.getAbstractFileByPath('Reseller sourcing/Places/Riverside/Area.md'));
  assert.equal(f.vault.getFiles().some(f => f.path.endsWith('/Area map.base')), false);
  const shop = await f.store.saveCapture(newDraft(), locality.path, 'Fixture Charity - Riverside');
  const note = readNote(await f.vault.read(shop));
  assert.equal(note.properties.locality, '[[Reseller sourcing/Places/Riverside/Area]]');
  assert.equal(note.properties.rating, 0); assert.equal(note.properties.shortlist, false); assert.equal(note.properties.last_visited, null);
  assert.equal(note.properties.cssclasses, undefined); assert.match(note.body, /^```charity-sourcing/); assert.equal(/^# Fixture Charity/m.test(note.body), false);
  assert.equal((await f.store.listPlaces()).length, 1); assert.equal((await f.store.listLocalities()).length, 1);
});
test('capture save keeps raw source, refuses existing filenames and survives missing receipts', async () => {
  const f = fixture(); await f.store.setup(); const locality = await f.store.ensureLocality('Town');
  const capture = await f.vault.create('Reseller sourcing/Capture inbox/Capture.md', writeNote({ sourcing_capture: 1, template_version: 1, capture_kind: 'shop', google_name: 'Captured Shop', google_maps_url: '', captured_at: '2026-10-14' }, ''));
  const draft = await f.store.draft(capture);
  const place = await f.store.saveCapture(draft, locality.path, 'Captured Shop');
  assert.equal(f.vault.getAbstractFileByPath(draft.sourcePath!), null);
  assert.ok(f.vault.getAbstractFileByPath(`Reseller sourcing/System/Capture archive/${draft.captureId}.md`));
  delete f.settings.captureReceipts[draft.captureId];
  const restarted = new SourcingStore(f.app, f.settings, f.save);
  assert.equal((await restarted.saveCapture(draft, locality.path, 'Duplicate')).path, place.path);
  assert.equal((await f.store.listPlaces()).length, 1);
  const before = await f.vault.read(place);
  await assert.rejects(f.store.saveCapture(newDraft('second'), locality.path, 'Captured Shop'), /already exists/);
  assert.equal(await f.vault.read(place), before);
});
test('capture edits invalidate review and archive failures recover without duplicate place', async () => {
  const f = fixture(); await f.store.setup(); const locality = await f.store.ensureLocality('Town');
  const raw = writeNote({ sourcing_capture: 1, template_version: 1, capture_kind: 'shop', google_name: 'Shop' }, '');
  const capture = await f.vault.create('Reseller sourcing/Capture inbox/Raw.md', raw);
  const oldDraft = await f.store.draft(capture); await f.vault.process(capture, text => text + '\nChanged');
  await assert.rejects(f.store.saveCapture(oldDraft, locality.path, 'Shop'), /capture changed/);
  const currentDraft = await f.store.draft(capture);
  f.vault.failRename = true;
  await assert.rejects(f.store.saveCapture(currentDraft, locality.path, 'Shop'), /archive error/);
  assert.equal((await f.store.listPlaces()).length, 1);
  await f.store.saveCapture(currentDraft, locality.path, 'Shop');
  assert.equal((await f.store.listPlaces()).length, 1); assert.equal(f.vault.getAbstractFileByPath(currentDraft.sourcePath!), null);
});
test('canonical Google identity prevents duplicate capture after panning and invalid coordinates never save', async () => {
  const f = fixture(); await f.store.setup(); const locality = await f.store.ensureLocality('Town');
  const url = 'https://www.google.com/maps/place/Shop/@53,1,16z/data=!4m6!3m5!1s0xa:0xb!8m2!3d12.3!4d45.6!16sabc';
  const one = { ...newDraft('first-google'), url };
  await f.store.saveCapture(one, locality.path, 'Shop');
  await assert.rejects(f.store.saveCapture({ ...one, captureId: 'second-google', url: url.replace('@53,1,16z', '@10,20,7z') }, locality.path, 'Different filename'), /already has a note/);
  await assert.rejects(f.store.saveCapture({ ...newDraft('invalid'), coordinates: [91, 0] }, locality.path, 'Invalid location'), /Coordinates are invalid/);
  assert.equal((await f.store.listPlaces()).length, 1);
});
test('linked visits retain separate records, concurrent source prose, backdated independence and shortlist', async () => {
  const f = fixture(); await f.store.setup(); const locality = await f.store.ensureLocality('Town');
  const shop = await f.store.saveCapture(newDraft(), locality.path, 'Shop');
  await f.vault.process(shop, text => { const n = readNote(text); n.properties.shortlist = true; n.properties.last_visited = '2026-10-13'; return writeNote(n.properties, n.body); });
  const initialBody = readNote(await f.vault.read(shop)).body, process = f.vault.process.bind(f.vault); let inject = true;
  f.vault.process = async (file, transform) => process(file, text => {
    if (file.path === shop.path && inject) { inject = false; return transform(text + '\nConcurrent personal note\n'); }
    return transform(text);
  });
  await f.store.addVisit(shop.path, { observations: 'First visit', finds: '', nextTime: '', visitDate: '2026-09-01', updateLastVisited: false });
  await f.store.addVisit(shop.path, { observations: 'Second visit', finds: 'Jacket', nextTime: '', visitDate: '2026-09-02', updateLastVisited: false });
  const note = readNote(await f.vault.read(shop)), visits = await f.store.visits.list(shop.path);
  assert.equal(note.properties.last_visited, '2026-10-13'); assert.equal(note.properties.shortlist, true); assert.equal(note.body, initialBody);
  assert.deepEqual(visits.map(visit => visit.observations), ['Second visit', 'First visit']);
  assert.equal(visits.length, 2);
  await f.store.addVisit(shop.path, { observations: 'Explicit', finds: '', nextTime: '', visitDate: '2026-10-14', updateLastVisited: true });
  assert.equal(readNote(await f.vault.read(shop)).properties.last_visited, '2026-10-14');
  assert.match(readNote(await f.vault.read(shop)).body, /Concurrent personal note/);
  const before = await f.vault.read(shop);
  await assert.rejects(f.store.addVisit(shop.path, { observations: '', finds: '', nextTime: '', visitDate: '2026-10-14', updateLastVisited: false }), /details/);
  assert.equal(await f.vault.read(shop), before);
});

test('visit date rejects calendar overflow and records actual time independently', () => {
  const raw = writeNote({ shortlist: true, last_visited: '2026-10-01' }, '## Visit log\n');
  const input = { observations: 'Backdated', finds: '', nextTime: '', visitDate: '2026-09-01', updateLastVisited: false };
  const result = appendVisit(raw, input, new Date(2026, 9, 14, 15, 32));
  assert.match(result, /### 2026-10-14 15:32/); assert.match(result, /Visit date: 2026-09-01/);
  assert.throws(() => appendVisit(raw, { ...input, visitDate: '2026-02-30' }), /valid visit date/);
});
test('parking supports repeated links, shared notes and explicit preference without replacing content', async () => {
  const f = fixture(); await f.store.setup(); const locality = await f.store.ensureLocality('Town');
  const shop = await f.store.saveCapture(newDraft('shop-1'), locality.path, 'Shop');
  const other = await f.store.saveCapture(newDraft('shop-2'), locality.path, 'Other shop');
  const parking = await f.store.saveCapture(newDraft('parking-1', 'parking'), locality.path, 'Car park');
  await f.store.linkParking(parking.path, shop.path, true); await f.store.linkParking(parking.path, shop.path); await f.store.linkParking(parking.path, other.path);
  const p = readNote(await f.vault.read(parking)); assert.equal((p.properties.parking_for as string[]).length, 2);
  assert.equal(readNote(await f.vault.read(shop)).properties.parking_location, '[[Reseller sourcing/Places/Town/Car park]]');
  await f.store.updateCoordinates(parking.path, [12.4, 45.7]); assert.deepEqual(readNote(await f.vault.read(parking)).properties.coordinates, [12.4, 45.7]);
  await assert.rejects(f.store.updateCoordinates(parking.path, [91, 0]), /invalid/);
  await assert.rejects(f.store.linkParking(shop.path, parking.path), /Choose a shop/);
});
