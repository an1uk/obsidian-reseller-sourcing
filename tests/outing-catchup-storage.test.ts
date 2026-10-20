import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { buildOutingCatchup } from '../src/outings/catch-up';
import { updateNoteProperty, writeNote } from '../src/storage/markdown';
import type { VisitInput } from '../src/types';

const input: VisitInput = { observations: 'Useful details', finds: '', nextTime: '', visitDate: '2026-10-17', updateLastVisited: false };
async function ready() {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft(), area.path, 'Source');
  let outing = await f.store.outings.create({ name: 'Saturday catch-up', groups: [{ id: 'group-one', parkingPath: '', stops: [{ id: 'stop-one', sourcePath: source.path, status: 'pending' }] }] });
  outing = await f.store.outings.start(outing.path);
  outing = await f.store.outings.completeStop(outing.path, 'stop-one', 'visited');
  outing = await f.store.outings.finish(outing.path);
  return { ...f, source, outing };
}
const snapshot = (f: Awaited<ReturnType<typeof ready>>) => [...f.vault.entries].map(([path, value]) => [path, value.text ?? '']).sort(([a], [b]) => a.localeCompare(b));
function references(f: Awaited<ReturnType<typeof ready>>, overrides = {}) {
  return { operationId: 'orphan', outingId: f.outing.id, outingPath: f.outing.path, stopId: 'stop-one', ...overrides };
}

test('save refuses an orphan inserted after catch-up preflight and keeps the draft and all files unchanged', async () => {
  const f = await ready(), places = await f.store.listPlaces();
  assert.equal(buildOutingCatchup(f.outing, [], places).rows[0].action, 'add');
  const draft = await f.store.outings.saveDraft(f.outing.path, 'stop-one', { ...input, observations: 'Draft to preserve' });
  await f.store.visits.create(f.source.path, input, references(f));
  const before = snapshot(f);
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', input, { revision: draft.revision }), /already refers/);
  assert.deepEqual(snapshot(f), before);
  const retained = await f.store.outings.get(f.outing.path);
  assert.equal(retained.draft?.input.observations, 'Draft to preserve'); assert.equal(retained.operation, undefined); assert.equal(retained.status, 'finished');
});

test('inspection retains targeted metadata for malformed associated notes without returning them as valid visits', async () => {
  const f = await ready(), visit = await f.store.visits.create(f.source.path, input, references(f));
  const file = f.vault.getAbstractFileByPath(visit.path) as TFile;
  await f.vault.process(file, raw => updateNoteProperty(raw, 'visit_date', 'invalid'));
  const before = snapshot(f), inspection = await f.store.visits.inspect();
  assert.equal(inspection.visits.length, 0); assert.ok(inspection.warnings.length);
  assert.deepEqual(inspection.rejectedAssociations, [{ path: visit.path, id: visit.id, outingId: f.outing.id, stopId: 'stop-one', sourcePath: f.source.path, outingPath: f.outing.path }]);
  const row = buildOutingCatchup(f.outing, inspection.visits, await f.store.listPlaces(), inspection.rejectedAssociations).rows[0];
  assert.equal(row.action, undefined); assert.match(row.issues.join(' '), /excluded visit note/);
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', input), /already refers/);
  assert.deepEqual(snapshot(f), before);
});

test('duplicate visit ids remain excluded from history but prevent a third catch-up entry', async () => {
  const f = await ready(), visit = await f.store.visits.create(f.source.path, input, references(f));
  const raw = await f.vault.read(f.vault.getAbstractFileByPath(visit.path) as TFile);
  const duplicatePath = visit.path.replace(/\.md$/, '-copy.md'); await f.vault.create(duplicatePath, raw);
  const inspection = await f.store.visits.inspect();
  assert.deepEqual(inspection.visits, []); assert.match(inspection.warnings.join(' '), /Duplicate visit identifier/);
  assert.equal(inspection.rejectedAssociations?.length, 2);
  assert.deepEqual(new Set(inspection.rejectedAssociations?.map(value => value.path)), new Set([visit.path, duplicatePath]));
  const before = snapshot(f);
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', input), /already refers/);
  assert.deepEqual(snapshot(f), before);
});

test('unrelated malformed records warn without blocking an explicit catch-up save', async () => {
  const f = await ready(), unrelated = await f.store.visits.create(f.source.path, input, references(f, { outingId: 'other-outing', outingPath: f.outing.path.replace(/\.md$/, '-other.md'), stopId: 'other-stop' }));
  await f.vault.process(f.vault.getAbstractFileByPath(unrelated.path) as TFile, raw => updateNoteProperty(raw, 'visit_date', 'invalid'));
  const inspection = await f.store.visits.inspect();
  assert.ok(inspection.warnings.length);
  assert.equal(buildOutingCatchup(f.outing, inspection.visits, await f.store.listPlaces(), inspection.rejectedAssociations).rows[0].action, 'add');
  const saved = await f.store.outings.recordVisit(f.outing.path, 'stop-one', input);
  assert.ok(saved.groups[0].stops[0].visitPath); assert.equal(saved.status, 'finished');
  assert.equal((await f.store.visits.list()).length, 1);
});

test('unparseable or hostile metadata is not guessed into another outing association', async () => {
  const f = await ready(), root = f.outing.path.split('/Outings/')[0];
  await f.vault.create(root + '/Visits/Unparseable.md', '---\nvisit_id: [\n---\n');
  await f.vault.create(root + '/Visits/Unsafe.md', writeNote({ tags: ['sourcing-visit'], visit_id: { id: 'object' }, source: '[[../Other]]', outing: '[[../Outings/Other]]', outing_id: 'not an id', stop_id: ['stop-one'], legacy_operation_id: 'unsafe/id' }, 'Personal note'));
  const inspection = await f.store.visits.inspect();
  assert.equal(inspection.warnings.length, 2);
  assert.ok(inspection.rejectedAssociations?.every(value => Object.keys(value).length === 1));
  assert.equal(buildOutingCatchup(f.outing, inspection.visits, await f.store.listPlaces(), inspection.rejectedAssociations).rows[0].action, 'add');
});
