import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultShortTripOptions, readShortTripDefaults, seedShortTripDefaults, shortTripDefaultsFromOptions, shortTripForm, validateShortTripOptions } from '../src/outings/short-trip';

test('remembered short-trip choices seed only a new explicit saved start and preserve fresh date, clock and timezone', () => {
  const now = new Date(2026, 9, 21, 14, 23);
  const original = defaultShortTripOptions(now), seeded = seedShortTripDefaults(original, { startPath: 'Book/Places/Exampletown/Car.md', budgetMinutes: 90, maxStops: 4, visitMinutes: 15, returnToStart: true });
  assert.equal(original.budgetMinutes, 60); assert.equal(original.planning.start, null);
  assert.equal(seeded.planning.date, original.planning.date); assert.equal(seeded.planning.departureTime, '14:23'); assert.equal(seeded.planning.timeZone, original.planning.timeZone);
  assert.deepEqual(seeded.planning.start, { kind: 'record', path: 'Book/Places/Exampletown/Car.md' });
  assert.equal(seeded.budgetMinutes, 90); assert.equal(seeded.maxStops, 4); assert.equal(seeded.planning.defaultVisitMinutes, 15); assert.equal(seeded.planning.end.kind, 'return');
  assert.equal(seeded.rememberChoices, undefined);
});

test('defaults ignore malformed input and never copy typed coordinates, dates or arbitrary captured fields', () => {
  for (const input of [null, [], { budgetMinutes: 0 }, { budgetMinutes: '90' }, { maxStops: 6 }, { visitMinutes: NaN }, { returnToStart: 'yes' }, { startPath: '' }]) assert.equal(readShortTripDefaults(input), undefined);
  assert.deepEqual(readShortTripDefaults({ latitude: '51', longitude: '0', date: '2026-10-21', telephone: 'fictional' }), {});
  const options = defaultShortTripOptions(); options.form = { ...shortTripForm(options), startKind: 'coordinates', latitude: '51', longitude: '0' };
  assert.deepEqual(shortTripDefaultsFromOptions(options), { budgetMinutes: 60, maxStops: 3, visitMinutes: 20, returnToStart: false });
});

test('remember flag is validated without changing incomplete raw draft text', () => {
  const options = defaultShortTripOptions(); options.form = { ...shortTripForm(options), departureTime: '', maxStops: 'not yet' }; options.rememberChoices = true;
  const actual = validateShortTripOptions(options);
  assert.equal(actual.rememberChoices, true); assert.equal(actual.form?.departureTime, ''); assert.equal(actual.form?.maxStops, 'not yet');
  assert.throws(() => validateShortTripOptions({ ...options, rememberChoices: 'yes' }), /Remember choice/);
});
