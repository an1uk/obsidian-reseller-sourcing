import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings } from '../src/platform/settings-data';
import { SourcingStore } from '../src/storage/store';
import { fixture, newDraft } from './storage-fixtures';

test('remembered choices are optional, allowlisted and scoped to their notebook', () => {
  const root = 'Notebook';
  const input = { root, shortTripDefaults: { startPath: root + '/Places/Unassigned/Parking.md', budgetMinutes: 45, returnToStart: false, latitude: 1, longitude: 2 } };
  const parsed = parseSettings(input);
  assert.deepEqual(parsed.shortTripDefaults, { startPath: input.shortTripDefaults.startPath, budgetMinutes: 45, returnToStart: false });
  assert.equal(Object.hasOwn(parseSettings(undefined), 'shortTripDefaults'), false);
  for (const startPath of ['Other/Places/Parking.md', root + '/Examples/Places/Parking.md', root + '/Places/../Outside.md', root + '/Places\\Bad.md'])
    assert.throws(() => parseSettings({ root, shortTripDefaults: { startPath } }), /notebook/);
  for (const value of [{ budgetMinutes: 0 }, { visitMinutes: 2.2 }, { maxStops: 7 }, { returnToStart: 'yes' }])
    assert.throws(() => parseSettings({ root, shortTripDefaults: value }), /invalid|whole number/);
  parsed.shortTripDefaults!.budgetMinutes = 90;
  assert.equal(input.shortTripDefaults.budgetMinutes, 45);
});

test('explicit remembered choices do not create an outing, alter drafts or update place notes', async () => {
  const f = fixture(); await f.store.setup();
  const parking = await f.store.saveCapture(newDraft('parking-default', 'parking'), { town: '', locality: '' }, 'Fictional parking', { allowUnassigned: true });
  const before = await f.vault.read(parking);
  await f.store.rememberShortTripDefaults({ startPath: parking.path, budgetMinutes: 60, maxStops: 3, visitMinutes: 20, returnToStart: false });
  assert.equal(f.persisted()?.shortTripDefaults?.startPath, parking.path);
  assert.equal(await f.vault.read(parking), before);
  assert.deepEqual(await f.store.preparations.inspect(), { drafts: [], warnings: [] });
  assert.equal((await f.store.outings.list()).length, 0);
  await f.store.rememberShortTripDefaults();
  assert.equal(Object.hasOwn(f.settings, 'shortTripDefaults'), false);
  assert.equal(Object.hasOwn(f.persisted()!, 'shortTripDefaults'), false);
});

test('failed preference persistence restores exact prior preferences and leaves records alone', async () => {
  const f = fixture(); await f.store.setup();
  f.settings.shortTripDefaults = { budgetMinutes: 45, returnToStart: false };
  const previous = structuredClone(f.settings);
  const failed = new SourcingStore(f.app, f.settings, async () => { throw Error('Storage unavailable'); });
  await assert.rejects(failed.rememberShortTripDefaults({ budgetMinutes: 90 }), /Storage unavailable/);
  assert.deepEqual(f.settings, previous);
  await assert.rejects(failed.rememberShortTripDefaults(), /Storage unavailable/);
  assert.deepEqual(f.settings, previous);
});

test('unusable and foreign remembered starts cannot be saved', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture({ ...newDraft('no-pin'), coordinates: null }, { town: '', locality: '' }, 'Fictional no pin', { allowUnassigned: true });
  for (const startPath of [source.path, f.settings.root + '/Places/Unassigned/Deleted.md', f.settings.root + '/Examples/Places/Parking.md'])
    await assert.rejects(f.store.rememberShortTripDefaults({ startPath, budgetMinutes: 60 }), /coordinates|notebook/);
  assert.equal(f.settings.shortTripDefaults, undefined);
});

test('remembered starting points follow reviewed place and whole-notebook moves', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft('moving-start'), { town: '', locality: '' }, 'Fictional starting point', { allowUnassigned: true });
  await f.store.rememberShortTripDefaults({ startPath: source.path, budgetMinutes: 30 });
  const target = { town: 'Exampletown', locality: 'Riverside' };
  const preview = await f.store.previewPlaceAreaChange(source.path, target);
  await f.store.changePlaceArea(source.path, target, preview);
  assert.match(f.settings.shortTripDefaults!.startPath!, /Riverside/);
  await f.store.moveNotebook('Moved notebook');
  assert.match(f.settings.shortTripDefaults!.startPath!, /^Moved notebook\/Places\//);
  assert.deepEqual(parseSettings(f.persisted()).shortTripDefaults, f.settings.shortTripDefaults);
});

test('remembered defaults are included in backed-up migration snapshots and explicit rollback', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft('rollback-start'), { town: '', locality: '' }, 'Fictional source', { allowUnassigned: true });
  await f.store.rememberShortTripDefaults({ startPath: source.path, budgetMinutes: 60 });
  const before = structuredClone(f.settings.shortTripDefaults);
  let stopped = false;
  const store = new SourcingStore(f.app, f.settings, async () => {
    if (!stopped && f.settings.root === 'Moved notebook') { stopped = true; throw Error('Interrupted settings save'); }
  });
  await assert.rejects(store.moveNotebook('Moved notebook'), /stopped safely/);
  assert.deepEqual(f.settings.migration!.settingsBefore.shortTripDefaults, before);
  assert.deepEqual(parseSettings(f.settings).migration!.settingsBefore.shortTripDefaults, before);
  await store.rollbackMove();
  assert.equal(f.settings.root, 'Reseller sourcing');
  assert.deepEqual(f.settings.shortTripDefaults, before);
});
