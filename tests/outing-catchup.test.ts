import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutingCatchup, catchupVisitDate } from '../src/outings/catch-up';
import type { OutingRecord, OutingStop } from '../src/outings/types';
import type { PlaceRecord } from '../src/types';
import type { VisitRecord } from '../src/visits/types';

const source = { kind: 'shop', path: 'Book/Places/One.md', name: 'One' } as PlaceRecord;
const another = { kind: 'shop', path: 'Book/Places/Two.md', name: 'Two' } as PlaceRecord;
function stop(id = 'stop-one', status: OutingStop['status'] = 'visited'): OutingStop {
  return { id, sourcePath: id === 'stop-one' ? source.path : another.path, status, completedAt: '2026-10-17T23:30:00Z' };
}
function outing(stops: OutingStop[] = [stop()]): OutingRecord {
  return { id: 'outing-one', path: 'Book/Outings/2026/10/One.md', name: 'Saturday', status: 'finished', groups: [{ id: 'group-one', parkingPath: '', stops }], createdAt: '2026-10-16T12:00:00Z', startedAt: '2026-10-17T10:00:00Z', revision: 'r1' };
}
function visit(record = outing(), value = stop()): VisitRecord {
  return { schema: 1, id: 'visit-one', path: 'Book/Visits/2026/10/One.md', sourcePath: value.sourcePath, visitDate: '2026-10-17', recordedAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z', observations: '', finds: '', nextTime: '', outingId: record.id, outingPath: record.path, stopId: value.id, revision: 'v1' };
}
function linked(record: OutingRecord, value: VisitRecord): void {
  const first = record.groups[0].stops[0]; first.visitId = value.id; first.visitPath = value.path;
}
const places = [source, another];

test('catch-up contains only actual visited stops, preserving order and unknown purchase count', () => {
  const record = outing([stop(), stop('pending', 'pending'), stop('skipped', 'skipped')]);
  const saved = visit(record); linked(record, saved); const before = structuredClone(record);
  const result = buildOutingCatchup(record, [saved], places);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].action, 'edit');
  assert.equal(result.rows[0].visit?.itemsPurchased, undefined); assert.equal(result.rows[0].date.date, '2026-10-17');
  assert.deepEqual(record, before); assert.equal(saved.itemsPurchased, undefined);
  saved.itemsPurchased = 0;
  assert.equal(buildOutingCatchup(record, [saved], places).rows[0].visit?.itemsPurchased, 0);
});

test('visited without notes offers one explicit add without creating visits or inferring zero', () => {
  const record = outing(), result = buildOutingCatchup(record, [], places);
  assert.equal(result.rows[0].action, 'add'); assert.equal(result.rows[0].visit, undefined);
  assert.deepEqual(result.rows[0].issues, []); assert.equal(record.groups[0].stops[0].visitPath, undefined);
});

test('missing and every mismatched linked identity block adding or editing the visit', () => {
  const record = outing(), saved = visit(record); linked(record, saved);
  const missing = buildOutingCatchup(record, [], places).rows[0];
  assert.equal(missing.action, undefined); assert.match(missing.issues.join(' '), /unavailable/);
  for (const [key, value] of [['id', 'another'], ['sourcePath', another.path], ['outingId', 'other-outing'], ['outingPath', 'Other/Outings/One.md'], ['stopId', 'other-stop']] as const) {
    const row = buildOutingCatchup(record, [{ ...saved, [key]: value }], places).rows[0];
    assert.equal(row.action, undefined, key); assert.equal(row.visit, undefined, key); assert.match(row.issues.join(' '), /belongs to another/, key);
  }
});

test('orphan associations, duplicated visit ids and shared links require manual review', () => {
  const record = outing(), saved = visit(record);
  assert.match(buildOutingCatchup(record, [saved], places).rows[0].issues.join(' '), /already refers/);
  const partial = { ...saved, outingId: undefined, stopId: undefined };
  assert.match(buildOutingCatchup(record, [partial], places).rows[0].issues.join(' '), /already refers/);
  linked(record, saved);
  const duplicate = { ...saved, path: 'Book/Visits/Duplicate.md' };
  assert.match(buildOutingCatchup(record, [saved, duplicate], places).rows[0].issues.join(' '), /More than one/);
  const second = { ...stop('stop-two'), visitId: saved.id, visitPath: saved.path };
  record.groups[0].stops.push(second);
  const result = buildOutingCatchup(record, [saved], places);
  assert.ok(result.rows.every(row => !row.action));
});

test('a deleted source remains visible but cannot receive catch-up edits', () => {
  const row = buildOutingCatchup(outing(), [], []).rows[0];
  assert.equal(row.name, 'One'); assert.equal(row.sourceAvailable, false); assert.equal(row.action, undefined);
  assert.match(row.issues.join(' '), /Restore it/);
});

test('another stop draft blocks edits and remains explicitly resumable even on a pending stop', () => {
  const record = outing([stop(), stop('stop-two', 'pending')]);
  record.draft = { stopId: 'stop-two', operationId: 'op', updatedAt: '2026-10-20T12:00:00Z', input: { observations: 'Kept draft', finds: '', nextTime: '', visitDate: '2026-10-17', updateLastVisited: false } };
  const result = buildOutingCatchup(record, [], places);
  assert.deepEqual(result.savedWork, { kind: 'draft', stopId: 'stop-two', name: 'Two', available: true });
  assert.equal(result.rows[0].action, undefined); assert.equal(result.rows.length, 1);
  record.draft.stopId = 'stop-one';
  assert.equal(buildOutingCatchup(record, [], places).rows[0].action, 'resume');
});

test('unfinished operations target their saved stop and prevent every normal catch-up edit', () => {
  const record = outing([stop(), stop('stop-two', 'pending')]);
  record.operation = { id: 'op', stopId: 'stop-two', sourcePath: another.path, recordedAt: '2026-10-20T12:00:00Z', sourceBeforeHash: 'hash', sourceIdentity: '', input: { observations: 'Keep', finds: '', nextTime: '', visitDate: '2026-10-17', updateLastVisited: false } };
  const result = buildOutingCatchup(record, [], places);
  assert.equal(result.savedWork?.kind, 'operation'); assert.equal(result.savedWork?.stopId, 'stop-two');
  assert.equal(result.rows[0].action, undefined); assert.equal(record.groups[0].stops[1].status, 'pending');
  record.operation.stopId = 'missing'; assert.equal(buildOutingCatchup(record, [], places).savedWork?.available, false);
});

test('planned outings do not offer catch-up edits', () => {
  const record = outing(); record.status = 'planned';
  const result = buildOutingCatchup(record, [], places);
  assert.equal(result.available, false); assert.equal(result.rows[0].action, undefined);
});

test('late entry uses the original completion in the outing timezone and start before planned date', () => {
  const record = outing(); record.planning = { timeZone: 'Europe/London', date: '2026-10-16' } as any;
  const date = catchupVisitDate(record, stop(), new Date('2026-10-20T12:00:00Z'));
  assert.equal(date.date, '2026-10-18'); assert.match(date.origin, /outing timezone/);
  const start = catchupVisitDate(record, {}, new Date('2026-10-20T12:00:00Z'));
  assert.equal(start.date, '2026-10-17'); assert.match(start.origin, /outing start/);
});

test('date suggestions explain planned, invalid-zone, finish and today fallbacks', () => {
  assert.equal(catchupVisitDate({ planning: { date: '2026-10-16', timeZone: 'Invalid/Zone' } }, {}).date, '2026-10-16');
  const invalidZone = catchupVisitDate({ planning: { timeZone: 'Invalid/Zone' }, startedAt: '2026-10-17T12:00:00Z' }, {});
  assert.match(invalidZone.origin, /device timezone/);
  assert.equal(catchupVisitDate({ finishedAt: '2026-10-17T12:00:00Z', planning: { timeZone: 'UTC' } }, {}).date, '2026-10-17');
  const today = new Date('2026-10-20T12:00:00Z'), expected = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  const fallback = catchupVisitDate({ startedAt: 'invalid', planning: { date: '2026-02-31' } }, { completedAt: 'invalid' }, today);
  assert.equal(fallback.date, expected); assert.match(fallback.origin, /today/);
});
