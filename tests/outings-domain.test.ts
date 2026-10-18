import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeOutingGroups, suggestOutingOrder, suggestWalkingOrder, extractSourceContext } from '../src/outings/domain';
import type { OutingGroup, OutingStop } from '../src/outings/types';
import type { Coordinates, PlaceRecord } from '../src/types';
// Parking retains the original snapshot writer, used here for pre-0.6 source fixtures.
import { bodyForPlace } from '../src/storage/assets';
import { writeNote } from '../src/storage/markdown';
import { newDraft } from './storage-fixtures';

const source = (name: string, coords: Coordinates | null = [0, 0], properties: Record<string, unknown> = {}): PlaceRecord => ({ path: 'Sources/' + name + '.md', name, kind: 'shop', locality: '', coordinates: coords, properties });
const parking = (name: string, sources: PlaceRecord[], coords: Coordinates | null = [0, 0]): PlaceRecord => ({ path: 'Parking/' + name + '.md', name, kind: 'parking', locality: '', coordinates: coords, properties: { parking_for: sources.map(p => '[[' + p.path.replace(/\.md$/, '') + ']]') } });
const stop = (id: string, place: PlaceRecord, status: OutingStop['status'] = 'pending'): OutingStop => ({ id, sourcePath: place.path, status });
const group = (id: string, place: PlaceRecord, parkingPath = ''): OutingGroup => ({ id, parkingPath, stops: [stop('stop-' + id, place)] });

test('shared sole or preferred parking suggests one group without altering permanent preferences', () => {
  const a = source('A'), b = source('B'), c = source('C');
  const p = parking('Shared', [a, b]), other = parking('Other', [a]);
  a.properties.parking_location = '[[' + p.path.replace(/\.md$/, '') + ']]';
  const all = [a, b, c, p, other], before = structuredClone(all);
  const result = proposeOutingGroups([a, b, c], all);
  assert.deepEqual(result.issues, []); assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0]!.parkingPath, p.path);
  assert.deepEqual(result.groups[0]!.stops.map(s => s.sourcePath), [a.path, b.path]);
  assert.equal(result.groups[1]!.parkingPath, ''); assert.equal(result.groups[1]!.stops[0]!.sourcePath, c.path);
  assert.deepEqual(all, before); assert.ok(result.groups.flatMap(g => g.stops).every(s => s.status === 'pending'));
});

test('ambiguous and unusable inferred parking requires an explicit outing choice', () => {
  const a = source('A'), p = parking('One', [a]), q = parking('Two', [a]);
  assert.equal(proposeOutingGroups([a], [a, p, q]).issues.length, 1);
  const explicit = proposeOutingGroups([a], [a, p, q], { [a.path]: q.path });
  assert.deepEqual(explicit.issues, []); assert.equal(explicit.groups[0]!.parkingPath, q.path);
  assert.deepEqual(proposeOutingGroups([a], [a, p, q], { [a.path]: '' }).issues, []);
  p.coordinates = null;
  assert.equal(proposeOutingGroups([a], [a, p]).issues.length, 1);
  a.properties.parking_location = '[[Parking/Missing]]';
  assert.equal(proposeOutingGroups([a], [a, q]).issues.length, 1);
  assert.equal(proposeOutingGroups([a], [a, q]).groups[0]!.parkingPath, '');
  assert.equal(proposeOutingGroups([a], [a, q], { [a.path]: 'Parking/Missing.md' }).issues.length, 1);
});

test('unknown pins and explicit manual parking remain visible; independently built sources have distinct ids', () => {
  const a = source('A', null), b = source('B'), p = parking('Manual', [], null);
  const proposed = proposeOutingGroups([a, b], [a, b, p], { [a.path]: p.path });
  assert.equal(proposed.groups.length, 2); assert.equal(proposed.groups[0]!.parkingPath, p.path);
  assert.deepEqual(proposed.groups.flatMap(g => g.stops).map(s => s.sourcePath), [a.path, b.path]);
  const one = proposeOutingGroups([a], [a, b]).groups[0]!, two = proposeOutingGroups([b], [a, b]).groups[0]!;
  assert.notEqual(one.id, two.id); assert.notEqual(one.stops[0]!.id, two.stops[0]!.id);
  assert.deepEqual(proposeOutingGroups([a], [a, b]), proposeOutingGroups([a], [a, b]));
  assert.equal(proposeOutingGroups([a, a], [a]).groups.flatMap(g => g.stops).length, 1);
});

test('nearest-next driving proposal starts where chosen, uses parking and leaves unknown groups manual', () => {
  const a = source('A', [0, 0]), b = source('B', [0, 10]), c = source('C', [0, 2]), unknown = source('Unknown', null);
  const p = parking('Near', [b], [0, 1]), all = [a, b, c, unknown, p];
  const groups = [group('a', a), group('c', c), group('b', b, p.path), group('unknown', unknown)], before = structuredClone(groups);
  const result = suggestOutingOrder(groups, all, 'a');
  assert.deepEqual(result.groups.map(g => g.id), ['a', 'b', 'c', 'unknown']); assert.equal(result.warnings.length, 1);
  assert.deepEqual(groups, before);
  assert.deepEqual(suggestOutingOrder(groups, all, 'unknown').groups, groups);
  assert.ok(suggestOutingOrder(groups, all, 'unknown').warnings.length);
  assert.deepEqual(suggestOutingOrder(groups, all, 'c').groups.map(g => g.id), ['c', 'b', 'a', 'unknown']);
});

test('nearest ties are deterministic and any recorded group progress freezes its position', () => {
  const a = source('A', [0, 0]), b = source('B', [0, 1]), c = source('C', [0, -1]), old = source('Old', [0, 5]);
  const frozen = group('frozen', old); frozen.stops[0] = { ...frozen.stops[0]!, status: 'visited', completedAt: '2026-10-14T10:00:00Z', visitOperationId: 'operation-one' };
  frozen.stops.push(stop('still-pending', old));
  const groups = [group('a', a), frozen, group('c', c), group('b', b)], before = structuredClone(groups);
  const result = suggestOutingOrder(groups, [a, b, c, old], 'a');
  assert.deepEqual(result.groups.map(g => g.id), ['a', 'frozen', 'b', 'c']); assert.equal(result.groups[1], frozen);
  assert.deepEqual(groups, before); assert.deepEqual(result.groups[1]!.stops, before[1]!.stops);
  assert.deepEqual(suggestOutingOrder(groups, [a, b, c, old], 'frozen').groups, groups);
});

test('walking order begins at parking or an explicit source and preserves visited or skipped slots', () => {
  const far = source('Far', [0, 5]), near = source('Near', [0, 1]), medium = source('Medium', [0, 3]), old = source('Old', [0, 2]), unknown = source('Unknown', null), p = parking('Start', [], [0, 0]);
  const visited = { ...stop('old', old, 'visited'), completedAt: '2026-10-14T10:00:00Z', visitOperationId: 'visit-one' };
  const skipped = { ...stop('skip', old, 'skipped'), completedAt: '2026-10-14T11:00:00Z', skipReason: 'Closed' };
  const g: OutingGroup = { id: 'g', parkingPath: p.path, stops: [stop('far', far), visited, stop('medium', medium), skipped, stop('near', near), stop('unknown', unknown)] };
  const all = [far, near, medium, old, unknown, p], before = structuredClone(g);
  const result = suggestWalkingOrder(g, all);
  assert.deepEqual(result.group.stops.map(s => s.id), ['near', 'old', 'medium', 'skip', 'far', 'unknown']);
  assert.equal(result.group.stops[1], visited); assert.equal(result.group.stops[3], skipped); assert.deepEqual(g, before);
  assert.deepEqual(suggestWalkingOrder(g, all, 'far').group.stops.map(s => s.id), ['far', 'old', 'medium', 'skip', 'near', 'unknown']);
  assert.deepEqual(suggestWalkingOrder(g, all, 'old').group.stops, g.stops);
});

test('unknown walking starts never silently fall back from parking', () => {
  const a = source('A', [0, 2]), b = source('B', [0, 1]), p = parking('Unknown', [], null);
  const g: OutingGroup = { id: 'g', parkingPath: p.path, stops: [stop('a', a), stop('b', b)] };
  assert.deepEqual(suggestWalkingOrder(g, [a, b, p]).group.stops, g.stops);
  assert.ok(suggestWalkingOrder(g, [a, b, p]).warnings.length);
  assert.deepEqual(suggestWalkingOrder(g, [a, b, p], 'b').group.stops.map(s => s.id), ['b', 'a']);
});

const hours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => day + ', 9 am–5 pm');
const visit = (recorded: string, date: string, reminder: string) => `### ${recorded}\n\nVisit date: ${date}\n\n**Observations**\n\nSource notes.\n\n**Next time**\n\n${reminder}\n\n`;
const contextNote = (log: string, rows = hours, checked = '2026-10-14') => writeNote({ google_checked: checked }, bodyForPlace({ ...newDraft(), hours: rows, capturedAt: checked }, 'parking').replace('## Visit log\n\n', '## Visit log\n\n' + log));

test('source context reads captured weekly hours and the latest recorded reminder with its actual visit date', () => {
  const text = contextNote(visit('2026-10-14 12:00', '2026-09-01', 'Check the upstairs rail.\nRemember cash.') + visit('2026-10-13 14:00', '2026-10-13', 'An earlier reminder.'));
  assert.deepEqual(extractSourceContext(text), { hours, hoursChecked: '2026-10-14', reminder: 'Check the upstairs rail.\nRemember cash.', reminderDate: '2026-09-01' });
  assert.deepEqual(extractSourceContext(text.replace(/\n/g, '\r\n')).hours, hours);
});

test('incomplete hours and informal prose do not become inferred context', () => {
  assert.deepEqual(extractSourceContext('Opening hours: usually open.\n\n**Next time**\n\nAn informal note.'), { hours: [], hoursChecked: '', reminder: '', reminderDate: '' });
  assert.deepEqual(extractSourceContext(contextNote('', hours.slice(0, 6))).hours, []);
  assert.deepEqual(extractSourceContext(contextNote('', [...hours.slice(0, 6), hours[0]!])).hours, []);
  const unknown = extractSourceContext(contextNote('', hours, 'yesterday'));
  assert.deepEqual(unknown.hours, hours); assert.equal(unknown.hoursChecked, '');
  const outside = contextNote('') + '\n## Personal notes\n\n### 2026-10-14 12:00\n\nVisit date: 2026-10-14\n\n**Next time**\n\nOutside visit log.';
  assert.equal(extractSourceContext(outside).reminder, '');
});

test('only known, valid visit entries contribute reminders and same-minute ties retain newest-first order', () => {
  const text = contextNote(visit('2026-10-14 12:00', '2026-10-14', 'First in log.') + visit('2026-10-14 12:00', '2026-10-14', 'Second in log.') + visit('2026-10-15 30:00', '2026-10-14', 'Invalid time.') + visit('2026-10-15 12:00', '2026-02-31', 'Invalid visit date.'));
  assert.equal(extractSourceContext(text).reminder, 'First in log.');
  const malformed = contextNote('### 2026-10-14\n\nVisit date: 2026-10-14\n\n**Next time**\n\nNo recorded time.');
  assert.equal(extractSourceContext(malformed).reminder, '');
});
