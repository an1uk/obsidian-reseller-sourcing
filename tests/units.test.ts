import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceFromKm, distanceToKm, formatDistance, normaliseDistanceUnit, speedSuffix } from '../src/units';
import { DEFAULT_SETTINGS } from '../src/types';
import { parseExamplesState, EXAMPLES_STATE_FORMAT, ExamplesManager } from '../src/examples/state';
import { fixture } from './storage-fixtures';

test('distance preferences default to miles and reject invalid legacy values safely', () => {
  assert.equal(DEFAULT_SETTINGS.distanceUnit, 'miles');
  for (const value of [undefined, null, '', 'kilometres', 'KM', 'Miles', 1, {}, ['km']]) assert.equal(normaliseDistanceUnit(value), 'miles');
  assert.equal(normaliseDistanceUnit('miles'), 'miles'); assert.equal(normaliseDistanceUnit('km'), 'km');
});
test('display conversions preserve metric values and use exact statute-mile conversion', () => {
  assert.equal(distanceToKm(1, 'miles'), 1.609344);
  assert.equal(distanceFromKm(1.609344, 'miles'), 1);
  assert.equal(distanceFromKm(1.23456789, 'km'), 1.23456789);
  assert.equal(distanceToKm(1.23456789, 'km'), 1.23456789);
  for (const km of [.1, 1, 50, 1234.56789]) assert.ok(Math.abs(distanceToKm(distanceFromKm(km, 'miles'), 'miles') - km) < 1e-10);
  assert.equal(formatDistance(1.609344, 'miles'), '1.0 miles');
  assert.equal(formatDistance(1.23456789, 'km', 2), '1.23 km');
  assert.equal(formatDistance(0, 'miles'), '0.0 miles');
  assert.equal(formatDistance(NaN, 'miles'), 'Unavailable');
  assert.equal(speedSuffix('miles'), 'mph'); assert.equal(speedSuffix('km'), 'km/h');
});
test('old or invalid practice preferences normalise on read without rewriting the raw state', () => {
  const root = 'Notebook/Examples';
  for (const value of [undefined, 'invalid', 'km', 'miles']) {
    const settings: Record<string, unknown> = { ...structuredClone(DEFAULT_SETTINGS), root };
    if (value === undefined) delete settings.distanceUnit; else settings.distanceUnit = value;
    const raw = JSON.stringify({ format: EXAMPLES_STATE_FORMAT, schema: 1, instanceId: 'example-test', packVersion: 2, phase: 'ready', settings, files: {} });
    const before = raw, parsed = parseExamplesState(raw, root);
    assert.equal(parsed.settings.distanceUnit, value === 'km' ? 'km' : 'miles');
    assert.equal(parsed.settings.suggestionKm, DEFAULT_SETTINGS.suggestionKm);
    assert.equal(raw, before);
  }
});
test('new examples inherit the chosen units then persist changes independently of the real notebook', async () => {
  const f = fixture(); await f.store.setup(); f.settings.distanceUnit = 'km';
  const manager = new ExamplesManager(f.app, () => f.store.root, undefined, () => f.settings);
  await manager.add(); const session = (await manager.open())!;
  assert.equal(session.settings.distanceUnit, 'km');
  const originalRadius = session.settings.suggestionKm;
  session.settings.distanceUnit = 'miles'; await session.save();
  assert.equal(f.settings.distanceUnit, 'km');
  assert.equal(session.settings.suggestionKm, originalRadius);
  manager.invalidate(); const reopened = (await manager.open())!;
  assert.equal(reopened.settings.distanceUnit, 'miles');
  assert.equal(reopened.settings.suggestionKm, originalRadius);
});
