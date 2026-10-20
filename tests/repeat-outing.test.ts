import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import type { Coordinates, PlaceRecord } from '../src/types';
import type { OutingGroup, OutingPlanningOptions, OutingRecord, OutingVisitInput } from '../src/outings/types';
import type { OutingPreparation, PreparationDraft } from '../src/workspace/types';
import { buildRepeatedOutingPreparation, suggestedRepeatName } from '../src/outings/repeat';
import { defaultPlanningOptions, resolvePlanningAnchor } from '../src/outings/planning';
import { updateNoteProperty, wiki } from '../src/storage/markdown';
import { fixture, newDraft } from './storage-fixtures';

const root = 'Reseller sourcing';
const week = (period: string) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => day + ', ' + period);
const source = (name: string, properties: Record<string, unknown> = {}, coordinates: Coordinates | null = [52, -2]): PlaceRecord => ({
  path: root + '/Sources/' + name + '.md', name, kind: 'shop', locality: '', coordinates, properties,
});
const park = (name: string, sources: PlaceRecord[], coordinates: Coordinates | null = [52, -2]): PlaceRecord => ({
  path: root + '/Parking/' + name + '.md', name, kind: 'parking', locality: '', coordinates,
  properties: { parking_for: sources.map(place => wiki(place.path)) },
});
const group = (id: string, sources: PlaceRecord[], parkingPath = ''): OutingGroup => ({
  id, parkingPath, stops: sources.map((place, i) => ({ id: id + '-stop-' + i, sourcePath: place.path, status: 'visited', completedAt: '2026-10-13T12:00:00Z', visitId: 'visit-' + i, visitPath: root + '/Visits/Old-' + i + '.md', visitOperationId: 'operation-' + i })),
});
const finished = (groups: OutingGroup[], planning?: OutingPlanningOptions): OutingRecord => ({
  id: 'old-outing', preparationId: 'old-preparation', path: root + '/Outings/Old.md', name: 'Old 2026-10-13',
  status: 'finished', createdAt: '2026-10-13T08:00:00Z', startedAt: '2026-10-13T09:00:00Z', finishedAt: '2026-10-13T17:00:00Z', revision: 'old-revision',
  groups, ...(planning ? { planning } : {}),
});
const options = () => {
  let id = 0;
  return { now: new Date(2026, 9, 20, 23, 55), newId: () => 'new-identity-' + ++id };
};
const planning = (): OutingPlanningOptions => ({
  ...defaultPlanningOptions(new Date(2026, 9, 13)), departureTime: '10:15', timeZone: 'Europe/London',
  start: { kind: 'coordinates', coordinates: [52.5, -2.5], label: 'Home' }, end: { kind: 'return' },
  defaultVisitMinutes: 25, latestFinishTime: '18:30', estimates: { driveMultiplier: 1.5, driveKph: 35, walkMultiplier: 1.3, walkKph: 4, parkingMinutes: 7 },
});

test('repeat creates fresh pending groups and stops in the previous order without carrying visit identities or mutating history', () => {
  const a = source('A'), b = source('B'), c = source('C'), p = park('Car park', [a, b]);
  c.properties.parking_location = wiki(p.path);
  const record = finished([group('first', [b, a], p.path), group('manual-on-foot', [c])]);
  record.groups[0].stops[1] = { ...record.groups[0].stops[1], status: 'skipped', skipReason: 'Closed for lunch' };
  const before = structuredClone({ record, places: [a, b, c, p] });
  const result = buildRepeatedOutingPreparation(record, [a, b, c, p], root, options());
  assert.deepEqual(result.preparation.groups.map(item => item.parkingPath), [p.path, '']);
  assert.deepEqual(result.preparation.groups.flatMap(item => item.stops).map(stop => stop.sourcePath), [b.path, a.path, c.path]);
  assert.deepEqual(result.preparation.groups.flatMap(item => item.stops).map(stop => Object.keys(stop).sort()), Array(3).fill(['id', 'sourcePath', 'status']));
  assert.ok(result.preparation.groups.flatMap(item => item.stops).every(stop => stop.status === 'pending'));
  const oldIds = new Set([record.id, ...record.groups.flatMap(item => [item.id, ...item.stops.map(stop => stop.id)])]);
  const ids = result.preparation.groups.flatMap(item => [item.id, ...item.stops.map(stop => stop.id)]);
  assert.equal(new Set(ids).size, ids.length); assert.ok(ids.every(id => !oldIds.has(id)));
  assert.equal(result.preparation.name, ''); assert.equal(result.preparation.step, 2);
  assert.deepEqual(result.preparation.unresolved, []);
  for (const key of ['existingPath', 'existingRevision', 'startAfterSave', 'draft', 'operation', 'finishedAt', 'preparationId']) assert.equal(Object.hasOwn(result.preparation, key), false);
  assert.deepEqual({ record, places: [a, b, c, p] }, before);
  assert.deepEqual(result.preparation.reviewWarnings, result.warnings);
  assert.match(result.warnings[0], /2026-10-20.*current opening hours/);
});

test('repeat resets local date, retains journey times and durations, remaps overrides and clears every date-specific hours override', () => {
  const a = source('A'), b = source('B'), g = group('group', [a, b]), old = planning();
  old.stopOverrides = {
    [g.stops[0].id]: { visitMinutes: 45, hours: { closed: true, intervals: [] } },
    [g.stops[1].id]: { hours: { closed: false, intervals: [{ open: '11:00', close: '16:00' }] } },
    'obsolete-stop': { visitMinutes: 80 },
  };
  const record = finished([g], old), before = structuredClone(record);
  const result = buildRepeatedOutingPreparation(record, [a, b], root, options()), copied = result.preparation.planning!;
  assert.equal(copied.date, '2026-10-20'); assert.equal(copied.departureTime, old.departureTime); assert.equal(copied.timeZone, old.timeZone);
  assert.deepEqual(copied.start, old.start); assert.deepEqual(copied.end, old.end); assert.deepEqual(copied.estimates, old.estimates);
  assert.equal(copied.defaultVisitMinutes, 25); assert.equal(copied.latestFinishTime, '18:30');
  assert.deepEqual(copied.stopOverrides, { [result.preparation.groups[0].stops[0].id]: { visitMinutes: 45 } });
  assert.match(result.warnings.join(' '), /hours.*cleared/); assert.deepEqual(record, before);
  copied.estimates.driveKph = 50;
  if (copied.start?.kind === 'coordinates') copied.start.coordinates[0] = 0;
  assert.deepEqual(record, before);
});

test('repeat preserves explicitly chosen linked parking even when another current parking preference is available', () => {
  const a = source('A'), old = park('Previous parking', [a]), other = park('Other parking', [a]);
  a.properties.parking_location = wiki(other.path);
  const result = buildRepeatedOutingPreparation(finished([group('group', [a], old.path)]), [a, old, other], root, options());
  assert.equal(result.preparation.groups[0].parkingPath, old.path);
  assert.deepEqual(result.preparation.unresolved, []);
  const preferredOnly = source('Preferred only', { parking_location: wiki(old.path) });
  const preferred = buildRepeatedOutingPreparation(finished([group('preferred', [preferredOnly], old.path)]), [preferredOnly, { ...old, properties: {} }], root, options());
  assert.equal(preferred.preparation.groups[0].parkingPath, old.path); assert.deepEqual(preferred.preparation.unresolved, []);
});

test('missing, unlinked, unusable and cross-context parking require an explicit choice without redirecting to a new preference', () => {
  for (const problem of ['missing', 'unlinked', 'pin', 'outside', 'partly-linked'] as const) {
    const a = source('A'), b = source('B'), previous = park('Previous parking', [a, b]), other = park('New parking', [a, b]);
    a.properties.parking_location = wiki(other.path); b.properties.parking_location = wiki(other.path);
    if (problem === 'unlinked') previous.properties.parking_for = [];
    if (problem === 'partly-linked') previous.properties.parking_for = [wiki(a.path)];
    if (problem === 'pin') previous.coordinates = null;
    if (problem === 'outside') previous.path = 'Other notebook/Parking/Old.md';
    const places = [a, b, other, ...(problem === 'missing' ? [] : [previous])];
    const result = buildRepeatedOutingPreparation(finished([group('group', [a, b], previous.path)]), places, root, options());
    assert.equal(result.preparation.groups[0].parkingPath, '', problem);
    assert.deepEqual(result.preparation.unresolved, [a.path, b.path], problem);
    assert.match(result.warnings.join(' '), /Choose parking or explicitly choose on foot/, problem);
  }
});

test('unavailable in-notebook sources stay visible for removal while unsafe cross-context paths are omitted', () => {
  const a = source('A'), missing = source('Missing'), closed = source('Closed', { shop_closed: true }), wrongKind = { ...source('Changed kind'), kind: 'parking' as const };
  const outside = { ...source('Outside'), path: 'Other notebook/Sources/Outside.md' };
  const nestedExample = { ...source('Practice'), path: root + '/Examples/Sources/Practice.md' };
  const traversal = { ...source('Traversal'), path: root + '/Sources/../Outside.md' };
  const result = buildRepeatedOutingPreparation(finished([group('group', [a, missing, closed, wrongKind, outside, nestedExample, traversal])]), [a, closed, wrongKind, outside, nestedExample, traversal], root, options());
  assert.deepEqual(result.preparation.groups[0].stops.map(stop => stop.sourcePath), [a.path, missing.path, closed.path, wrongKind.path]);
  assert.deepEqual(result.preparation.unresolved, [missing.path, closed.path, wrongKind.path]);
  assert.equal(result.warnings.filter(warning => warning.includes('outside this notebook')).length, 3);
  assert.match(result.warnings.join(' '), /Remove it before saving/);
});

test('stale or foreign journey endpoints cannot carry a previous route into the new preparation', () => {
  const a = source('A');
  for (const start of [
    { kind: 'record' as const, path: root + '/Parking/Missing.md' },
    { kind: 'record' as const, path: 'Other notebook/Parking/Foreign.md' },
  ]) {
    const old = { ...planning(), start }, record = finished([group('group', [a])], old);
    const result = buildRepeatedOutingPreparation(record, [a], root, options());
    assert.equal(result.preparation.planning, undefined); assert.match(result.warnings.join(' '), /endpoints.*unavailable/);
    assert.deepEqual(record.planning, old);
  }
  const invalidEnd = { ...planning(), end: { kind: 'record' as const, path: root + '/Parking/Missing.md' } };
  assert.equal(buildRepeatedOutingPreparation(finished([group('group', [a])], invalidEnd), [a], root, options()).preparation.planning, undefined);
});

test('repeat requires finished history with no unresolved saved visit and refuses reused identities', () => {
  const a = source('A'), record = finished([group('group', [a])]);
  for (const status of ['planned', 'active'] as const) assert.throws(() => buildRepeatedOutingPreparation({ ...record, status }, [a], root), /Finish this outing/);
  const visit: OutingVisitInput = { observations: '', finds: '', nextTime: '', visitDate: '2026-10-13', updateLastVisited: false };
  assert.throws(() => buildRepeatedOutingPreparation({ ...record, draft: { operationId: 'old-operation', stopId: 'group-stop-0', input: visit, updatedAt: '' } }, [a], root), /saved visit/);
  assert.throws(() => buildRepeatedOutingPreparation({ ...record, operation: { id: 'old-operation', stopId: 'group-stop-0', sourcePath: a.path, input: visit, recordedAt: '', sourceBeforeHash: '', sourceIdentity: '' } }, [a], root), /saved visit/);
  assert.throws(() => buildRepeatedOutingPreparation({ ...record, path: 'Other notebook/Outings/Old.md' }, [a], root), /this notebook/);
  assert.throws(() => buildRepeatedOutingPreparation(record, [a], root, { newId: () => record.groups[0].stops[0].id }), /fresh/);
  assert.throws(() => buildRepeatedOutingPreparation(record, [a], root, { newId: () => 'duplicate' }), /fresh/);
});

test('repeated preparation saves as a distinct outing, uses current saved pins and hours, and preserves original outing and visits byte for byte', async () => {
  const f = fixture(); await f.store.setup(); const town = await f.store.ensureLocality('Exampletown');
  const one = await f.store.saveCapture({ ...newDraft('repeat-one'), name: 'One', hours: week('09:00 to 17:00') }, town.path, 'One');
  const parking = await f.store.saveCapture({ ...newDraft('repeat-parking', 'parking'), name: 'Parking' }, town.path, 'Parking');
  await f.vault.process(parking, raw => updateNoteProperty(raw, 'parking_for', [wiki(one.path)]));
  const oldPlanning = { ...planning(), start: { kind: 'record' as const, path: parking.path }, stopOverrides: { 'old-stop': { visitMinutes: 35, hours: { closed: true, intervals: [] } } } };
  const original = await f.store.outings.create({ name: 'Previous outing', groups: [{ id: 'old-group', parkingPath: parking.path, stops: [{ id: 'old-stop', sourcePath: one.path, status: 'pending' }] }], planning: oldPlanning });
  await f.store.outings.start(original.path);
  await f.store.outings.recordVisit(original.path, 'old-stop', { observations: 'Preserve original visit', finds: 'Coat', nextTime: 'Review rail', visitDate: '2026-10-13', updateLastVisited: true });
  const old = await f.store.outings.finish(original.path);
  await f.store.updateCoordinates(parking.path, [52.525, -2.425]);
  await f.vault.process(one, raw => updateNoteProperty(updateNoteProperty(raw, 'google_hours', week('12:00 to 15:00')), 'google_hours_checked', '2026-10-20'));
  const texts = () => [...f.vault.entries].map(([path, entry]) => [path, entry.text]);
  const before = texts(), places = await f.store.listPlaces();
  const result = buildRepeatedOutingPreparation(old, places, root, options());
  assert.deepEqual(texts(), before);
  assert.deepEqual(resolvePlanningAnchor(result.preparation.planning!.start, places), [52.525, -2.425]);
  assert.deepEqual(await f.store.outings.planningHours(result.preparation), { [one.path]: { hours: week('12:00 to 15:00'), hoursChecked: '2026-10-20' } });
  const draft: PreparationDraft<OutingPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'outing', root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', data: result.preparation, revision: '' };
  const saved = await f.store.preparations.save(draft, '');
  assert.deepEqual((await f.store.preparations.get(saved.id))?.data, result.preparation);
  const repeated = await f.store.outings.create({ name: 'New outing', groups: result.preparation.groups, planning: result.preparation.planning });
  assert.notEqual(repeated.id, old.id); assert.notEqual(repeated.path, old.path); assert.equal(repeated.status, 'planned');
  assert.deepEqual(repeated.planning?.stopOverrides, { [repeated.groups[0].stops[0].id]: { visitMinutes: 35 } });
  for (const [path, raw] of before) {
    const file = f.vault.getAbstractFileByPath(path!) as TFile;
    if (raw !== undefined) assert.equal(await f.vault.read(file), raw, path);
  }
  assert.deepEqual(await f.store.outings.get(old.path), old);
});

test('repeat names carry the new date once and avoid case-insensitive filename collisions with editable copy numbers', () => {
  assert.equal(suggestedRepeatName('Town 2026-10-13', '2026-10-20', []), 'Town 2026-10-20');
  assert.equal(suggestedRepeatName('Town 2026-10-20 (2)', '2026-10-20', ['town 2026-10-20', 'Town 2026-10-20 (2)']), 'Town 2026-10-20 (3)');
  assert.equal(suggestedRepeatName('Town: outing', '2026-10-20', ['town outing 2026-10-20']), 'Town outing 2026-10-20 (2)');
  assert.equal(suggestedRepeatName('2026-10-13', '2026-10-20', []), 'Sourcing 2026-10-20');
  const long = suggestedRepeatName('a'.repeat(180), '2026-10-20', []);
  const next = suggestedRepeatName('a'.repeat(180), '2026-10-20', [long]);
  assert.ok(long.length <= 180); assert.ok(next.length <= 180); assert.ok(next.endsWith('2026-10-20 (2)')); assert.notEqual(long, next);
  assert.throws(() => suggestedRepeatName('Town', '2026-02-30', []), /valid date/);
});
