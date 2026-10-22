import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { localDate, readNote, updateNoteProperty } from '../src/storage/markdown';
import { defaultPlanningOptions } from '../src/outings/planning';
import type { OutingPlanInput } from '../src/outings/types';

async function ready() {
  const f = fixture(); await f.store.setup();
  const town = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft('inspection-source'), town.path, 'Source');
  const parking = await f.store.saveCapture(newDraft('inspection-parking', 'parking'), town.path, 'Parking');
  const input: OutingPlanInput = { name: 'New outing', groups: [{ id: 'group-one', parkingPath: parking.path, stops: [{ id: 'stop-one', sourcePath: source.path, status: 'pending' }] }] };
  return { ...f, input, source, parking };
}
type Fixture = Awaited<ReturnType<typeof ready>>;
const file = (f: Fixture, path: string) => f.vault.getAbstractFileByPath(path) as TFile;
async function corrupt(f: Fixture, path: string, changes: Record<string, unknown> = {}) {
  await f.vault.process(file(f, path), raw => updateNoteProperty(raw, 'outing', { ...readNote(raw).properties.outing as Record<string, unknown>, groups: 'not an array', ...changes }));
  return f.vault.read(file(f, path));
}
const mentions = (path: string) => (error: unknown) => error instanceof Error && error.message.includes(path);

test('inspection isolates damaged historical outings while unrelated preparation retries and starts work', async () => {
  for (const status of ['planned', 'finished']) {
    const f = await ready(), historical = await f.store.outings.create({ ...f.input, name: 'Old outing' });
    const damaged = await corrupt(f, historical.path, { status });
    const first = await f.store.outings.create(f.input, 'new-preparation-identity');
    const retried = await f.store.outings.create({ ...f.input, name: 'Retry name ignored' }, 'new-preparation-identity');
    assert.equal(retried.path, first.path);
    const inspection = await f.store.outings.inspect();
    assert.deepEqual(inspection.records.map(record => record.path), [first.path]);
    assert.equal(inspection.problems.length, 1);
    assert.equal(inspection.problems[0]!.path, historical.path);
    assert.match(inspection.problems[0]!.message, /invalid properties/);
    await assert.rejects(f.store.outings.list(), mentions(historical.path));
    assert.equal((await f.store.outings.start(first.path, first.revision)).status, 'active');
    assert.equal(await f.vault.read(file(f, historical.path)), damaged);
  }
});

test('malformed identities still prevent duplicate completion or an ambiguous retry', async () => {
  for (const changes of [{ id: 'same-preparation-id' }, { id: undefined }, { preparationId: 'same-preparation-id' }]) {
    const f = await ready(), historical = await f.store.outings.create({ ...f.input, name: 'Needs review' });
    await corrupt(f, historical.path, changes);
    const before = [...f.vault.entries.keys()];
    await assert.rejects(f.store.outings.create(f.input, 'same-preparation-id'), mentions(historical.path));
    assert.deepEqual([...f.vault.entries.keys()], before);
  }
});

test('damaged active or unknown-status outings block another start with the affected path', async () => {
  for (const status of ['active', 'misspelled', undefined]) {
    const f = await ready(), historical = await f.store.outings.create({ ...f.input, name: 'Needs review' });
    const planned = await f.store.outings.create(f.input);
    await corrupt(f, historical.path, { status });
    await assert.rejects(f.store.outings.start(planned.path), mentions(historical.path));
    assert.equal((await f.store.outings.get(planned.path)).status, 'planned');
  }
});

test('unreadable YAML is visible during browsing and remains blocking for completeness checks', async () => {
  const f = await ready(), planned = await f.store.outings.create(f.input);
  const path = f.store.root + '/Outings/Unreadable.md';
  await f.vault.create(path, '---\ntags: [sourcing-outing\n---\nPrivate notes remain here.\n');
  const inspection = await f.store.outings.inspect();
  assert.deepEqual(inspection.records.map(record => record.path), [planned.path]);
  assert.equal(inspection.problems[0]!.path, path);
  await assert.rejects(f.store.outings.list(), mentions(path));
  await assert.rejects(f.store.outings.start(planned.path), mentions(path));
  await assert.rejects(f.store.outings.create({ ...f.input, name: 'Another' }, 'new-preparation-identity'), mentions(path));
  await assert.rejects(f.store.previewNotebookMove('Moved notebook'), mentions(path));
  assert.equal(f.store.root, 'Reseller sourcing');
});

test('inspection still ignores ordinary notes, foreign notebooks and marked examples', async () => {
  const f = await ready(), planned = await f.store.outings.create(f.input);
  await f.vault.create(f.store.root + '/Outings/Personal.md', '# My personal outing ideas\n');
  await f.vault.create(f.store.root + '/Outings/Example.md', '---\ntags: [sourcing-outing]\nsourcing_example: true\nouting: broken\n---\n');
  await f.vault.create('Other notebook/Outings/Broken.md', '---\ntags: [sourcing-outing\n---\n');
  assert.deepEqual((await f.store.outings.list()).map(record => record.path), [planned.path]);
  assert.deepEqual((await f.store.outings.inspect()).problems, []);
});

test('known active outings and duplicate preparation identities still prevent unsafe operations', async () => {
  const f = await ready(), first = await f.store.outings.create(f.input, 'duplicate-preparation-id');
  const other = await f.store.outings.create({ ...f.input, name: 'Another' });
  await f.store.outings.start(first.path);
  await assert.rejects(f.store.outings.start(other.path), /Finish the current outing/);
  await f.vault.create(f.store.root + '/Outings/Duplicate.md', await f.vault.read(file(f, first.path)));
  await assert.rejects(f.store.outings.create(f.input, 'duplicate-preparation-id'), /Several outings/);
});

test('unplanned outings use the local date for creation and collision checks at month boundaries', async t => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'Europe/London';
  t.after(() => { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-30T23:30:00Z') });
  const f = await ready();
  assert.equal(localDate(), '2026-05-01');
  await f.store.outings.validatePreparation(f.input);
  const created = await f.store.outings.create(f.input);
  assert.equal(created.path, f.store.root + '/Outings/2026/05/New outing.md');
  await assert.rejects(f.store.outings.validatePreparation(f.input), /already uses that name/);
  const planning = { ...defaultPlanningOptions(), date: '2026-04-30', start: { kind: 'record' as const, path: f.parking.path } };
  const explicit = await f.store.outings.create({ ...f.input, name: 'Explicit date', planning });
  assert.equal(explicit.path, f.store.root + '/Outings/2026/04/Explicit date.md');
});

test('local year boundaries and existing outing paths remain stable', async t => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-01T01:00:00Z') });
  const f = await ready(), outing = await f.store.outings.create(f.input);
  assert.equal(localDate(), '2026-12-31');
  assert.equal(outing.path, f.store.root + '/Outings/2026/12/New outing.md');
  t.mock.timers.setTime(new Date('2027-01-02T15:00:00Z').getTime());
  const updated = await f.store.outings.updatePlan(outing.path, { ...f.input, name: 'Edited later' }, outing.revision);
  assert.equal(updated.path, outing.path);
});
