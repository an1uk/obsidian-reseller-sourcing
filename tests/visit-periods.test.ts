import test from 'node:test';
import assert from 'node:assert/strict';
import { validVisitDate, visitPeriodRange, isVisitDateInRange } from '../src/visits/periods';

test('weeks run Monday through Sunday, including the current Sunday', () => {
  assert.deepEqual(visitPeriodRange('this-week', '2026-10-12'), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(visitPeriodRange('this-week', '2026-10-18'), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(visitPeriodRange('previous-week', '2026-10-18'), { from: '2026-10-05', to: '2026-10-11' });
});
test('weekly ranges cross month, year and leap-day boundaries without folder assumptions', () => {
  assert.deepEqual(visitPeriodRange('this-week', '2027-01-01'), { from: '2026-12-28', to: '2027-01-03' });
  assert.deepEqual(visitPeriodRange('previous-week', '2027-01-04'), { from: '2026-12-28', to: '2027-01-03' });
  assert.deepEqual(visitPeriodRange('this-week', '2024-03-01'), { from: '2024-02-26', to: '2024-03-03' });
});
test('daylight-saving transition weeks contain seven calendar dates', () => {
  assert.deepEqual(visitPeriodRange('this-week', '2026-03-29'), { from: '2026-03-23', to: '2026-03-29' });
  assert.deepEqual(visitPeriodRange('this-week', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' });
});
test('custom date ranges allow open ends and reject rollover dates or reversed bounds', () => {
  assert.deepEqual(visitPeriodRange('all', 'not-needed', { from: 'invalid' }), {});
  assert.deepEqual(visitPeriodRange('custom', 'not-needed', { from: '2026-09-01' }), { from: '2026-09-01' });
  assert.deepEqual(visitPeriodRange('custom', 'not-needed', { to: '2026-10-01' }), { to: '2026-10-01' });
  assert.throws(() => visitPeriodRange('custom', '2026-10-18', { from: '2026-02-30' }), /valid visit dates/);
  assert.throws(() => visitPeriodRange('custom', '2026-10-18', { from: '2026-10-18', to: '2026-10-17' }), /end date/);
  assert.throws(() => visitPeriodRange('this-week', '2026-02-30'), /valid reference date/);
});
test('range inclusion uses inclusive actual calendar dates and rejects non-date input', () => {
  const range = visitPeriodRange('this-week', '2026-10-18');
  for (const date of ['2026-10-12', '2026-10-15', '2026-10-18']) assert.equal(isVisitDateInRange(date, range), true);
  for (const date of ['2026-10-11', '2026-10-19', '2026-10-18T10:00:00Z', '2026-02-30']) assert.equal(isVisitDateInRange(date, range), false);
  assert.equal(validVisitDate('2024-02-29'), true); assert.equal(validVisitDate('2026-02-29'), false);
});
