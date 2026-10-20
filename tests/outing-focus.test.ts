import test from 'node:test';
import assert from 'node:assert/strict';
import type { OutingRecord } from '../src/outings/types';
import type { PlaceRecord } from '../src/types';
import { changedOutingFocus, confirmOutingParked, isOutingFocus, leaveOutingParking, outingFocusFingerprint, outingFocusView } from '../src/outings/focus';

function fixture() {
  const root = 'Notebook', source = (id: string): PlaceRecord => ({ path: root + '/Places/' + id + '.md', name: id, locality: '', kind: 'shop', coordinates: [50, 1], properties: {} });
  const a = source('A'), b = source('B'), c = source('C');
  const p: PlaceRecord = { ...source('Parking one'), kind: 'parking' }, q: PlaceRecord = { ...source('Parking two'), kind: 'parking', coordinates: [50.1, 1] };
  const record: OutingRecord = { id: 'outing', path: root + '/Outings/Trip.md', name: 'Trip', status: 'active', createdAt: '', revision: 'one', groups: [
    { id: 'group-one', parkingPath: p.path, stops: [{ id: 'a', sourcePath: a.path, status: 'pending' }, { id: 'b', sourcePath: b.path, status: 'pending' }] },
    { id: 'group-two', parkingPath: q.path, stops: [{ id: 'c', sourcePath: c.path, status: 'pending' }] },
  ] };
  return { record, places: [a, b, c, p, q], a, b, c, p, q };
}
test('old outings derive a safe disabled focus display without mutation or a presumed parked anchor', () => {
  const f = fixture(), before = structuredClone(f.record), view = outingFocusView(f.record, f.places);
  assert.equal(view.state.enabled, false); assert.equal(view.state.phase, 'drive'); assert.equal(view.state.stopId, 'a'); assert.equal(view.parked, undefined);
  assert.deepEqual(f.record, before); assert.equal(f.record.focus, undefined);
});
test('only explicit parked confirmation creates an anchor and opening directions has no transition', () => {
  const f = fixture(); f.record.focus = { ...outingFocusView(f.record, f.places).state, enabled: true };
  const before = structuredClone(f.record.focus); outingFocusView(f.record, f.places); assert.deepEqual(f.record.focus, before);
  f.record.focus = confirmOutingParked(f.record, f.places);
  assert.equal(f.record.focus.phase, 'walk'); assert.equal(f.record.focus.parkedGroupId, 'group-one'); assert.equal(f.record.focus.parkedParkingPath, f.p.path);
  f.record.focus = changedOutingFocus(f.record, f.places, 'visit'); assert.equal(f.record.groups[0].stops[0].status, 'pending');
});
test('completed stops walk within shared parking and return to the confirmed car before another group', () => {
  const f = fixture(); f.record.focus = { ...confirmOutingParked(f.record, f.places), enabled: true, phase: 'visit' };
  f.record.groups[0].stops[0].status = 'visited'; let view = outingFocusView(f.record, f.places);
  assert.equal(view.state.phase, 'walk'); assert.equal(view.state.stopId, 'b'); assert.equal(view.parked?.path, f.p.path);
  f.record.focus = { ...view.state, phase: 'visit' }; f.record.groups[0].stops[1].status = 'visited'; view = outingFocusView(f.record, f.places);
  assert.equal(view.state.phase, 'return'); assert.equal(view.state.stopId, 'c'); assert.equal(view.parked?.path, f.p.path); assert.equal(view.parking?.path, f.q.path);
  f.record.focus = leaveOutingParking(f.record, f.places); assert.equal(f.record.focus.phase, 'drive'); assert.equal(f.record.focus.parkedGroupId, undefined);
});
test('the final source still offers return to confirmed parking, then finish without changing outcomes', () => {
  const f = fixture(); f.record.focus = { ...confirmOutingParked(f.record, f.places), enabled: true, phase: 'visit' };
  for (const group of f.record.groups) for (const stop of group.stops) stop.status = 'visited';
  const view = outingFocusView(f.record, f.places); assert.equal(view.state.phase, 'return'); assert.equal(view.readyToFinish, false);
  f.record.focus = leaveOutingParking(f.record, f.places);
  assert.equal(outingFocusView(f.record, f.places).readyToFinish, true); assert.equal(f.record.status, 'active');
});
test('visited history never invents a parking anchor and missing or foreign pins cannot replace a destination', () => {
  const f = fixture(); f.record.groups[0].stops.forEach(stop => stop.status = 'visited');
  assert.equal(outingFocusView(f.record, f.places).state.phase, 'drive'); assert.equal(outingFocusView(f.record, f.places).parked, undefined);
  f.q.coordinates = null; assert.equal(outingFocusView(f.record, f.places).parking?.coordinates, null);
  assert.throws(() => confirmOutingParked(f.record, f.places), /valid parking/); assert.throws(() => changedOutingFocus(f.record, f.places, 'drive'), /valid pin/);
  f.record.groups[1].parkingPath = 'Notebook/Examples/Places/Parking.md'; f.places.push({ ...f.p, path: f.record.groups[1].parkingPath });
  assert.equal(outingFocusView(f.record, f.places).parking, undefined);
});
test('deleted or reassigned parking drops the manual anchor and explains the fallback', () => {
  const f = fixture(); f.record.focus = { ...confirmOutingParked(f.record, f.places), enabled: true };
  f.record.groups[0].parkingPath = f.q.path;
  const view = outingFocusView(f.record, f.places); assert.equal(view.parked, undefined); assert.match(view.warning, /anchor is unavailable/);
  assert.throws(() => changedOutingFocus(f.record, f.places, 'return'), /where you parked/);
});
test('closed and missing current sources remain explicit and do not advance or select another source', () => {
  const f = fixture(); f.a.properties.shop_closed = true; assert.match(outingFocusView(f.record, f.places).warning, /permanently closed/);
  const view = outingFocusView(f.record, f.places.filter(place => place.path !== f.a.path));
  assert.equal(view.source, undefined); assert.equal(view.stop?.id, 'a'); assert.match(view.warning, /source is missing/);
});
test('focus fingerprints bind revision, pins, names, closed state and paths while ignoring unrelated records', () => {
  const f = fixture(), before = outingFocusFingerprint(f.record, f.places);
  f.places.push({ ...f.p, path: 'Notebook/Places/Unrelated.md' }); assert.equal(outingFocusFingerprint(f.record, f.places), before);
  f.a.coordinates = [50.2, 1]; assert.notEqual(outingFocusFingerprint(f.record, f.places), before);
  f.a.coordinates = [50, 1]; f.record.revision = 'two'; assert.notEqual(outingFocusFingerprint(f.record, f.places), before);
});
test('optional saved focus validates unknown data and rejects incomplete or extra anchor fields', () => {
  assert.equal(isOutingFocus({ enabled: true, phase: 'drive', stopId: 'a' }), true);
  for (const value of [null, [], { enabled: 'true', phase: 'drive', stopId: 'a' }, { enabled: true, phase: 'teleport', stopId: 'a' }, { enabled: true, phase: 'walk', stopId: 'a', parkedGroupId: 'g' }, { enabled: true, phase: 'visit', stopId: 'a', unknown: true }, { enabled: true, phase: 'walk', stopId: 'a', parkedGroupId: 'g', parkedParkingPath: 'path', parkedCoordinates: ['50', '1'] }]) assert.equal(isOutingFocus(value), false);
});

test('a configurable root containing an Outings segment keeps its own source and parking context', () => {
  const f = fixture(), root = 'Notebook/Outings/Archive';
  f.record.path = root + '/Outings/Trip.md';
  for (const place of f.places) place.path = place.path.replace('Notebook', root);
  for (const group of f.record.groups) { group.parkingPath = group.parkingPath.replace('Notebook', root); for (const stop of group.stops) stop.sourcePath = stop.sourcePath.replace('Notebook', root); }
  const view = outingFocusView(f.record, f.places); assert.equal(view.source?.path, f.a.path); assert.equal(view.parking?.path, f.p.path);
});

test('a parking pin correction cannot silently move a previously confirmed parked location', () => {
  const f = fixture(); f.record.focus = { ...confirmOutingParked(f.record, f.places), enabled: true };
  f.p.coordinates = [51, 2]; const view = outingFocusView(f.record, f.places);
  assert.equal(view.parked, undefined); assert.match(view.warning, /anchor is unavailable/); assert.deepEqual(f.record.focus.parkedCoordinates, [50, 1]);
});

test('an older optional anchor without a coordinate confirmation falls back with a warning', () => {
  const f = fixture(); f.record.focus = { enabled: true, phase: 'return', stopId: 'a', parkedGroupId: 'group-one', parkedParkingPath: f.p.path };
  assert.equal(isOutingFocus(f.record.focus), true); const view = outingFocusView(f.record, f.places);
  assert.equal(view.parked, undefined); assert.equal(view.state.phase, 'drive'); assert.match(view.warning, /anchor is unavailable/);
});
