import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import type { OutingPreparation, PreparationDraft } from '../src/workspace/types';
import { checkedViewState } from '../src/workspace/view-state';
import { defaultPlaceQuery, queryPlaces, serialisePlaceQuery, type PlaceQuery } from '../src/workspace/place-query';
import { fixture, newDraft } from './storage-fixtures';

function outingDraft(root: string, data: OutingPreparation): PreparationDraft<OutingPreparation> {
  return { schema: 1, id: crypto.randomUUID(), kind: 'outing', root, updatedAt: new Date().toISOString(),
    deferred: false, phase: 'editing', data, revision: '' };
}
function preparation(placeQuery: PlaceQuery, sourcePath = ''): OutingPreparation {
  return { name: '', groups: sourcePath ? [{ id: 'group', parkingPath: '', stops: [{ id: 'stop', sourcePath, status: 'pending' }] }] : [],
    unresolved: [], step: 1, filter: { text: placeQuery.text, area: placeQuery.area, shortlist: placeQuery.shortlist, type: placeQuery.sourceType, view: 'map' },
    placeQuery, placeSort: { key: 'rating', direction: 'desc' } };
}
async function ready() {
  const f = fixture(); await f.store.setup();
  const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft(), area.path, 'Source');
  return { ...f, area, source };
}
const rawDraft = async (f: ReturnType<typeof fixture>, id: string) =>
  f.vault.read(f.vault.getAbstractFileByPath(f.store.paths.drafts + '/' + id + '.json') as TFile);

test('pane layout retains criteria, sort and return position while stripping device coordinates', () => {
  const criteria = { ...defaultPlaceQuery(), text: 'cashmere', rating: 'minimum' as const, minimumRating: 3.5,
    nearby: { reference: { kind: 'current' as const, coordinates: [12.3456789, 45.6789012] as [number, number] }, radiusKm: 8 } };
  const state = checkedViewState({ root: 'Notebook', route: { screen: 'places' },
    places: { query: 'cashmere', area: '', kind: 'shop', shortlist: false, view: 'map', criteria, sort: { key: 'rating', direction: 'desc' } },
    positions: { places: { scroll: 201, focus: 'search-places', expanded: ['Filters'] } } })!;
  assert.equal(state.places?.criteria?.nearby?.reference.kind, 'unavailable');
  assert.equal(state.places?.criteria?.minimumRating, 3.5);
  assert.deepEqual(state.places?.sort, { key: 'rating', direction: 'desc' });
  assert.equal(state.positions?.places?.scroll, 201);
  assert.equal(JSON.stringify(state).includes('12.3456789'), false);
  assert.equal(criteria.nearby.reference.kind, 'current');
});

test('old flat pane criteria upgrade safely and malformed new criteria do not discard other pane state', () => {
  const old = checkedViewState({ root: 'Notebook', route: { screen: 'places' }, places: { query: 'coat', area: '', kind: 'shop', shortlist: true, view: 'list' } })!;
  assert.equal(old.places?.criteria?.text, 'coat'); assert.equal(old.places?.criteria?.shortlist, true);
  const invalid = checkedViewState({ root: 'Notebook', route: { screen: 'places' }, history: { period: 'this-week' },
    places: { query: '', area: '', kind: 'shop', shortlist: false, view: 'list', criteria: { text: {}, rating: [], nearby: true }, sort: { key: [], direction: 3 } } })!;
  assert.equal(invalid.history?.period, 'this-week');
  assert.equal(invalid.places?.criteria?.text, '');
  assert.equal(invalid.places?.criteria?.nearby?.reference.kind, 'unavailable');
  assert.deepEqual(invalid.places?.sort, { key: 'name', direction: 'asc' });
});

test('carried outing filters preserve map choice and sorting without selecting or altering sources', async () => {
  const f = await ready(), query: PlaceQuery = { ...defaultPlaceQuery(), area: f.area.path, rating: 'minimum', minimumRating: 3.5 };
  const d = await f.store.preparations.save(outingDraft(f.store.root, preparation(query)), '');
  const reopened = await f.store.preparations.get(d.id);
  assert.equal(reopened?.kind, 'outing');
  if (reopened?.kind !== 'outing') return;
  assert.deepEqual(reopened.data.groups, []); assert.equal(reopened.data.filter.view, 'map');
  assert.deepEqual(reopened.data.placeQuery, query); assert.deepEqual(reopened.data.placeSort, { key: 'rating', direction: 'desc' });
  assert.equal((await f.store.outings.list()).length, 0);
  const records = await f.store.listPlaces();
  assert.equal(queryPlaces(records, await f.store.listLocalities(), new Set(), reopened.data.placeQuery!, reopened.data.placeSort).places.length, 0);
  assert.equal((await f.store.listPlaces())[0]!.properties.rating, 0);
});

test('Unassigned criteria are a valid first outing preparation without creating areas', async () => {
  const f = fixture(); await f.store.setup();
  const data = preparation({ ...defaultPlaceQuery(), area: 'unassigned' });
  const saved = await f.store.preparations.save(outingDraft(f.store.root, data), '');
  const reopened = await f.store.preparations.get(saved.id);
  assert.equal(reopened?.kind, 'outing');
  if (reopened?.kind !== 'outing') return;
  assert.equal(reopened.data.filter.area, 'unassigned'); assert.equal(reopened.data.placeQuery?.area, 'unassigned');
  assert.deepEqual(await f.store.listLocalities(), []);
});

test('draft persistence centrally strips current device coordinates even when the caller forgets', async () => {
  const f = await ready();
  const query: PlaceQuery = { ...defaultPlaceQuery(), nearby: { reference: { kind: 'current', coordinates: [12.3456789, 45.6789012] }, radiusKm: 8 } };
  const data = preparation(query), saved = await f.store.preparations.save(outingDraft(f.store.root, data), '');
  const raw = await rawDraft(f, saved.id);
  assert.equal(raw.includes('12.3456789'), false); assert.equal(raw.includes('45.6789012'), false);
  assert.equal(saved.data.placeQuery?.nearby?.reference.kind, 'unavailable');
  assert.equal(query.nearby?.reference.kind, 'current');
  const reopened = await f.store.preparations.get(saved.id);
  if (reopened?.kind !== 'outing') throw Error('Expected outing draft');
  assert.equal(reopened.data.placeQuery?.nearby?.reference.kind, 'unavailable');
});

test('temporary nearby handoff fails visibly after persistence rather than broadening an outing query', async () => {
  const f = await ready();
  const query = serialisePlaceQuery({ ...defaultPlaceQuery(), nearby: { reference: { kind: 'current', coordinates: [12.3, 45.6] }, radiusKm: 5 } });
  const saved = await f.store.preparations.save(outingDraft(f.store.root, preparation(query)), '');
  const reopened = await f.store.preparations.get(saved.id);
  if (reopened?.kind !== 'outing') throw Error('Expected outing draft');
  const result = queryPlaces(await f.store.listPlaces(), await f.store.listLocalities(), new Set(), reopened.data.placeQuery!, reopened.data.placeSort);
  assert.equal(result.nearbyUnavailable, true); assert.deepEqual(result.places, []);
});

test('carried area and nearby identities cannot cross the real/example boundary', async () => {
  const f = await ready(), before = JSON.stringify([...f.vault.entries]);
  for (const query of [
    { ...defaultPlaceQuery(), area: f.store.root + '/Examples/Places/Exampletown/Area.md' },
    { ...defaultPlaceQuery(), nearby: { reference: { kind: 'place' as const, path: f.store.root + '/Examples/Places/Source.md' }, radiusKm: 5 } },
    { ...defaultPlaceQuery(), nearby: { reference: { kind: 'place' as const, path: 'Other notebook/Places/Source.md' }, radiusKm: 5 } },
  ]) {
    const data = preparation(query); data.filter.area = '';
    await assert.rejects(f.store.preparations.save(outingDraft(f.store.root, data), ''), /another notebook|invalid|review/);
  }
  assert.equal(JSON.stringify([...f.vault.entries]), before);
});

test('carried source references follow source-area and root moves', async () => {
  const f = await ready();
  const query: PlaceQuery = { ...defaultPlaceQuery(), area: f.area.path, nearby: { reference: { kind: 'place', path: f.source.path }, radiusKm: 5 } };
  const saved = await f.store.preparations.save(outingDraft(f.store.root, preparation(query, f.source.path)), '');
  assert.match(await rawDraft(f, saved.id), /"path": "\[\[/);
  const change = await f.store.previewPlaceAreaChange(f.source.path, { town: 'Exampletown', locality: 'Riverside' });
  await f.store.changePlaceArea(f.source.path, { town: 'Exampletown', locality: 'Riverside' }, change);
  const changed = await f.store.preparations.get(saved.id);
  if (changed?.kind !== 'outing') throw Error('Expected outing draft');
  const reference = changed.data.placeQuery?.nearby?.reference;
  if (reference?.kind !== 'place') throw Error('Expected record reference');
  assert.match(reference.path, /\/Riverside\//);
  assert.equal(reference.path, changed.data.groups[0]!.stops[0]!.sourcePath);
  await f.store.moveNotebook('Moved notebook');
  const moved = await f.store.preparations.get(saved.id);
  if (moved?.kind !== 'outing') throw Error('Expected moved outing draft');
  assert.match(moved.data.placeQuery!.area, /^Moved notebook\//);
  const movedReference = moved.data.placeQuery!.nearby!.reference;
  if (movedReference.kind !== 'place') throw Error('Expected moved reference');
  assert.match(movedReference.path, /^Moved notebook\//);
});

test('interrupted outing completion preserves carried filters and selected stops without replay', async () => {
  const f = await ready(), data = preparation({ ...defaultPlaceQuery(), rating: 'minimum', minimumRating: 5 }, f.source.path); data.name = 'Fictional browse';
  const saved = await f.store.preparations.save(outingDraft(f.store.root, data), '');
  const locked = await f.store.preparations.transition(saved.id, saved.revision, 'completing');
  const created = await f.store.outings.create(data, saved.id);
  const changed = await f.store.outings.updatePlan(created.path, { ...data, name: 'Deliberate later name' }, created.revision);
  const retry = await f.store.outings.create(data, saved.id);
  assert.equal(retry.path, created.path); assert.equal(retry.name, changed.name); assert.equal(retry.groups[0]!.stops[0]!.sourcePath, f.source.path);
  const reopened = await f.store.preparations.get(saved.id);
  if (reopened?.kind !== 'outing') throw Error('Expected completing outing draft');
  assert.equal(reopened.data.placeQuery?.minimumRating, 5);
  assert.equal((await f.store.outings.list()).length, 1);
  await f.store.preparations.transition(saved.id, locked.revision, 'complete', created.path);
  assert.deepEqual((await f.store.preparations.inspect()).drafts, []);
});

test('raw prepared query enum arrays are rejected rather than coerced into trusted scalar types', async () => {
  const f = await ready(), data = preparation(defaultPlaceQuery());
  const saved = await f.store.preparations.save(outingDraft(f.store.root, data), '');
  const file = f.vault.getAbstractFileByPath(f.store.paths.drafts + '/' + saved.id + '.json') as TFile;
  const baseline = JSON.parse(await f.vault.read(file));
  const mutations = [
    ['kind', ['shop']], ['rating', ['any']], ['status', ['active']], ['visits', ['any']], ['location', ['any']],
  ] as const;
  for (const [field, value] of mutations) {
    const next = structuredClone(baseline); next.data.placeQuery[field] = value;
    const raw = JSON.stringify(next); await f.vault.process(file, () => raw);
    await assert.rejects(f.store.preparations.get(saved.id), /invalid|review/i, field + ' must remain a scalar enum');
    assert.equal(await f.vault.read(file), raw);
  }
  const sort = structuredClone(baseline); sort.data.placeSort.key = ['rating'];
  const raw = JSON.stringify(sort); await f.vault.process(file, () => raw);
  await assert.rejects(f.store.preparations.get(saved.id), /invalid|review/i);
  assert.equal(await f.vault.read(file), raw);
});
