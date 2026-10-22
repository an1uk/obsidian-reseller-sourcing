import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShortTripPreview, defaultShortTripOptions, isShortTripOptions, materialiseShortTripOptions, shortTripForm, validateShortTripOptions } from '../src/outings/short-trip';
import type { ShortTripOptions } from '../src/outings/short-trip';
import type { Coordinates, LocalityRecord, PlaceRecord } from '../src/types';
import type { PlanningHours } from '../src/outings/types';

const parking = (name = 'Car', coordinates: Coordinates | null = [51, 0]): PlaceRecord => ({ path: 'Book/Parking/' + name + '.md', name, coordinates, locality: '', kind: 'parking', properties: {} });
const source = (name: string, car = parking(), coordinates: Coordinates | null = [51, 0]): PlaceRecord => ({
  path: 'Book/Sources/' + name + '.md', name, coordinates, locality: '', kind: 'shop', properties: { parking_location: '[[' + car.path + ']]' },
});
const options = (changes: Partial<ShortTripOptions> = {}): ShortTripOptions => {
  const defaults = defaultShortTripOptions(new Date('2026-10-19T09:00:00'));
  defaults.planning = { ...defaults.planning, timeZone: 'UTC', start: { kind: 'coordinates', coordinates: [51, 0] }, date: '2026-10-19', departureTime: '09:00' };
  return { ...defaults, ...changes };
};
const weekly = (text: string): PlanningHours => ({ hours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => day + ', ' + text), hoursChecked: '2026-10-18' });
const run = (places: PlaceRecord[], opts = options(), hours: Record<string, PlanningHours> = {}, areas: LocalityRecord[] = []) => buildShortTripPreview(places, areas, hours, opts);
const paths = (result: ReturnType<typeof run>) => result.groups.flatMap(group => group.stops.map(stop => stop.sourcePath));

test('short trips default to one hour, three sources, twenty minutes each and no return drive', () => {
  const defaults = defaultShortTripOptions(new Date('2026-10-19T14:37:00'));
  assert.equal(defaults.budgetMinutes, 60); assert.equal(defaults.maxStops, 3);
  assert.equal(defaults.planning.defaultVisitMinutes, 20); assert.equal(defaults.planning.departureTime, '14:37');
  assert.equal(defaults.planning.date, '2026-10-19'); assert.equal(defaults.planning.start, null);
  assert.deepEqual(defaults.planning.end, { kind: 'last' });
  assert.equal(defaults.shortlist, false); assert.equal(defaults.areaPath, '');
});

test('incomplete edits are durable raw fields while previews require valid explicit inputs', () => {
  const value = options(); value.form = shortTripForm(value); value.form.latitude = '-'; value.form.startKind = 'coordinates'; value.form.date = '';
  const snapshot = structuredClone(value);
  assert.equal(isShortTripOptions(value), true); assert.deepEqual(validateShortTripOptions(value), value);
  assert.throws(() => materialiseShortTripOptions(value), /date|coordinates/); assert.deepEqual(value, snapshot);
  value.form.date = '2026-10-19'; value.form.latitude = ''; value.form.longitude = '';
  assert.throws(() => materialiseShortTripOptions(value), /coordinates/);
  assert.equal(isShortTripOptions({ ...value, maxStops: 100 }), false);
  assert.equal(isShortTripOptions({ ...value, budgetMinutes: Infinity }), false);
  assert.equal(isShortTripOptions({ ...value, form: { ...value.form, latitude: 'x'.repeat(201) } }), false);
});

test('no implicit start is inferred from nearest parking or a selected source', () => {
  const p = parking(), a = source('A', p), opts = options(); opts.planning.start = null;
  const result = run([p, a], opts);
  assert.equal(result.estimate, null); assert.deepEqual(result.groups, []);
  assert.match(result.blockers.join(' '), /starting point/); assert.equal(result.evaluatedCount, 0);
});

test('one proposed small journey includes parking, all walking legs and each visit within the budget', () => {
  const p = parking('Car', [51, 0.001]), a = source('A', p, [51, 0.002]), b = source('B', p, [51, 0.003]), c = source('C', p, [51, 0.004]);
  const places = [p, a, b, c], before = structuredClone(places), opts = options({ budgetMinutes: 60 });
  const result = run(places, opts, Object.fromEntries([a, b, c].map(place => [place.path, weekly('Open 24 hours')])));
  assert.ok(result.estimate); assert.equal(paths(result).length, 2); assert.ok(result.estimate.totalMinutes <= 60);
  assert.equal(result.groups.length, 1); assert.equal(result.groups[0]!.parkingPath, p.path);
  assert.ok(result.estimate.walkingKm > 0); assert.ok(result.estimate.drivingKm > 0);
  assert.ok(result.estimate.finishAt > result.estimate.timeline.at(-1)!.departure);
  assert.deepEqual(places, before); assert.equal(new Set(paths(result)).size, paths(result).length);
});

test('an explicit return drive changes feasibility and is included in the accepted estimate', () => {
  const p = parking('Far car', [51, 0.04]), a = source('A', p, [51, 0.04]), places = [p, a];
  const oneWay = run(places), opts = options(); opts.planning.end = { kind: 'return' };
  const round = run(places, opts);
  assert.ok(oneWay.estimate); assert.ok(round.estimate);
  assert.ok(Math.abs(round.estimate.drivingKm - oneWay.estimate.drivingKm * 2) < 1e-8);
  const tight = options({ budgetMinutes: Math.ceil(oneWay.estimate.totalMinutes) }); tight.planning.end = { kind: 'return' };
  assert.equal(run(places, tight).estimate, null);
});

test('closed, unlocated, duplicate and unresolved-parking sources never become proposed shop-driving destinations', () => {
  const p = parking(), good = source('Good', p), closed = source('Closed', p), missing = source('Missing', p, null), unlinked = source('Unlinked', p), ambiguous = source('Ambiguous', p), duplicate = source('Duplicate', p);
  closed.properties.shop_closed = true; delete unlinked.properties.parking_location; delete ambiguous.properties.parking_location;
  const p2 = parking('Choice 1'), p3 = parking('Choice 2'); p2.properties.parking_for = '[[' + ambiguous.path + ']]'; p3.properties.parking_for = '[[' + ambiguous.path + ']]';
  const result = run([p, p2, p3, good, closed, missing, unlinked, ambiguous, duplicate, { ...duplicate }]);
  assert.deepEqual(paths(result), [good.path]); assert.deepEqual(result.excluded, { coordinates: 1, parking: 2, duplicate: 2 });
  assert.match(result.warnings.join(' '), /saved parking is missing, ambiguous/);
  assert.equal(result.groups.some(group => !group.parkingPath), false);
});

test('invalid preferred parking is never replaced by another parking pin or by the source', () => {
  const bad = parking('Invalid', null), good = parking('Good'), a = source('A', bad);
  good.properties.parking_for = '[[' + a.path + ']]';
  const result = run([bad, good, a]);
  assert.equal(result.estimate, null); assert.equal(result.excluded.parking, 1);
  assert.match(result.blockers.join(' '), /usable saved parking/);
});

test('known closed hours and waits exceeding the budget are excluded while unknown hours stay explicit', () => {
  const p = parking(), closed = source('Closed hours', p), waiting = source('Waiting', p), unknown = source('Unknown', p);
  const result = run([p, closed, waiting, unknown], options({ budgetMinutes: 45 }), { [closed.path]: weekly('Closed'), [waiting.path]: weekly('10 am-5 pm') });
  assert.deepEqual(paths(result), [unknown.path]); assert.equal(result.estimate!.unconfirmedHours, 1);
  assert.match(result.warnings.join(' '), /hours unconfirmed/i);
  assert.equal(run([p, waiting], options({ budgetMinutes: 45 }), { [waiting.path]: weekly('10 am-5 pm') }).estimate, null);
});

test('area descendants and shortlist are respected without broadening an empty selection', () => {
  const town: LocalityRecord = { path: 'Book/Areas/Town.md', name: 'Town', parentPath: '', segments: ['Town'], label: 'Town' };
  const district: LocalityRecord = { path: 'Book/Areas/District.md', name: 'District', parentPath: town.path, segments: ['Town', 'District'], label: 'Town / District' };
  const p = parking(), a = source('A', p), b = source('B', p), c = source('C', p);
  a.locality = '[[' + district.path + ']]'; a.properties.shortlist = true;
  b.locality = '[[' + town.path + ']]'; c.properties.shortlist = true;
  assert.deepEqual(paths(run([p, a, b, c], options({ areaPath: town.path, shortlist: true }), {}, [town, district])), [a.path]);
  const missing = run([p, a], options({ areaPath: 'Book/Areas/Removed.md' }), {}, [town, district]);
  assert.equal(missing.estimate, null); assert.match(missing.blockers.join(' '), /area is unavailable/);
});

test('search is deterministic and bounded to the nearest 24 eligible sources and at most 110 evaluations', () => {
  const p = parking(), places = [p, ...Array.from({ length: 40 }, (_, i) => source('Source ' + String(i).padStart(2, '0'), p, [51, i / 100000]))];
  const opts = options({ budgetMinutes: 240, maxStops: 5 });
  const result = run(places, opts), reversed = run([...places].reverse(), opts);
  assert.deepEqual(paths(result), paths(reversed)); assert.deepEqual(result.estimate, reversed.estimate);
  assert.equal(paths(result).length, 5); assert.ok(result.evaluatedCount <= 110); assert.equal(result.candidateCount, 40);
  assert.match(result.warnings.join(' '), /24 closest/);
});

test('revalidation fingerprints include candidate eligibility, parking, coordinates and dated hours', () => {
  const p = parking(), a = source('A', p), places = [p, a], hours = { [a.path]: weekly('Open 24 hours') }, first = run(places, options(), hours).fingerprint;
  for (const update of [
    () => { a.properties.shop_closed = true; }, () => { a.properties.shortlist = true; }, () => { a.properties.parking_location = ''; },
    () => { p.coordinates = [51, 0.001]; }, () => { hours[a.path]!.hoursChecked = '2026-10-20'; },
  ]) {
    const original = structuredClone(places), originalHours = structuredClone(hours); update();
    assert.notEqual(run(places, options(), hours).fingerprint, first);
    Object.assign(a, original[1]); Object.assign(p, original[0]); Object.assign(hours, originalHours);
  }
  a.properties.comments = 'Unrelated personal notes';
  assert.equal(run(places, options(), hours).fingerprint, first);
});

test('ambiguous departure clock changes block suggestions rather than silently shifting their time', () => {
  const p = parking(), a = source('A', p), opts = options();
  opts.planning.timeZone = 'Europe/London'; opts.planning.date = '2026-10-25'; opts.planning.departureTime = '01:30';
  const result = run([p, a], opts);
  assert.equal(result.estimate, null); assert.match(result.blockers.join(' '), /ambiguous/);
});

test('short trips retain a 24-hour source when its visit crosses midnight', () => {
  const p = parking(), a = source('All night', p), opts = options({ budgetMinutes: 60 });
  opts.planning.departureTime = '23:40';
  const hours = { [a.path]: weekly('Open 24 hours') };
  const result = run([p, a], opts, hours);
  assert.deepEqual(paths(result), [a.path]);
  assert.equal(result.estimate!.totalMinutes, 25);
  assert.equal(result.estimate!.timeline[0]!.hoursStatus, 'open');
  assert.equal(result.estimate!.finishAt, Date.parse('2026-10-20T00:05Z'));
  for (const next of ['Closed', '00:10-17:00']) {
    hours[a.path] = { hours: ['Monday, Open 24 hours', 'Tuesday, ' + next], hoursChecked: '2026-10-18' };
    const closed = run([p, a], opts, hours);
    assert.equal(closed.estimate, null);
    assert.deepEqual(paths(closed), []);
  }
});
