import test from 'node:test';
import assert from 'node:assert/strict';
import type { Coordinates, LocalityRecord, PlaceRecord } from '../src/types';
import { distanceFromKm, distanceToKm } from '../src/units';
import { haversineKm } from '../src/domain/coordinates';
import {
  areaLabelForPlace, defaultNearbyRadiusKm, defaultPlaceQuery, nextPlaceSort, normalisePlaceQuery,
  normalisePlaceSort, placeBrandNames, placeSourceType, queryPlaces, serialisePlaceQuery,
  type PlaceQuery, type PlaceSort,
} from '../src/workspace/place-query';

const town: LocalityRecord = { path: 'Notebook/Places/Exampletown.md', name: 'Exampletown', parentPath: '', segments: ['Exampletown'], label: 'Exampletown' };
const locality: LocalityRecord = { path: 'Notebook/Places/Exampletown/Riverside.md', name: 'Riverside', parentPath: town.path, segments: ['Exampletown', 'Riverside'], label: 'Exampletown / Riverside' };
const other: LocalityRecord = { path: 'Notebook/Places/Elsewhere.md', name: 'Elsewhere', parentPath: '', segments: ['Elsewhere'], label: 'Elsewhere' };
const areas = [town, locality, other];
function shop(name: string, properties: Record<string, unknown> = {}, coordinates: Coordinates | null = [12, 45], area = locality.path): PlaceRecord {
  return { name, path: 'Notebook/Places/' + name + '.md', kind: 'shop', coordinates, locality: area ? '[[' + area.replace(/\.md$/, '') + ']]' : '', properties };
}
function parking(name = 'Parking', coordinates: Coordinates | null = [12.01, 45]): PlaceRecord {
  return { ...shop(name, {}, coordinates), kind: 'parking' };
}
function query(records: PlaceRecord[], changes: Partial<PlaceQuery> = {}, sort?: PlaceSort, visited: string[] = []) {
  return queryPlaces(records, areas, new Set(visited), { ...defaultPlaceQuery(), ...changes }, sort);
}
const names = (result: ReturnType<typeof query>) => result.places.map(place => place.name);

test('place query defaults are independent, source-only and active', () => {
  const a = defaultPlaceQuery(), b = defaultPlaceQuery(); a.text = 'changed';
  assert.equal(b.text, ''); assert.equal(b.kind, 'shop'); assert.equal(b.status, 'active');
  const records = [shop('Active'), shop('Closed', { shop_closed: true }), parking()];
  assert.deepEqual(names(query(records)), ['Active']);
  assert.deepEqual(names(query(records, { kind: 'all' })), ['Active', 'Parking']);
  assert.deepEqual(names(query(records, { kind: 'all', status: 'all' })), ['Active', 'Closed', 'Parking']);
  assert.deepEqual(names(query(records, { kind: 'all', status: 'closed' })), ['Closed']);
});

test('search matches name, brand, address and takeaway together without Google review influence', () => {
  const records = [
    shop('Branch one', { tags: ['source/coat-of-kindness', 'unrelated'], address: '12 Blossom Parade', comments: 'Useful cashmere rail' }),
    shop('Other', { google_review_topics: ['cashmere'], google_name: 'Coat of kindness' }),
    shop('Caf\u00e9 reuse', { tags: 'charity-shop/good-stitches' }),
  ];
  assert.deepEqual(names(query(records, { text: 'kindness cashmere blossom' })), ['Branch one']);
  assert.deepEqual(names(query(records, { text: 'CAF\u00c9' })), ['Caf\u00e9 reuse']);
  assert.deepEqual(names(query(records, { text: 'good stitches' })), ['Caf\u00e9 reuse']);
  assert.deepEqual(placeBrandNames(records[0]), ['coat of kindness']);
  assert.equal(placeSourceType(records[0]), 'Charity shop');
  assert.equal(placeSourceType(parking()), 'Parking');
});

test('area filters include child areas, town-only records, aliases and Unassigned', () => {
  const riverside = shop('Riverside branch'), central = shop('Town branch', {}, [12, 45], town.path);
  const elsewhere = shop('Elsewhere branch', {}, [13, 46], other.path), loose = shop('Loose', {}, null, '');
  const alias = { ...riverside, name: 'Alias branch', path: 'Notebook/Places/Alias.md', locality: '[[Riverside|Near the river]]' };
  const records = [riverside, central, elsewhere, loose, alias];
  assert.deepEqual(names(query(records, { area: town.path })), ['Alias branch', 'Riverside branch', 'Town branch']);
  assert.deepEqual(names(query(records, { area: locality.path })), ['Alias branch', 'Riverside branch']);
  assert.deepEqual(names(query(records, { area: 'unassigned' })), ['Loose']);
  assert.equal(areaLabelForPlace(alias, areas), 'Exampletown / Riverside');
  assert.equal(areaLabelForPlace(loose, areas), 'Unassigned');
  assert.deepEqual(names(query(records, { area: 'Notebook/Places/Missing.md' })), []);
});

test('parent links support non-nested storage and cycles terminate safely', () => {
  const detached = { ...locality, path: 'Notebook/Areas/Riverside.md' };
  const record = shop('Detached', {}, [12, 45], detached.path);
  assert.equal(queryPlaces([record], [town, detached], new Set(), { ...defaultPlaceQuery(), area: town.path }).places.length, 1);
  const cycleA = { ...town, parentPath: other.path }, cycleB = { ...other, parentPath: town.path };
  const result = queryPlaces([shop('Cycle', {}, [12, 45], town.path)], [cycleA, cycleB], new Set(), { ...defaultPlaceQuery(), area: 'Missing.md' });
  assert.equal(result.places.length, 0);
});

test('rating filters use half-star sourcing values, retain zero and exclude parking', () => {
  const records = [shop('Unrated', { rating: 0, google_rating: 5 }), shop('Half', { rating: 3.5 }), shop('High', { rating: 4.5 }), shop('Invalid', { rating: 4.3 }), parking()];
  assert.deepEqual(names(query(records, { kind: 'all', rating: 'unrated' })), ['Invalid', 'Unrated']);
  assert.deepEqual(names(query(records, { kind: 'all', rating: 'minimum', minimumRating: 3.5 })), ['Half', 'High']);
  assert.deepEqual(names(query(records, { sourceType: 'Rag house' })), []);
  assert.deepEqual(names(query([shop('Rags', { source_type: 'Rag house' }), parking()], { kind: 'all', sourceType: 'Rag house' })), ['Rags']);
});

test('visit filters use recorded visit paths, not last_visited, and shortlist excludes parking', () => {
  const recorded = shop('Recorded', { shortlist: true }), dateOnly = shop('Date only', { last_visited: '2026-10-18' });
  const records = [recorded, dateOnly, parking()];
  assert.deepEqual(names(query(records, { kind: 'all', visits: 'with' }, undefined, [recorded.path])), ['Recorded']);
  assert.deepEqual(names(query(records, { kind: 'all', visits: 'without' }, undefined, [recorded.path])), ['Date only']);
  assert.deepEqual(names(query(records, { kind: 'all', shortlist: true })), ['Recorded']);
  assert.deepEqual(names(query(records, { kind: 'parking', visits: 'without' })), []);
});

test('location predicates and mapped counts use validated destination coordinates', () => {
  const invalid = shop('Invalid', {}, [91, 45]), missing = shop('Missing', {}, null), valid = shop('Valid', {}, [0, 0]);
  const records = [invalid, missing, valid];
  const all = query(records);
  assert.equal(all.matchingCount, 3); assert.equal(all.mappedCount, 1); assert.equal(all.missingLocationCount, 2);
  assert.deepEqual(names(query(records, { location: 'present' })), ['Valid']);
  assert.deepEqual(names(query(records, { location: 'missing' })), ['Invalid', 'Missing']);
});

test('rating and date sorting keep unknown, unrated and parking values last in either direction', () => {
  const records = [
    shop('Zero', { rating: 0 }), shop('High', { rating: 4.5, last_visited: '2026-10-20' }),
    shop('Lower', { rating: 2.5, last_visited: '2026-09-30' }), parking(),
    shop('Invalid date', { last_visited: '2026-02-29' }),
  ];
  const options: Partial<PlaceQuery> = { kind: 'all' };
  assert.deepEqual(names(query(records, options, { key: 'rating', direction: 'asc' })), ['Lower', 'High', 'Invalid date', 'Parking', 'Zero']);
  assert.deepEqual(names(query(records, options, { key: 'rating', direction: 'desc' })), ['High', 'Lower', 'Invalid date', 'Parking', 'Zero']);
  assert.deepEqual(names(query(records, options, { key: 'lastVisited', direction: 'desc' })), ['High', 'Lower', 'Invalid date', 'Parking', 'Zero']);
  assert.deepEqual(names(query(records, options, { key: 'lastVisited', direction: 'asc' })), ['Lower', 'High', 'Invalid date', 'Parking', 'Zero']);
});

test('all column sorts are deterministic and never mutate inputs', () => {
  const first = shop('Same', { rating: 3.5, shortlist: false }), second = { ...first, path: 'Notebook/Places/Z.md' };
  const records = [second, shop('Alpha', { source_type: 'Rag house', shortlist: true }), first, parking()];
  const before = JSON.stringify(records);
  for (const key of ['name', 'area', 'type', 'rating', 'lastVisited', 'shortlist', 'distance'] as const) {
    const result = query(records, { kind: 'all' }, { key, direction: 'asc' });
    assert.ok(result.places.indexOf(first) < result.places.indexOf(second));
  }
  assert.equal(JSON.stringify(records), before);
  assert.equal(nextPlaceSort({ key: 'name', direction: 'asc' }, 'name').direction, 'desc');
  assert.equal(nextPlaceSort({ key: 'name', direction: 'asc' }, 'rating').direction, 'desc');
  assert.equal(nextPlaceSort({ key: 'name', direction: 'asc' }, 'lastVisited').direction, 'desc');
  assert.equal(nextPlaceSort({ key: 'rating', direction: 'desc' }, 'name').direction, 'asc');
});

test('nearby uses straight-line radius, saved records and distance sorting without dropping missing-location counts', () => {
  const start = parking('Start', [12, 45]), near = shop('Near', {}, [12.01, 45]), far = shop('Far', {}, [13, 45]), missing = shop('Missing', {}, null);
  const records = [start, far, missing, near];
  const result = query(records, { nearby: { reference: { kind: 'place', path: start.path }, radiusKm: 5 } }, { key: 'distance', direction: 'asc' });
  assert.deepEqual(names(result), ['Near']);
  assert.equal(result.missingLocationCount, 1); assert.equal(result.mappedCount, 1);
  assert.equal(result.distancesKm.get(near.path), haversineKm(start.coordinates!, near.coordinates!));
  assert.ok(result.distancesKm.get(far.path)! > 100);
  assert.equal(result.nearbyUnavailable, false);
  const point = query(records, { kind: 'all', nearby: { reference: { kind: 'point', coordinates: [12, 45] }, radiusKm: 5 } }, { key: 'distance', direction: 'desc' });
  assert.deepEqual(names(point), ['Near', 'Start']);
});

test('deleted or unlocated nearby references fail visibly instead of broadening results', () => {
  const record = shop('One');
  for (const reference of [{ kind: 'place', path: 'Deleted.md' }, { kind: 'unavailable' }, { kind: 'place', path: 'No pin.md' }] as const) {
    const result = query([record, { ...parking('No pin', null), path: 'No pin.md' }], { nearby: { reference, radiusKm: 5 } });
    assert.deepEqual(result.places, []); assert.equal(result.nearbyUnavailable, true);
  }
});

test('current location remains live in memory but is never included in serialised browsing or outing criteria', () => {
  const original: PlaceQuery = { ...defaultPlaceQuery(), nearby: { reference: { kind: 'current', coordinates: [12, 45], label: 'Current location' }, radiusKm: 5 } };
  assert.equal(query([shop('Here')], original).places.length, 1);
  const persisted = serialisePlaceQuery(original);
  assert.equal(persisted.nearby?.reference.kind, 'unavailable');
  assert.equal(JSON.stringify(persisted).includes('coordinates'), false);
  assert.equal(original.nearby?.reference.kind, 'current');
  assert.equal(query([shop('Here')], persisted).nearbyUnavailable, true);
  assert.deepEqual(serialisePlaceQuery({ ...original, nearby: { reference: { kind: 'point', coordinates: [12, 45] }, radiusKm: 5 } }).nearby?.reference, { kind: 'point', coordinates: [12, 45] });
});

test('default nearby radius stays five miles when converted between configured units', () => {
  const km = defaultNearbyRadiusKm();
  assert.equal(km, 8.04672); assert.equal(distanceFromKm(km, 'miles'), 5);
  assert.equal(distanceToKm(distanceFromKm(km, 'km'), 'km'), km);
  assert.equal(distanceToKm(distanceFromKm(km, 'miles'), 'miles'), km);
});

test('malformed persisted queries and legacy flat state normalise safely without erasing invalid nearby intent', () => {
  for (const value of [undefined, null, [], 3, 'bad']) assert.deepEqual(normalisePlaceQuery(value), defaultPlaceQuery());
  const parsed = normalisePlaceQuery({ query: 'legacy', area: 1, kind: 'bad', status: 'bad', rating: 'minimum', minimumRating: 4.3, shortlist: 'true', location: 1, visits: false, nearby: { reference: { kind: 'point', coordinates: [91, 0] }, radiusKm: -1 } });
  assert.equal(parsed.text, 'legacy'); assert.equal(parsed.kind, 'shop'); assert.equal(parsed.status, 'active'); assert.equal(parsed.shortlist, false);
  assert.equal(parsed.minimumRating, .5); assert.equal(parsed.nearby?.reference.kind, 'unavailable');
  assert.equal(parsed.nearby?.radiusKm, defaultNearbyRadiusKm());
  assert.deepEqual(normalisePlaceSort({ key: 'wrong', direction: 'wrong' }), { key: 'name', direction: 'asc' });
  assert.deepEqual(normalisePlaceSort({ key: 'rating', direction: 'wrong' }), { key: 'rating', direction: 'desc' });
  assert.deepEqual(normalisePlaceSort(null), { key: 'name', direction: 'asc' });
});
