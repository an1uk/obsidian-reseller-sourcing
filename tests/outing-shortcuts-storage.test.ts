import test from 'node:test';
import assert from 'node:assert/strict';
import type { OutingPreparation, PreparationDraft } from '../src/workspace/types';
import { checkedRoute } from '../src/workspace/routes';
import { checkedViewState } from '../src/workspace/view-state';
import { defaultShortTripOptions, shortTripForm } from '../src/outings/short-trip';
import { fixture, newDraft } from './storage-fixtures';

function preparation(root: string): PreparationDraft<OutingPreparation> {
  const shortTrip = defaultShortTripOptions(new Date(2026, 9, 20, 10, 0));
  shortTrip.form = shortTripForm(shortTrip);
  return { schema: 1, id: crypto.randomUUID(), root, kind: 'outing', updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '',
    data: { name: '', groups: [], step: 1, unresolved: [], shortTrip, filter: { text: '', area: '', shortlist: false, type: '', view: 'list' } } };
}

test('catch-up routes remain pane-local and reject cross-context or disguised paths', () => {
  const root = 'Notebook', path = root + '/Outings/2026/10/Trip.md';
  assert.deepEqual(checkedRoute(root, { screen: 'outing-catchup', path }), { screen: 'outing-catchup', path });
  assert.deepEqual(checkedViewState({ root, route: { screen: 'outing-catchup', path } })?.route, { screen: 'outing-catchup', path });
  for (const invalid of ['Other/Outings/Trip.md', root + '/Examples/Outings/Trip.md', root + '/Places/Trip.md', root + '/Outings/../Trip.md'])
    assert.deepEqual(checkedRoute(root, { screen: 'outing-catchup', path: invalid }), { screen: 'home' });
});

test('short-trip drafts preserve invalid intermediate fields without creating an outing', async () => {
  const f = fixture(); await f.store.setup(); const input = preparation(f.settings.root);
  const options = input.data.shortTrip!; options.form!.budgetMinutes = ''; options.form!.departureTime = ''; options.form!.latitude = 'not finished';
  options.form!.startKind = 'coordinates'; input.data.reviewWarnings = ['Review before using a suggestion.'];
  const saved = await f.store.preparations.save(input, '');
  const reopened = await f.store.preparations.get(saved.id); assert.equal(reopened?.kind, 'outing');
  if (reopened?.kind !== 'outing') throw Error('Expected outing preparation');
  assert.deepEqual(reopened.data, input.data); assert.equal((await f.store.outings.list()).length, 0);
  const inspected = await f.store.preparations.inspect(); assert.equal(inspected.drafts.length, 1); assert.deepEqual(inspected.warnings, []);
});

test('short-trip drafts reject foreign areas, saved starts and hidden planning anchors', async () => {
  const f = fixture(); await f.store.setup();
  for (const field of ['area', 'saved', 'planning'] as const) {
    const input = preparation(f.settings.root), options = input.data.shortTrip!, outside = f.settings.root + '/Examples/Places/Parking.md';
    if (field === 'area') options.areaPath = outside;
    if (field === 'saved') options.form!.savedPath = outside;
    if (field === 'planning') options.planning.start = { kind: 'record', path: outside };
    await assert.rejects(f.store.preparations.save(input, ''), /another notebook|needs review/);
  }
  assert.equal((await f.store.preparations.inspect()).drafts.length, 0);
});

test('saved short-trip starts follow reviewed place and notebook moves', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: '', locality: '' }, 'Fictional source', { allowUnassigned: true });
  const input = preparation(f.settings.root), options = input.data.shortTrip!;
  options.form!.savedPath = source.path; options.planning.start = { kind: 'record', path: source.path };
  const saved = await f.store.preparations.save(input, '');
  const target = { town: 'Exampletown', locality: 'Riverside' };
  const preview = await f.store.previewPlaceAreaChange(source.path, target); await f.store.changePlaceArea(source.path, target, preview);
  const after = await f.store.preparations.get(saved.id); if (after?.kind !== 'outing') throw Error('Expected preparation');
  assert.match(after.data.shortTrip!.form!.savedPath, /Riverside/);
  assert.deepEqual(after.data.shortTrip!.planning.start, { kind: 'record', path: after.data.shortTrip!.form!.savedPath });
  await f.store.moveNotebook('Moved notebook');
  const moved = await f.store.preparations.get(saved.id); if (moved?.kind !== 'outing') throw Error('Expected moved preparation');
  assert.match(moved.data.shortTrip!.form!.savedPath, /^Moved notebook\/Places\//);
  assert.deepEqual(moved.data.shortTrip!.planning.start, { kind: 'record', path: moved.data.shortTrip!.form!.savedPath });
});

test('a short-trip form cannot overwrite a discarded or concurrently changed preparation', async () => {
  const f = fixture(); await f.store.setup();
  const saved = await f.store.preparations.save(preparation(f.settings.root), '');
  const other = structuredClone(saved); other.data.shortTrip!.form!.budgetMinutes = '90';
  const changed = await f.store.preparations.save(other, saved.revision);
  await assert.rejects(f.store.preparations.save(saved, saved.revision), /changed/);
  const discarded = await f.store.preparations.transition(changed.id, changed.revision, 'discarded');
  await assert.rejects(f.store.preparations.save(changed, discarded.revision), /closed/);
  assert.equal((await f.store.preparations.inspect()).drafts.length, 0);
});
