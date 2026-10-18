import test from 'node:test';
import assert from 'node:assert/strict';
import { getAddressHints, matchAreaHints, normalizeAreaPhrase } from '../src/capture';
import { resolveLocalities } from '../src/domain/hierarchy';
import type { AreaHint } from '../src/types';

test('explicit postal towns and small locality components become review suggestions', () => {
  assert.deepEqual(getAddressHints('12b Lantern Rd, Riverside, Exampletown AB1 3EF'), { town: 'Exampletown', locality: 'Riverside', phrase: 'Riverside' });
  assert.deepEqual(getAddressHints('2 Main Road, Riverside, Exampletown AB1 1AA, United Kingdom'), { town: 'Exampletown', locality: 'Riverside', phrase: 'Riverside' });
  assert.deepEqual(getAddressHints('Unit 5, 2 Main Road, Riverside, Exampletown, AB1 1AA'), { town: 'Exampletown', locality: 'Riverside', phrase: 'Riverside' });
  assert.deepEqual(getAddressHints("2 Main Road, Queen's Orchard, Otherford CD2 3AA"), { town: 'Otherford', locality: "Queen's Orchard", phrase: "Queen's Orchard" });
});

test('premises text never becomes an assigned locality, but can seed an editable phrase', () => {
  assert.deepEqual(getAddressHints('50-51 Riverside Shopping Centre, Station Rd, Exampletown AB1 2CD'), { town: 'Exampletown', locality: '', phrase: 'Riverside Shopping Centre' });
  assert.deepEqual(getAddressHints('50-51 Riverside Shopping Centre, Station Rd, Exampletown AB1 1AA'), { town: 'Exampletown', locality: '', phrase: 'Riverside Shopping Centre' });
  assert.deepEqual(getAddressHints('2 Main Road, Shopping Centre, Exampletown AB1 1AA'), { town: 'Exampletown', locality: '', phrase: 'Shopping Centre' });
  assert.deepEqual(getAddressHints('2 Main Road, West Wing, Exampletown AB1 1AA'), { town: 'Exampletown', locality: '', phrase: 'West Wing' });
  for (const address of ['2 Main Road, Westshire, Exampletown AB1 1AA', '2 Main Road, Greater Exampletown, Exampletown AB1 1AA', '2 Main Road, West Wing, Riverside, Exampletown AB1 1AA', '2 Main Road, Station Rd, Exampletown AB1 1AA', 'Building, Riverside, Exampletown AB1 1AA']) assert.equal(getAddressHints(address).locality, '', address);
});

test('missing and uncertain postal information stays unselected', () => {
  for (const address of ['', 'No postal address', '2 Main Road, Riverside, Exampletown', '2 Main Road, EX1', '2 Main Road, A/B AB1 1AA', '2 Main Road, Shopping Centre AB1 1AA']) assert.deepEqual(getAddressHints(address), { town: '', locality: '', phrase: '' }, address);
  assert.deepEqual(getAddressHints('2 Main Road, Exampletown AB1 1AA'), { town: 'Exampletown', locality: '', phrase: '' });
});

const localities = resolveLocalities([
  { path: 'Root/Localities/Exampletown.md', name: 'Exampletown', parentPath: '' },
  { path: 'Root/Localities/Exampletown/Riverside.md', name: 'Riverside', parentPath: 'Root/Localities/Exampletown.md' },
  { path: 'Root/Localities/Exampletown/Riverside/Station.md', name: 'Station', parentPath: 'Root/Localities/Exampletown/Riverside.md' },
  { path: 'Root/Localities/Other town.md', name: 'Other town', parentPath: '' },
  { path: 'Root/Localities/Other town/Riverside.md', name: 'Riverside', parentPath: 'Root/Localities/Other town.md' },
]);
const town = localities.find(l => l.name === 'Exampletown')!.path;
const hint = (id: string, phrase = 'Riverside Shopping Centre', localityPath = 'Root/Localities/Exampletown/Riverside.md', enabled = true): AreaHint => ({ id, phrase, townPath: town, localityPath, enabled });

test('remembered hints match normalized contiguous words within their exact town', () => {
  const a = hint('a'), child = hint('child', 'Station Road', 'Root/Localities/Exampletown/Riverside/Station.md'), townOnly = hint('town', 'Exampletown', town);
  const address = '50-51 RIVERSIDE Shopping-Centre, Station Road, Exampletown AB1 1AA';
  assert.deepEqual(matchAreaHints(address, town, [a, child, townOnly], localities), [a, child, townOnly]);
  assert.equal(normalizeAreaPhrase(' Riverside — Shopping Centre '), 'riverside shopping centre');
  assert.deepEqual(matchAreaHints(address, 'Root/Localities/Other town.md', [a], localities), []);
  assert.deepEqual(matchAreaHints('Riversides Shopping Centre', town, [a], localities), []);
  assert.deepEqual(matchAreaHints('Riverside Centre Shopping', town, [a], localities), []);
  assert.deepEqual(matchAreaHints('RiversideShopping Centre', town, [a], localities), []);
});

test('disabled, dangling, unrelated and malformed hint targets are ignored', () => {
  const address = 'Riverside Shopping Centre, Exampletown AB1 1AA';
  const hints = [hint('disabled', undefined, undefined, false), hint('missing', undefined, 'Missing.md'), hint('other', undefined, 'Root/Localities/Other town/Riverside.md'), hint('empty target', undefined, ''), hint('', undefined), { ...hint('bad'), phrase: 3 } as unknown as AreaHint];
  assert.deepEqual(matchAreaHints(address, town, hints, localities), []);
  assert.deepEqual(matchAreaHints(address, 'Missing.md', [hint('a')], localities), []);
  assert.deepEqual(matchAreaHints(address, 'Root/Localities/Exampletown/Riverside.md', [hint('a')], localities), []);
});

test('matching conflicts are returned for caller review rather than resolved by order', () => {
  const a = hint('a'), b = hint('b', undefined, 'Root/Localities/Exampletown/Riverside/Station.md');
  assert.deepEqual(matchAreaHints('Riverside Shopping Centre', town, [a, b], localities), [a, b]);
  assert.deepEqual(matchAreaHints('Riverside Shopping Centre', town, [b, a], localities), [b, a]);
});
