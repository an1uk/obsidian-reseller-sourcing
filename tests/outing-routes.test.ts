import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutingRoutePreview, MAX_ROUTE_URL_LENGTH, MAX_ROUTE_WAYPOINTS,
  type OutingRoutePreview, type RouteExportTarget, ROUTE_DESTINATION_LIMITS,
} from '../src/outings/routes';
import type { OutingGroup, OutingRecord, OutingStopStatus } from '../src/outings/types';
import type { Coordinates, PlaceRecord } from '../src/types';

const source = (name: string, coordinates: Coordinates | null = [51, -1]): PlaceRecord => ({
  path: 'Notebook/Sources/Exampletown/' + name + '.md', name, kind: 'shop', locality: '', coordinates, properties: {},
});
const parking = (name: string, coordinates: Coordinates | null = [52, -2]): PlaceRecord => ({
  path: 'Notebook/Parking/Exampletown/' + name + '.md', name, kind: 'parking', locality: '', coordinates, properties: {},
});
const group = (id: string, source: PlaceRecord, parkingPath = '', status: OutingStopStatus = 'pending'): OutingGroup => ({
  id, parkingPath, stops: [{ id: 'stop-' + id, sourcePath: source.path, status }],
});
const record = (groups: OutingGroup[]): OutingRecord => ({
  id: 'outing-one', path: 'Notebook/Outings/Day out.md', name: 'Day out', status: 'planned',
  groups, createdAt: '2026-10-17T10:00:00Z', revision: 'record-revision',
});
function multiple(count: number) {
  const places: PlaceRecord[] = [], groups: OutingGroup[] = [];
  for (let n = 0; n < count; n++) {
    const s = source('Source ' + n, [50 + n / 100, -1]), p = parking('Parking ' + n, [51 + n / 100, -2]);
    places.push(s, p); groups.push(group('group-' + n, s, p.path));
  }
  return { places, record: record(groups) };
}
function coordinatesInParts(preview: OutingRoutePreview): string[] {
  return preview.parts.flatMap(part => {
    const url = new URL(part.url), intermediate = url.searchParams.get('waypoints');
    return [...(intermediate ? intermediate.split('|') : []), url.searchParams.get('destination')!];
  });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('one saved parking destination creates a free driving URL without origin or navigation action', () => {
  const s = source('Source'), p = parking('Chosen'), plan = record([group('one', s, p.path)]);
  const preview = buildOutingRoutePreview(plan, [s, p]);
  assert.deepEqual(preview.blockers, []); assert.deepEqual(preview.problems, []); assert.equal(preview.parts.length, 1);
  assert.equal(preview.parts[0]!.origin, null); assert.equal(preview.destinations[0]!.kind, 'parking');
  const url = new URL(preview.parts[0]!.url);
  assert.equal(url.origin, 'https://www.google.com'); assert.equal(url.pathname, '/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1'); assert.equal(url.searchParams.get('travelmode'), 'driving');
  assert.equal(url.searchParams.get('destination'), '52,-2');
  for (const key of ['origin', 'waypoints', 'dir_action', 'key']) assert.equal(url.searchParams.has(key), false);
  assert.deepEqual(preview.destinations[0]!.sources, [{ path: s.path, name: s.name, status: 'pending' }]);
});

test('remaining scope includes partial groups but leaves visited and skipped groups out; all includes all statuses', () => {
  const f = multiple(3); f.record.groups[0]!.stops[0]!.status = 'visited'; f.record.groups[1]!.stops[0]!.status = 'skipped';
  const visited = source('Earlier source'); f.places.push(visited);
  f.record.groups[2]!.stops.unshift({ id: 'earlier-stop', sourcePath: visited.path, status: 'visited' });
  const remaining = buildOutingRoutePreview(f.record, f.places);
  assert.deepEqual(remaining.destinations.map(value => value.groupIds), [['group-2']]);
  assert.deepEqual(remaining.destinations[0]!.sources.map(value => value.status), ['pending']);
  const all = buildOutingRoutePreview(f.record, f.places, 'all');
  assert.equal(all.destinations.length, 3); assert.deepEqual(all.destinations[2]!.sources.map(value => value.status), ['visited', 'pending']);
});

test('no-parking group targets its first included source, without consulting permanent parking preferences', () => {
  const earlier = source('Earlier', [53, -3]), pending = source('Pending', [54, -4]), permanent = parking('Permanent');
  earlier.properties.parking_location = '[[' + permanent.path + ']]'; pending.properties.parking_location = '[[' + permanent.path + ']]';
  const g = group('one', earlier, '', 'visited'); g.stops.push({ id: 'pending', sourcePath: pending.path, status: 'pending' });
  const plan = record([g]), places = [earlier, pending, permanent];
  assert.equal(buildOutingRoutePreview(plan, places).destinations[0]!.path, pending.path);
  assert.equal(buildOutingRoutePreview(plan, places, 'all').destinations[0]!.path, earlier.path);
  assert.equal(buildOutingRoutePreview(plan, places).destinations[0]!.kind, 'source');
});

test('saved outing parking overrides changed permanent preferences', () => {
  const s = source('Source'), chosen = parking('Outing choice', [53, -3]), preferred = parking('Permanent preference', [54, -4]);
  s.properties.parking_location = '[[' + preferred.path + ']]';
  const preview = buildOutingRoutePreview(record([group('one', s, chosen.path)]), [s, chosen, preferred]);
  assert.equal(preview.destinations[0]!.path, chosen.path);
  assert.equal(new URL(preview.parts[0]!.url).searchParams.get('destination'), '53,-3');
});

test('missing, invalid or wrong-kind selected parking never falls back to a source', () => {
  const s = source('Source'), missing = parking('Missing'), invalid = parking('Invalid', [91, 0]);
  for (const [path, places] of [[missing.path, [s]], [invalid.path, [s, invalid]], [s.path, [s]]] as const) {
    const preview = buildOutingRoutePreview(record([group('one', s, path)]), places);
    assert.equal(preview.destinations.length, 0); assert.equal(preview.parts.length, 0);
    assert.equal(preview.problems.length, 1); assert.match(preview.problems[0]!.message, /source pin will not be substituted/);
  }
});

test('invalid first source does not silently choose another source in a group', () => {
  const invalid = source('Missing pin', null), good = source('Other source', [52, -2]), g = group('one', invalid);
  g.stops.push({ id: 'other', sourcePath: good.path, status: 'pending' });
  const preview = buildOutingRoutePreview(record([g]), [invalid, good]);
  assert.equal(preview.parts.length, 0); assert.equal(preview.problems[0]!.path, invalid.path);
  assert.equal(preview.destinations.length, 0);
});

test('a missing destination blocks every part until its group is explicitly excluded', () => {
  const f = multiple(3); f.places.find(value => value.path === f.record.groups[1]!.parkingPath)!.coordinates = null;
  const before = buildOutingRoutePreview(f.record, f.places);
  assert.equal(before.destinations.length, 2); assert.equal(before.parts.length, 0); assert.equal(before.problems.length, 1);
  const after = buildOutingRoutePreview(f.record, f.places, 'remaining', ['group-1']);
  assert.equal(after.problems.length, 1); assert.deepEqual(after.excluded.map(value => value.groupId), ['group-1']);
  assert.equal(after.parts.length, 1); assert.equal(after.destinations.length, 2);
  assert.notEqual(after.fingerprint, before.fingerprint);
});

test('explicit exclusions are transient, and stale unknown IDs do not change the effective route', () => {
  const f = multiple(2), before = structuredClone(f);
  const excluded = buildOutingRoutePreview(f.record, f.places, 'remaining', ['group-0', 'group-0', 'unknown']);
  assert.deepEqual(excluded.destinations.map(value => value.groupIds), [['group-1']]);
  assert.deepEqual(f, before);
  assert.equal(excluded.fingerprint, buildOutingRoutePreview(f.record, f.places, 'remaining', ['group-0']).fingerprint);
});

test('only consecutive identical parking paths collapse; A-B-A and equal coordinates remain distinct', () => {
  const a = source('A source'), b = source('B source'), c = source('C source'), p = parking('A parking'), q = parking('B parking', p.coordinates);
  const places = [a, b, c, p, q];
  const consecutive = buildOutingRoutePreview(record([group('a', a, p.path), group('b', b, p.path), group('c', c, q.path)]), places);
  assert.deepEqual(consecutive.destinations.map(value => value.groupIds), [['a', 'b'], ['c']]);
  assert.deepEqual(consecutive.destinations[0]!.sources.map(value => value.path), [a.path, b.path]);
  const returnTrip = buildOutingRoutePreview(record([group('a', a, p.path), group('b', b, q.path), group('c', c, p.path)]), places);
  assert.deepEqual(returnTrip.destinations.map(value => value.path), [p.path, q.path, p.path]);
  assert.equal(returnTrip.parts[0]!.destinations.length, 3);
});

test('four new destinations fit one mobile-safe part; a fifth starts another part from the prior destination', () => {
  const four = multiple(4), one = buildOutingRoutePreview(four.record, four.places);
  assert.equal(one.parts.length, 1); assert.equal(new URL(one.parts[0]!.url).searchParams.get('waypoints')!.split('|').length, MAX_ROUTE_WAYPOINTS);
  const five = multiple(5), two = buildOutingRoutePreview(five.record, five.places);
  assert.deepEqual(two.parts.map(value => value.destinations.length), [4, 1]);
  assert.equal(two.parts[1]!.index, 1); assert.equal(two.parts[1]!.origin!.path, two.parts[0]!.destinations[3]!.path);
  assert.equal(new URL(two.parts[1]!.url).searchParams.get('origin'), '51.03,-2');
  assert.equal(new URL(two.parts[1]!.url).searchParams.has('waypoints'), false);
});

test('multiple route parts retain every destination exactly once and preserve split continuity', () => {
  const f = multiple(13), preview = buildOutingRoutePreview(f.record, f.places);
  assert.deepEqual(preview.parts.map(value => value.destinations.length), [4, 4, 4, 1]);
  assert.deepEqual(preview.parts.flatMap(value => value.destinations.map(destination => destination.path)), preview.destinations.map(value => value.path));
  assert.deepEqual(coordinatesInParts(preview), preview.destinations.map(value => value.coordinates.join(',')));
  for (let n = 1; n < preview.parts.length; n++) assert.equal(preview.parts[n]!.origin!.path, preview.parts[n - 1]!.destinations.at(-1)!.path);
});

test('encoded URL length can split below the waypoint cap without rounding extremely small coordinates', () => {
  const f = multiple(8);
  for (const p of f.places.filter(value => value.kind === 'parking')) p.coordinates = [5e-324, -5e-324];
  const preview = buildOutingRoutePreview(f.record, f.places);
  assert.ok(preview.parts.length > 2); assert.ok(preview.parts.some(part => part.destinations.length < 4));
  assert.equal(preview.parts.flatMap(part => part.destinations).length, 8);
  for (const part of preview.parts) {
    assert.ok(part.url.length <= MAX_ROUTE_URL_LENGTH);
    const url = new URL(part.url), coordinates = url.searchParams.get('destination')!;
    assert.equal(/[eE]/.test(coordinates), false); assert.deepEqual(coordinates.split(',').map(Number), [5e-324, -5e-324]);
  }
});

test('zero coordinates and numeric coordinate strings validate without an address or listing fallback', () => {
  const s = source('Zero', [0, 0]), plan = record([group('one', s)]);
  assert.equal(new URL(buildOutingRoutePreview(plan, [s]).parts[0]!.url).searchParams.get('destination'), '0,0');
  s.coordinates = [' 51.5 ', '-0.12'] as unknown as Coordinates;
  assert.equal(new URL(buildOutingRoutePreview(plan, [s]).parts[0]!.url).searchParams.get('destination'), '51.5,-0.12');
  for (const coordinates of [[NaN, 0], [0, Infinity], [0, 181]]) {
    s.coordinates = coordinates as Coordinates; assert.equal(buildOutingRoutePreview(plan, [s]).parts.length, 0);
  }
});

test('empty remaining, empty outing and all-excluded previews never produce route parts', () => {
  const f = multiple(1); f.record.groups[0]!.stops[0]!.status = 'visited';
  assert.equal(buildOutingRoutePreview(f.record, f.places).parts.length, 0);
  assert.match(buildOutingRoutePreview(f.record, f.places).blockers[0]!, /no remaining stops/);
  assert.equal(buildOutingRoutePreview(f.record, f.places, 'all').parts.length, 1);
  assert.equal(buildOutingRoutePreview(record([]), []).parts.length, 0);
  assert.equal(buildOutingRoutePreview(f.record, f.places, 'all', ['group-0']).parts.length, 0);
});

test('unfinished visit operation blocks export while an ordinary saved draft does not', () => {
  const f = multiple(1), plan = f.record;
  plan.operation = { id: 'pending-save', stopId: 'stop-group-0', sourcePath: f.places[0]!.path,
    input: { observations: 'Kept', finds: '', nextTime: '', visitDate: '2026-10-17', updateLastVisited: false },
    recordedAt: '2026-10-17T12:00:00Z', sourceBeforeHash: 'before', sourceIdentity: 'source' };
  const blocked = buildOutingRoutePreview(plan, f.places);
  assert.equal(blocked.parts.length, 0); assert.match(blocked.blockers[0]!, /unfinished visit save/);
  plan.draft = { operationId: plan.operation.id, stopId: plan.operation.stopId, input: plan.operation.input, updatedAt: plan.operation.recordedAt };
  delete plan.operation; assert.equal(buildOutingRoutePreview(plan, f.places).parts.length, 1);
});

test('fingerprint tracks relevant outing and destination changes but ignores place prose and assessments', () => {
  const f = multiple(2), original = buildOutingRoutePreview(f.record, f.places).fingerprint;
  assert.equal(buildOutingRoutePreview(f.record, [...f.places].reverse()).fingerprint, original);
  f.places[0]!.properties = { last_visited: '2026-10-17', comments: 'Unrelated takeaway', rating: 5 };
  f.places[1]!.properties = { notes: 'Parking prose' };
  assert.equal(buildOutingRoutePreview(f.record, f.places).fingerprint, original);
  const irrelevant = parking('Unrelated', [1, 2]);
  assert.equal(buildOutingRoutePreview(f.record, [...f.places, irrelevant]).fingerprint, original);
  f.places[1]!.coordinates = [53, -3]; assert.notEqual(buildOutingRoutePreview(f.record, f.places).fingerprint, original);
  f.places[1]!.coordinates = [51, -2]; assert.equal(buildOutingRoutePreview(f.record, f.places).fingerprint, original);
  f.places[0]!.name = 'Renamed source'; assert.notEqual(buildOutingRoutePreview(f.record, f.places).fingerprint, original);
  f.places[0]!.name = 'Source 0'; f.record.revision = 'new revision'; assert.notEqual(buildOutingRoutePreview(f.record, f.places).fingerprint, original);
});

test('missing records, changed kinds, scope and repaired pins invalidate a preview fingerprint', () => {
  const f = multiple(2), original = buildOutingRoutePreview(f.record, f.places).fingerprint;
  assert.notEqual(buildOutingRoutePreview(f.record, f.places, 'all').fingerprint, original);
  const missing = buildOutingRoutePreview(f.record, f.places.filter(value => value !== f.places[1]));
  assert.notEqual(missing.fingerprint, original); assert.equal(missing.parts.length, 0);
  f.places[1]!.kind = 'shop'; assert.notEqual(buildOutingRoutePreview(f.record, f.places).fingerprint, original);
  f.places[1]!.kind = 'parking'; assert.equal(buildOutingRoutePreview(f.record, f.places).fingerprint, original);
});

test('builder accepts frozen saved records and places without changing any persistent state', () => {
  const f = deepFreeze(multiple(6)), before = JSON.stringify(f);
  const preview = buildOutingRoutePreview(f.record, f.places, 'remaining', ['group-1']);
  assert.equal(preview.parts.length, 2); assert.equal(JSON.stringify(f), before);
  assert.throws(() => buildOutingRoutePreview(f.record, f.places, 'invalid' as 'all'), /Choose remaining/);
});

const planned = (f: ReturnType<typeof multiple>): OutingRecord => {
  f.record.planning = {
    mode: 'hours', date: '2026-10-17', departureTime: '09:00', timeZone: 'Europe/London',
    start: { kind: 'coordinates', coordinates: [50, -3], label: 'Depot' }, end: { kind: 'return' },
    defaultVisitMinutes: 20, stopOverrides: {},
    estimates: { driveMultiplier: 1.4, driveKph: 30, walkMultiplier: 1.2, walkKph: 4.5, parkingMinutes: 5 },
  };
  return f.record;
};

test('export profiles send their full 9, 10 and 4 destination capacities before splitting', () => {
  for (const [target, limit] of Object.entries(ROUTE_DESTINATION_LIMITS)) {
    const f = multiple(limit), one = buildOutingRoutePreview(f.record, f.places, 'all', [], target as RouteExportTarget);
    assert.equal(one.parts.length, 1); assert.equal(one.destinationLimit, limit);
    assert.equal(one.parts[0]!.destinations.length, limit);
    assert.equal(new URL(one.parts[0]!.url).searchParams.get('waypoints')!.split('|').length, limit - 1);
    const extra = multiple(limit + 1), split = buildOutingRoutePreview(extra.record, extra.places, 'all', [], target as RouteExportTarget);
    assert.deepEqual(split.parts.map(part => part.destinations.length), [limit, 1]);
    assert.equal(split.parts[1]!.origin!.path, split.parts[0]!.destinations.at(-1)!.path);
    assert.deepEqual(coordinatesInParts(split), split.destinations.map(value => value.coordinates.join(',')));
  }
  const f = multiple(1);
  assert.throws(() => buildOutingRoutePreview(f.record, f.places, 'all', [], 'invalid' as RouteExportTarget), /export target/);
});

test('saved return is a counted destination and explicit start appears only as origin', () => {
  const f = multiple(9), plan = planned(f), preview = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop');
  assert.equal(preview.destinations.length, 10); assert.equal(preview.parts.length, 1);
  assert.equal(preview.start!.name, 'Depot'); assert.equal(preview.finish!.endpoint, 'return');
  const url = new URL(preview.parts[0]!.url);
  assert.equal(url.searchParams.get('origin'), '50,-3'); assert.equal(url.searchParams.get('destination'), '50,-3');
  assert.equal(url.searchParams.get('waypoints')!.split('|').length, 9);
  const android = buildOutingRoutePreview(plan, f.places, 'all', [], 'android-app');
  assert.deepEqual(android.parts.map(part => part.destinations.length), [9, 1]);
});

test('record endpoints use only supplied scoped records and current pins, supporting full wikilinks', () => {
  const f = multiple(2), plan = planned(f), depot = parking('Depot', [55, -5]);
  f.places.push(depot); plan.planning!.start = { kind: 'record', path: '[[' + depot.path + ']]' };
  plan.planning!.end = { kind: 'record', path: f.places[0]!.path };
  const before = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop');
  assert.equal(before.start!.path, depot.path); assert.equal(before.finish!.path, f.places[0]!.path);
  assert.equal(new URL(before.parts[0]!.url).searchParams.get('origin'), '55,-5');
  plan.planning!.start = { kind: 'record', path: '[[' + depot.path.slice(0, -3) + ']]' };
  assert.equal(buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop').start!.path, depot.path);
  plan.planning!.start = { kind: 'record', path: '[[' + depot.path + ']]' };
  depot.coordinates = [56, -6];
  assert.notEqual(buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop').fingerprint, before.fingerprint);
  depot.coordinates = null;
  const blocked = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop');
  assert.equal(blocked.parts.length, 0); assert.match(blocked.blockers.join(' '), /starting point/);
  plan.planning!.start = { kind: 'record', path: 'Other notebook/Parking/Depot.md' };
  assert.equal(buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop').parts.length, 0);
});

test('active remaining begins at current location while all restores saved origin; both retain return', () => {
  const f = multiple(3), plan = planned(f); plan.status = 'active'; plan.groups[0]!.stops[0]!.status = 'visited';
  const remaining = buildOutingRoutePreview(plan, f.places, 'remaining', [], 'android-app');
  assert.equal(remaining.start, null); assert.equal(remaining.parts[0]!.origin, null);
  assert.equal(new URL(remaining.parts[0]!.url).searchParams.has('origin'), false);
  assert.equal(remaining.destinations.length, 3); assert.equal(remaining.destinations.at(-1)!.endpoint, 'return');
  const all = buildOutingRoutePreview(plan, f.places, 'all', [], 'android-app');
  assert.equal(all.start!.name, 'Depot'); assert.equal(all.destinations.length, 4);
  assert.equal(new URL(all.parts[0]!.url).searchParams.get('origin'), '50,-3');
});

test('last-source ending adds nothing, matching final pin avoids duplicate return, other equal stops remain distinct', () => {
  const f = multiple(2), plan = planned(f); plan.planning!.end = { kind: 'last' };
  const last = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop');
  assert.equal(last.destinations.length, 2); assert.equal(last.finish, null);
  plan.planning!.end = { kind: 'return' }; plan.planning!.start = { kind: 'coordinates', coordinates: [51.01, -2] };
  const same = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop');
  assert.equal(same.destinations.length, 2); assert.equal(same.destinations.at(-1)!.endpoint, 'return');
  assert.deepEqual(same.destinations.map(value => value.groupIds), [['group-0'], ['group-1']]);
});

test('missing or invalid explicit finishing anchor blocks instead of silently using last source', () => {
  const f = multiple(1), plan = planned(f);
  for (const end of [
    { kind: 'record' as const, path: 'Notebook/Parking/Missing.md' },
    { kind: 'coordinates' as const, coordinates: [91, 0] as Coordinates },
  ]) {
    plan.planning!.end = end;
    const preview = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop');
    assert.equal(preview.parts.length, 0); assert.match(preview.blockers.join(' '), /finishing point/);
  }
});

test('profile and planning facts invalidate exports, but unrelated facts and prose do not', () => {
  const f = multiple(2), plan = planned(f), path = f.places[0]!.path;
  const facts = { [path]: { hours: ['Saturday: 09:00–17:00'], hoursChecked: '2026-10-17' } };
  const preview = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop', facts);
  assert.notEqual(buildOutingRoutePreview(plan, f.places, 'all', [], 'android-app', facts).fingerprint, preview.fingerprint);
  facts[path]!.hoursChecked = '2026-10-18';
  assert.notEqual(buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop', facts).fingerprint, preview.fingerprint);
  facts[path]!.hoursChecked = '2026-10-17';
  assert.equal(buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop', { unrelated: { hours: [], hoursChecked: '' }, ...facts }).fingerprint, preview.fingerprint);
  f.places[0]!.properties.comments = 'Personal prose survives.';
  assert.equal(buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop', facts).fingerprint, preview.fingerprint);
  plan.planning!.defaultVisitMinutes = 25;
  assert.notEqual(buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop', facts).fingerprint, preview.fingerprint);
});

test('planning export preserves status, source order and return across exclusions without mutation', () => {
  const f = multiple(10), plan = planned(f); plan.groups[0]!.stops[0]!.status = 'visited';
  plan.groups[1]!.stops[0]!.status = 'skipped';
  const before = JSON.stringify(f), preview = buildOutingRoutePreview(deepFreeze(plan), deepFreeze(f.places), 'all', ['group-2'], 'android-app');
  assert.deepEqual(preview.parts.map(part => part.destinations.length), [9, 1]);
  assert.equal(preview.destinations[0]!.sources[0]!.status, 'visited');
  assert.equal(preview.destinations[1]!.sources[0]!.status, 'skipped');
  assert.equal(preview.destinations.at(-1)!.endpoint, 'return');
  assert.equal(JSON.stringify(f), before);
});

test('URL-length splitting with planned origin keeps every endpoint and chooses fewest feasible parts', () => {
  const f = multiple(11), plan = planned(f);
  for (let i = 0; i < f.places.length; i++) if (f.places[i]!.kind === 'parking') f.places[i]!.coordinates = i % 4 ? [5e-324, -5e-324] : [52, -2];
  const preview = buildOutingRoutePreview(plan, f.places, 'all', [], 'desktop');
  assert.equal(preview.parts.flatMap(part => part.destinations).length, 12);
  for (const part of preview.parts) assert.ok(part.url.length <= MAX_ROUTE_URL_LENGTH);
  for (let i = 1; i < preview.parts.length; i++) assert.equal(preview.parts[i]!.origin, preview.parts[i - 1]!.destinations.at(-1));
  // Exhaustive segmentation of this small route verifies the optimiser's part count.
  const text = (coordinates: Coordinates) => coordinates.map(value => Math.abs(value) === 5e-324 ? (value < 0 ? '-' : '') + '0.' + '0'.repeat(323) + '5' : String(value)).join(',');
  function minimum(offset: number): number {
    if (offset === preview.destinations.length) return 0;
    let result = Infinity;
    for (let n = 1; n <= 10 && offset + n <= preview.destinations.length; n++) {
      const batch = preview.destinations.slice(offset, offset + n), origin = offset ? preview.destinations[offset - 1]! : preview.start!;
      const url = new URL('https://www.google.com/maps/dir/');
      url.searchParams.set('api', '1'); url.searchParams.set('travelmode', 'driving');
      url.searchParams.set('origin', text(origin.coordinates)); url.searchParams.set('destination', text(batch.at(-1)!.coordinates));
      if (batch.length > 1) url.searchParams.set('waypoints', batch.slice(0, -1).map(value => text(value.coordinates)).join('|'));
      if (url.toString().length <= MAX_ROUTE_URL_LENGTH) result = Math.min(result, 1 + minimum(offset + n));
    }
    return result;
  }
  assert.equal(preview.parts.length, minimum(0));
});
