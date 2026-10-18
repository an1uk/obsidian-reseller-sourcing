import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutingOptimisationPreview, defaultPlanningOptions, formatPlanningTime, parsePlanningHours, planningWallTimeInstants, resolvePlanningAnchor, validatePlanningOptions } from '../src/outings/planning';
import { haversineKm } from '../src/domain/coordinates';
import type { Coordinates, PlaceRecord } from '../src/types';
import type { OutingGroup, OutingPlanningOptions, OutingRecord, PlanningHours } from '../src/outings/types';

const source = (name: string, coordinates: Coordinates | null = [51, 0]): PlaceRecord => ({ path: 'Notebook/Sources/' + name + '.md', name, coordinates, locality: '', kind: 'shop', properties: {} });
const parking = (name: string, coordinates: Coordinates | null = [51, 0]): PlaceRecord => ({ ...source(name, coordinates), path: 'Notebook/Parking/' + name + '.md', kind: 'parking' });
const group = (name: string, sources: PlaceRecord[], park?: PlaceRecord): OutingGroup => ({ id: name, parkingPath: park?.path ?? '', stops: sources.map(place => ({ id: name + ':' + place.name, sourcePath: place.path, status: 'pending' })) });
const record = (groups: OutingGroup[]): OutingRecord => ({ id: 'outing', path: 'Notebook/Outings/Trip.md', name: 'Trip', status: 'planned', createdAt: '2026-10-18', revision: 'r1', groups });
const options = (changes: Partial<OutingPlanningOptions> = {}): OutingPlanningOptions => ({ ...defaultPlanningOptions(new Date('2026-10-19T12:00Z')), date: '2026-10-19', timeZone: 'UTC', start: { kind: 'coordinates', coordinates: [51, 0] }, end: { kind: 'return' }, ...changes });
const weekly = (text: string): PlanningHours => ({ hours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => day + ', ' + text), hoursChecked: '2026-10-18' });
const build = (groups: OutingGroup[], places: PlaceRecord[], opts = options(), hours: Record<string, PlanningHours> = {}) => buildOutingOptimisationPreview(record(groups), places, hours, opts);

test('planner defaults are explicit, independent and validated without inferring a start', () => {
  const a = defaultPlanningOptions(), b = defaultPlanningOptions();
  assert.equal(a.mode, 'hours'); assert.equal(a.start, null); assert.deepEqual(a.end, { kind: 'last' }); assert.equal(a.defaultVisitMinutes, 20);
  assert.deepEqual(a.estimates, { driveMultiplier: 1.4, driveKph: 30, walkMultiplier: 1.2, walkKph: 4.5, parkingMinutes: 5 });
  a.stopOverrides.x = { visitMinutes: 5 }; assert.deepEqual(b.stopOverrides, {});
  assert.deepEqual(validatePlanningOptions(options()), options());
  assert.throws(() => validatePlanningOptions(options({ date: '2026-02-31' })), /date/);
  assert.throws(() => validatePlanningOptions(options({ timeZone: 'Example\/Not-a-zone' })), /time zone/);
  assert.throws(() => validatePlanningOptions(options({ defaultVisitMinutes: NaN })), /Visit duration|visit duration/);
  assert.throws(() => validatePlanningOptions(options({ stopOverrides: { s: { hours: { closed: false, intervals: [] } } } })), /opening period/);
  assert.throws(() => validatePlanningOptions(options({ stopOverrides: { s: { hours: { closed: false, intervals: [{ open: '9am', close: '17:00' }] } } } })), /HH:MM/);
  assert.throws(() => validatePlanningOptions(options({ estimates: { ...options().estimates, driveKph: 0 } })), /Driving speed/);
});

test('record anchors resolve full links only and reject ambiguous or missing pins', () => {
  const a = source('A');
  assert.deepEqual(resolvePlanningAnchor({ kind: 'record', path: '[[' + a.path.replace(/\.md$/, '') + ']]' }, [a]), a.coordinates);
  assert.deepEqual(resolvePlanningAnchor({ kind: 'record', path: a.path }, [a]), a.coordinates);
  assert.equal(resolvePlanningAnchor({ kind: 'record', path: 'A' }, [a]), null);
  assert.equal(resolvePlanningAnchor({ kind: 'record', path: a.path }, [a, { ...a }]), null);
  assert.equal(resolvePlanningAnchor({ kind: 'coordinates', coordinates: [91, 0] }, [a]), null);
});

test('time zone wall-time conversion rejects daylight-saving gaps and repeated times', () => {
  assert.deepEqual(planningWallTimeInstants('2026-03-29', '01:30', 'Europe/London'), []);
  assert.equal(planningWallTimeInstants('2026-10-25', '01:30', 'Europe/London').length, 2);
  assert.equal(planningWallTimeInstants('2026-10-25', '09:00', 'Europe/London').length, 1);
  assert.equal(planningWallTimeInstants('2026-10-19', '09:00', 'Asia/Kathmandu')[0], Date.parse('2026-10-19T03:15Z'));
  const a = source('A'), g = group('g', [a]);
  assert.match(build([g], [a], options({ date: '2026-03-29', departureTime: '01:30', timeZone: 'Europe/London' })).blockers.join(' '), /does not exist/);
  assert.match(build([g], [a], options({ date: '2026-10-25', departureTime: '01:30', timeZone: 'Europe/London' })).blockers.join(' '), /ambiguous/);
  assert.match(build([g], [a], options({ latestFinishTime: '08:00' })).blockers.join(' '), /follow departure/);
  assert.match(formatPlanningTime(Date.parse('2026-10-19T08:00Z'), { timeZone: 'Europe/London' }), /09:00/);
});

test('hours parser recognises only explicit English periods, closed and 24 hour days', () => {
  assert.deepEqual(parsePlanningHours(['Monday, 9 am–12 pm, 1 pm–5:30 pm'], 'Monday'), { known: true, intervals: [{ open: 540, close: 720 }, { open: 780, close: 1050 }] });
  assert.deepEqual(parsePlanningHours(['Monday: 09:00-17:00'], 'Monday').intervals, [{ open: 540, close: 1020 }]);
  assert.deepEqual(parsePlanningHours(['Monday, 10 pm–2 am'], 'Monday').intervals, [{ open: 1320, close: 1560 }]);
  assert.deepEqual(parsePlanningHours(['Monday, Open 24 hours'], 'Monday').intervals, [{ open: 0, close: 1440 }]);
  assert.deepEqual(parsePlanningHours(['Monday, Closed'], 'Monday'), { known: true, intervals: [] });
  for (const text of ['by appointment', '9–5', 'Usually 9 am–5 pm', '9 am–5 pm (hours might differ)', '9 am–9 am', '13 pm–5 pm']) {
    assert.equal(parsePlanningHours(['Monday, ' + text], 'Monday').known, false, text);
  }
  assert.equal(parsePlanningHours(['Monday, Closed', 'Monday, 09:00-17:00'], 'Monday').known, false);
});

test('round trips include driving, all walking legs, parking allowance and return to car', () => {
  const p = parking('Car', [51, 0.01]), a = source('A', [51, 0.011]), b = source('B', [51, 0.012]);
  const result = build([group('shared', [a, b], p)], [p, a, b], options(), { [a.path]: weekly('Open 24 hours'), [b.path]: weekly('Open 24 hours') });
  assert.deepEqual(result.blockers, []);
  const expectedDrive = haversineKm([51, 0], p.coordinates!) * 1.4 * 2;
  const expectedWalk = (haversineKm(p.coordinates!, a.coordinates!) + haversineKm(a.coordinates!, b.coordinates!) + haversineKm(b.coordinates!, p.coordinates!)) * 1.2;
  assert.ok(Math.abs(result.current.drivingKm - expectedDrive) < 1e-8);
  assert.ok(Math.abs(result.current.walkingKm - expectedWalk) < 1e-8);
  assert.ok(Math.abs(result.current.totalMinutes - (40 + 5 + expectedDrive / 30 * 60 + expectedWalk / 4.5 * 60)) < 1e-6);
  assert.equal(result.current.timeline.length, 2);
  assert.ok(result.current.finishAt > result.current.timeline.at(-1)!.departure);
});

test('last-source and separate endpoints are honoured without altering source pins', () => {
  const a = source('A', [51, 0.01]), finish = parking('Finish', [51, 0.02]), g = group('g', [a]), before = structuredClone([a, finish]);
  const last = build([g], [a, finish], options({ end: { kind: 'last' } }));
  const round = build([g], [a, finish]);
  const separate = build([g], [a, finish], options({ end: { kind: 'record', path: '[[' + finish.path + ']]' } }));
  assert.ok(round.current.totalKm > last.current.totalKm);
  assert.ok(separate.current.totalKm > last.current.totalKm);
  assert.deepEqual([a, finish], before);
});

test('invalid selected parking is blocking and never substitutes a source pin', () => {
  const a = source('A'), p = parking('Unknown', null);
  const result = build([group('g', [a], p)], [a, p]);
  assert.match(result.blockers.join(' '), /parking.*not be substituted/);
  assert.equal(result.proposed.timeline.length, 0);
  assert.match(build([group('g', [source('Unknown', null)])], [source('Unknown', null)]).blockers.join(' '), /coordinates/);
  assert.match(build([group('g', [a])], [a], options({ start: null })).blockers.join(' '), /starting point/);
});

test('opening hours wait on the same day, fit split sessions, and do not wait for tomorrow', () => {
  const a = source('A'), g = group('g', [a]), id = g.stops[0]!.id;
  const late = build([g], [a], options(), { [a.path]: weekly('10 am–5 pm') });
  assert.equal(late.current.waitingMinutes, 60); assert.equal(late.current.timeline[0]!.hoursStatus, 'open');
  const lunch = build([g], [a], options({ departureTime: '11:50' }), { [a.path]: weekly('9 am–12 pm, 1 pm–5 pm') });
  assert.equal(lunch.current.waitingMinutes, 70);
  const closed = build([g], [a], options({ departureTime: '18:00' }), { [a.path]: weekly('9 am–5 pm') });
  assert.equal(closed.current.waitingMinutes, 0); assert.equal(closed.current.openingConflicts, 1);
  assert.equal(closed.current.timeline.length, 1);
  const override = build([g], [a], options({ stopOverrides: { [id]: { visitMinutes: 5, hours: { closed: false, intervals: [{ open: '08:00', close: '11:00' }] } } } }), { [a.path]: weekly('Closed') });
  assert.equal(override.current.timeline[0]!.visitMinutes, 5); assert.equal(override.current.openingConflicts, 0);
  assert.equal(override.current.timeline[0]!.hoursChecked, 'Outing override');
});

test('overnight hours include the preceding days spillover and never invent unknown hours', () => {
  const a = source('A'), g = group('g', [a]);
  const past = build([g], [a], options({ departureTime: '00:30' }), { [a.path]: { hours: ['Sunday, 10 pm–2 am', 'Monday, Closed'], hoursChecked: '2026-10-18' } });
  assert.equal(past.current.openingConflicts, 0); assert.equal(past.current.timeline[0]!.hoursStatus, 'open');
  const unknown = build([g], [a], options(), { [a.path]: weekly('By appointment') });
  assert.equal(unknown.current.unconfirmedHours, 1); assert.equal(unknown.current.openingConflicts, 0);
  assert.match(unknown.warnings.join(' '), /Hours unconfirmed/);
  const overnight = build([g], [a], options({ departureTime: '23:50' }), { [a.path]: weekly('10 pm–2 am') });
  assert.equal(overnight.current.openingConflicts, 0);
  assert.ok(overnight.current.finishAt > Date.parse('2026-10-20T00:00Z'));
});

test('distance optimisation is deterministic, bounded and never increases estimated distance', () => {
  const places = [source('A', [51, 0.04]), source('B', [51, 0.01]), source('C', [51, 0.03]), source('D', [51, 0.02])];
  const groups = places.map(place => group(place.name, [place])), before = structuredClone(groups);
  const opts = options({ mode: 'distance', end: { kind: 'last' } });
  const a = build(groups, places, opts), b = build(groups, places, opts);
  assert.ok(a.proposed.totalKm < a.current.totalKm); assert.deepEqual(a, b); assert.deepEqual(groups, before);
  assert.deepEqual(a.groups.flatMap(g => g.stops.map(s => s.id)).sort(), before.flatMap(g => g.stops.map(s => s.id)).sort());
});

test('hours mode prioritises known visit conflicts ahead of a shorter estimate', () => {
  const near = source('Nearby', [51, 0.001]), urgent = source('ClosingSoon', [51, 0.01]);
  const groups = [group('near', [near]), group('urgent', [urgent])];
  const result = build(groups, [near, urgent], options({ mode: 'hours' }), { [near.path]: weekly('9 am–5 pm'), [urgent.path]: weekly('9 am–9:30 am') });
  assert.equal(result.current.openingConflicts, 1);
  assert.equal(result.proposed.openingConflicts, 0);
  assert.equal(result.groups[0]!.id, 'urgent');
});

test('completed and skipped positions stay frozen while remaining walking stops can improve', () => {
  const old = source('Old'), far = source('Far', [51, 0.05]), near = source('Near', [51, 0.01]), mid = source('Middle', [51, 0.03]);
  const a = group('first', [far]), frozen = group('frozen', [old, far, near]), c = group('last', [mid]);
  frozen.stops[0]!.status = 'visited'; frozen.stops[0]!.completedAt = '2026-10-19T08:00Z';
  frozen.stops.splice(2, 0, { id: 'skip', sourcePath: old.path, status: 'skipped', skipReason: 'Locked door' });
  const result = build([a, frozen, c], [old, far, near, mid], options({ mode: 'distance' }));
  assert.equal(result.groups[1]!.id, 'frozen');
  assert.deepEqual(result.groups[1]!.stops[0], frozen.stops[0]);
  assert.deepEqual(result.groups[1]!.stops[2], frozen.stops[2]);
  assert.equal(result.proposed.timeline.length, 4);
  assert.equal(result.proposed.timeline.some(s => s.stopId === 'skip'), false);
});

test('unfinished visit drafts block applying while preserving a visible estimate', () => {
  const a = source('A'), r = record([group('g', [a])]);
  r.draft = { operationId: 'visit', stopId: 'g:A', updatedAt: 'now', input: { observations: 'Unsaved', finds: '', nextTime: '', visitDate: '2026-10-19', updateLastVisited: false } };
  const result = buildOutingOptimisationPreview(r, [a], {}, options());
  assert.match(result.blockers.join(' '), /unfinished outing visit/); assert.equal(result.proposed.timeline.length, 1);
});

test('fingerprints include planning dependencies but exclude unrelated prose and assessment', () => {
  const a = source('A'), r = record([group('g', [a])]), opts = options(), hours = { [a.path]: weekly('9 am–5 pm') };
  const first = buildOutingOptimisationPreview(r, [a], hours, opts);
  a.properties.comments = 'Personal prose'; a.properties.rating = 5;
  assert.equal(buildOutingOptimisationPreview(r, [a], hours, opts).fingerprint, first.fingerprint);
  a.coordinates = [51, 0.001];
  assert.notEqual(buildOutingOptimisationPreview(r, [a], hours, opts).fingerprint, first.fingerprint);
  a.coordinates = [51, 0];
  hours[a.path]!.hoursChecked = '2026-10-20';
  assert.notEqual(buildOutingOptimisationPreview(r, [a], hours, opts).fingerprint, first.fingerprint);
  assert.equal(first.current.timeline[0]!.hoursChecked, '2026-10-18');
});

test('latest finish warnings keep all sources rather than silently dropping a visit', () => {
  const a = source('A'), b = source('B');
  const result = build([group('g', [a, b])], [a, b], options({ latestFinishTime: '09:25' }));
  assert.equal(result.proposed.latestFinishMissed, true);
  assert.equal(result.proposed.timeline.length, 2);
  assert.match(result.warnings.join(' '), /latest finishing time/);
});

test('undated recognised hours stay usable with an explicit warning and overrides leave captures unchanged', () => {
  const a = source('A'), g = group('g', [a]), hours = { [a.path]: { ...weekly('10 am–5 pm'), hoursChecked: '' } };
  const before = structuredClone(hours), opts = options({ stopOverrides: { [g.stops[0]!.id]: { visitMinutes: 7 } } });
  const result = build([g], [a], opts, hours);
  assert.equal(result.proposed.timeline[0]!.hoursStatus, 'open');
  assert.match(result.warnings.join(' '), /no checked date/);
  assert.deepEqual(hours, before); assert.equal(opts.stopOverrides[g.stops[0]!.id]!.visitMinutes, 7);
});

test('ambiguous DST opening boundaries are unconfirmed rather than a false opening guarantee', () => {
  const a = source('A'), g = group('g', [a]);
  const result = build([g], [a], options({ date: '2026-10-25', timeZone: 'Europe/London', departureTime: '00:30' }),
    { [a.path]: weekly('1 am–2 am') });
  assert.equal(result.proposed.timeline[0]!.hoursStatus, 'unconfirmed');
  assert.equal(result.proposed.openingConflicts, 0);
});

test('all completed outings remain intact and clearly have nothing left to optimise', () => {
  const a = source('A'), g = group('g', [a]); g.stops[0]!.status = 'visited';
  const before = structuredClone(g), result = build([g], [a]);
  assert.deepEqual(result.groups, [before]);
  assert.match(result.blockers.join(' '), /no remaining sources/);
  assert.equal(result.proposed.timeline.length, 0);
});

test('new plans omit the optional return while an explicit saved round trip remains valid', () => {
  const a = source('One-way destination', [51, 0.01]), g = group('one', [a]);
  const defaults = { ...defaultPlanningOptions(), date: '2026-10-19', timeZone: 'UTC', start: { kind: 'coordinates' as const, coordinates: [51, 0] as Coordinates } };
  const oneWay = build([g], [a], defaults);
  const savedRoundTrip = { ...defaults, end: { kind: 'return' as const } };
  const round = build([g], [a], validatePlanningOptions(savedRoundTrip));
  assert.deepEqual(defaults.end, { kind: 'last' });
  assert.deepEqual(validatePlanningOptions(savedRoundTrip).end, { kind: 'return' });
  assert.ok(Math.abs(round.current.drivingKm - oneWay.current.drivingKm * 2) < 1e-8);
  assert.ok(round.current.finishAt > oneWay.current.finishAt);
  assert.deepEqual(defaultPlanningOptions().end, { kind: 'last' });
});
