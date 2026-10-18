import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { readNote, updateNoteProperty, wiki } from '../src/storage/markdown';
import type { OutingPlanInput, OutingVisitInput } from '../src/outings/types';

const visit: OutingVisitInput = { observations: 'Useful stock', finds: 'Coats', nextTime: 'Check the rail', visitDate: '2026-10-14', updateLastVisited: true, rating: 4.5, comments: 'Worth visiting' };
async function ready() {
  const f = fixture(); await f.store.setup(); const town = await f.store.ensureLocality('Exampletown');
  const one = await f.store.saveCapture({ ...newDraft('one'), name: 'First source' }, town.path, 'First source');
  const two = await f.store.saveCapture({ ...newDraft('two'), name: 'Second source', coordinates: [12.31, 45.6] }, town.path, 'Second source');
  const parking = await f.store.saveCapture({ ...newDraft('parking', 'parking'), name: 'Parking' }, town.path, 'Parking');
  const input: OutingPlanInput = { name: 'Saturday outing', groups: [{ id: 'group-one', parkingPath: parking.path, stops: [{ id: 'stop-one', sourcePath: one.path, status: 'pending' }, { id: 'stop-two', sourcePath: two.path, status: 'pending' }] }] };
  const outing = await f.store.outings.create(input); return { ...f, town, one, two, parking, input, outing };
}
const getFile = (f: ReturnType<typeof fixture>, path: string) => f.vault.getAbstractFileByPath(path) as TFile;

test('outings persist linked groups, user notes, independent shortlist and revision protection', async () => {
  const f = await ready();
  const raw = await f.vault.read(getFile(f, f.outing.path));
  assert.match(raw, /sourcing-outing/); assert.ok(raw.includes(wiki(f.one.path))); assert.ok(raw.includes(wiki(f.parking.path)));
  assert.doesNotMatch(raw, /codex-generated/);
  const reopened = new SourcingStore(f.app, f.settings, f.save);
  assert.equal((await reopened.outings.list())[0]!.path, f.outing.path);
  assert.equal((await reopened.outings.get(f.outing.path)).groups[0]!.stops[0]!.sourcePath, f.one.path);
  await f.vault.process(getFile(f, f.outing.path), text => text.replace('tags:', '# My own property comment\ntags:') + 'Personal plan\n');
  await assert.rejects(f.store.outings.start(f.outing.path, f.outing.revision), /changed/);
  const current = await f.store.outings.start(f.outing.path);
  await f.store.outings.completeStop(current.path, 'stop-one', 'visited', current.revision);
  const saved = await f.vault.read(getFile(f, current.path));
  assert.match(saved, /# My own property comment/); assert.ok(saved.endsWith('Personal plan\n'));
  assert.equal(readNote(await f.vault.read(f.one)).properties.shortlist, false);
  assert.doesNotMatch(await f.vault.read(f.one), /### /);
});

test('only one outing starts concurrently and finish preserves incomplete stops and draft for resume', async () => {
  const f = await ready(), other = await f.store.outings.create({ ...f.input, name: 'Another outing' });
  const results = await Promise.allSettled([f.store.outings.start(f.outing.path), f.store.outings.start(other.path)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const active = (await f.store.outings.list()).find(o => o.status === 'active')!;
  await f.store.outings.saveDraft(active.path, 'stop-one', visit);
  const finished = await f.store.outings.finish(active.path);
  assert.equal(finished.status, 'finished'); assert.equal(finished.groups[0]!.stops[0]!.status, 'pending'); assert.ok(finished.draft);
  const resumed = await f.store.outings.start(active.path);
  assert.equal(resumed.status, 'active'); assert.equal(resumed.finishedAt, undefined); assert.equal(resumed.draft!.input.observations, visit.observations);
});

test('drafts survive reload, retain operation ID and require explicit discard before switching stops', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  const draft = await f.store.outings.saveDraft(f.outing.path, 'stop-one', { ...visit, observations: '' });
  const reopened = new SourcingStore(f.app, f.settings, f.save);
  assert.equal((await reopened.outings.get(f.outing.path)).draft!.input.observations, '');
  const updated = await reopened.outings.saveDraft(f.outing.path, 'stop-one', visit, draft.revision);
  assert.equal(updated.draft!.operationId, draft.draft!.operationId);
  await assert.rejects(reopened.outings.saveDraft(f.outing.path, 'stop-two', visit), /Resume or discard/);
  await assert.rejects(reopened.outings.completeStop(f.outing.path, 'stop-one', 'visited'), /Save or discard/);
  assert.equal((await reopened.outings.discardDraft(f.outing.path)).draft, undefined);
});

test('skip and undo preserve source history, reorder cannot lose progress or duplicate sources', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  await f.store.outings.completeStop(f.outing.path, 'stop-one', 'skipped', undefined, 'Closed today');
  const ordered = await f.store.outings.reorder(f.outing.path, ['group-one'], { 'group-one': ['stop-two', 'stop-one'] });
  assert.equal(ordered.groups[0]!.stops[1]!.skipReason, 'Closed today');
  await assert.rejects(f.store.outings.reorder(f.outing.path, ['group-one'], { 'group-one': ['stop-one'] }), /every existing/);
  await assert.rejects(f.store.outings.remove(f.outing.path, 'stop-one'), /Keep completed/);
  await assert.rejects(f.store.outings.add(f.outing.path, 'group-one', f.one.path), /only once/);
  const undone = await f.store.outings.undo(f.outing.path, 'stop-one');
  assert.equal(undone.groups[0]!.stops[1]!.status, 'pending'); assert.equal(undone.groups[0]!.stops[1]!.skipReason, undefined);
  assert.doesNotMatch(await f.vault.read(f.one), /### /);
});

test('visit, optional assessment and receipt save atomically while preserving YAML comments and personal body', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  await f.vault.process(f.one, raw => raw.replace('rating: 0', 'rating: 0 # My rating\ncustom: "keep this"') + 'Personal notes\n');
  const draft = await f.store.outings.saveDraft(f.outing.path, 'stop-one', visit);
  const saved = await f.store.outings.recordVisit(f.outing.path, 'stop-one', visit, { operationId: draft.draft!.operationId, revision: draft.revision });
  const raw = await f.vault.read(f.one), note = readNote(raw);
  assert.equal(saved.groups[0]!.stops[0]!.status, 'visited'); assert.equal(saved.draft, undefined); assert.equal(saved.operation, undefined);
  assert.equal(note.properties.rating, 4.5); assert.equal(note.properties.comments, 'Worth visiting'); assert.equal(note.properties.last_visited, '2026-10-14'); assert.equal(note.properties.shortlist, false);
  assert.match(raw, /# My rating/); assert.match(raw, /custom: "keep this"/); assert.match(raw, /Personal notes/);
  assert.equal((note.properties.sourcing_visit_receipts as unknown[]).length, 1);
  assert.equal((await f.store.visits.list(f.one.path)).length, 1);
  await f.store.outings.recordVisit(f.outing.path, 'stop-one', visit, { operationId: draft.draft!.operationId });
  assert.equal((await f.store.visits.list(f.one.path)).length, 1);
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', { ...visit, observations: 'Different details' }, { operationId: draft.draft!.operationId }), /conflicting/);
  await f.store.outings.undo(f.outing.path, 'stop-one');
  assert.equal((await f.store.visits.list(f.one.path)).length, 1);
});

test('source write success followed by outing failure resumes without duplicate visit or reapplying assessment', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  await f.store.outings.saveDraft(f.outing.path, 'stop-one', visit);
  const process = f.vault.process.bind(f.vault); let sourceSaved = false;
  f.vault.process = async (file, callback) => {
    if (sourceSaved && file.path === f.outing.path) { sourceSaved = false; throw Error('Interrupted completion'); }
    const result = await process(file, callback);
    if (file.path === f.one.path) sourceSaved = true;
    return result;
  };
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', visit), /Interrupted/);
  assert.ok((await f.store.outings.get(f.outing.path)).operation);
  f.vault.process = process;
  await f.store.updateAssessment(f.one.path, { rating: 2, comments: 'My newer judgement' });
  const reopened = new SourcingStore(f.app, f.settings, f.save);
  const resumed = await reopened.outings.resumeVisit(f.outing.path);
  assert.equal(resumed.groups[0]!.stops[0]!.status, 'visited');
  const raw = await f.vault.read(f.one), note = readNote(raw);
  assert.equal((await f.store.visits.list(f.one.path)).length, 1);
  assert.equal(note.properties.rating, 2); assert.equal(note.properties.comments, 'My newer judgement');
});

test('uncertain source write outcome is recovered from atomic receipt after store reload', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  const process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (file, callback) => {
    const result = await process(file, callback);
    if (file.path === f.one.path && fail) { fail = false; throw Error('Uncertain saved result'); }
    return result;
  };
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', visit), /Uncertain/);
  f.vault.process = process;
  const reloaded = new SourcingStore(f.app, f.settings, f.save);
  await reloaded.outings.resumeVisit(f.outing.path);
  assert.equal((await f.store.visits.list(f.one.path)).length, 1);
});

test('pre-source interruption is retryable, changed or replaced source is protected and migration is blocked', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  const process = f.vault.process.bind(f.vault);
  f.vault.process = async (file, callback) => { if (file.path === f.one.path) throw Error('Source unavailable'); return process(file, callback); };
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', visit), /Source unavailable/);
  f.vault.process = process;
  await assert.rejects(f.store.previewNotebookMove('Moved notebook'), /unfinished outing visit/);
  await assert.rejects(f.store.outings.finish(f.outing.path), /unfinished visit/);
  await f.vault.process(f.one, raw => updateNoteProperty(raw, 'source_capture_id', 'replacement'));
  await assert.rejects(f.store.outings.resumeVisit(f.outing.path), /replaced/);
  await f.vault.process(f.one, raw => updateNoteProperty(updateNoteProperty(raw, 'source_capture_id', 'one'), 'rating', 1) + 'Concurrent edit\n');
  await assert.rejects(f.store.outings.resumeVisit(f.outing.path), /source.*changed/i);
  assert.doesNotMatch(await f.vault.read(f.one), /Visit date:/);
});

test('invalid visit assessment and duplicate filenames cause no operation or replacement', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', { ...visit, rating: 4.3 }), /half-star/);
  assert.equal((await f.store.outings.get(f.outing.path)).operation, undefined);
  await assert.rejects(f.store.outings.create(f.input), /already uses/);
  assert.equal((await f.store.outings.list()).length, 1);
});

test('ordinary visit save applies optional assessment atomically without removing frontmatter comments', async () => {
  const f = await ready();
  await f.vault.process(f.one, raw => raw.replace('rating: 0', 'rating: 0 # Preserve this'));
  await f.store.addVisit(f.one.path, { ...visit, visitDate: '2026-10-01', updateLastVisited: false });
  const raw = await f.vault.read(f.one), props = readNote(raw).properties;
  assert.match(raw, /# Preserve this/); assert.equal(props.rating, 4.5); assert.equal(props.last_visited, null);
  await f.store.addVisit(f.one.path, { ...visit, observations: 'Second visit', rating: undefined, comments: undefined });
  assert.equal((await f.store.visits.list(f.one.path)).length, 2);
});

test('moving one source and then notebook keeps outing links, progress and drafts intact', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  await f.store.outings.completeStop(f.outing.path, 'stop-two', 'skipped');
  await f.store.outings.saveDraft(f.outing.path, 'stop-one', visit);
  await f.store.changePlaceArea(f.one.path, { town: 'Other town', locality: '' });
  const movedSource = 'Reseller sourcing/Places/Other town/First source.md';
  let outing = await f.store.outings.get(f.outing.path);
  assert.equal(outing.groups[0]!.stops[0]!.sourcePath, movedSource);
  assert.equal(outing.groups[0]!.stops[1]!.status, 'skipped'); assert.ok(outing.draft);
  await f.store.moveNotebook('Moved notebook');
  outing = await f.store.outings.get(f.outing.path.replace('Reseller sourcing', 'Moved notebook'));
  assert.equal(outing.groups[0]!.stops[0]!.sourcePath, movedSource.replace('Reseller sourcing', 'Moved notebook'));
  assert.equal(outing.groups[0]!.parkingPath, f.parking.path.replace('Reseller sourcing', 'Moved notebook'));
  assert.ok(outing.draft); assert.equal(outing.status, 'active');
});

test('failed locality move rollback restores outing wikilinks and user notes', async () => {
  const f = await ready();
  const before = await f.vault.read(getFile(f, f.outing.path));
  const rename = f.vault.renameFile.bind(f.vault); let moved = 0;
  f.app.fileManager.renameFile = async (file, path) => { if (++moved === 2) throw Error('Interrupted move'); return rename(file as TFile, path); };
  await assert.rejects(f.store.moveLocality(f.town.path, 'Renamed town'), /Interrupted move/);
  f.app.fileManager.renameFile = rename;
  await f.store.rollbackMove();
  assert.equal(await f.vault.read(getFile(f, f.outing.path)), before);
  assert.equal((await f.store.outings.get(f.outing.path)).groups[0]!.stops[0]!.sourcePath, f.one.path);
});

test('cancelling a confirmed unsaved attempt preserves edits and draft with a fresh operation ID', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  const create = f.vault.create.bind(f.vault);
  f.vault.create = async (path, text) => { if (path.includes('/Visits/')) throw Error('Prewrite failure'); return create(path, text); };
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', visit), /Prewrite/);
  f.vault.create = create;
  const operation = (await f.store.outings.get(f.outing.path)).operation!;
  await f.vault.process(f.one, raw => raw + 'My edit after failure\n');
  const cancelled = await f.store.outings.cancelPendingVisit(f.outing.path);
  assert.equal(cancelled.operation, undefined); assert.deepEqual(cancelled.draft!.input, visit);
  assert.notEqual(cancelled.draft!.operationId, operation.id);
  assert.equal((await f.store.visits.list(f.one.path)).length, 0);
  await f.store.outings.recordVisit(f.outing.path, 'stop-one', cancelled.draft!.input);
  const raw = await f.vault.read(f.one);
  assert.match(raw, /My edit after failure/); assert.doesNotMatch(raw, /Visit date:/);
  assert.equal((await f.store.visits.list(f.one.path)).length, 1);
});

test('cancelling an attempt with a source receipt is refused and completion remains retryable', async () => {
  const f = await ready(); await f.store.outings.start(f.outing.path);
  const process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (file, callback) => {
    const result = await process(file, callback);
    if (file.path === f.one.path && fail) { fail = false; throw Error('Lost response'); }
    return result;
  };
  await assert.rejects(f.store.outings.recordVisit(f.outing.path, 'stop-one', visit), /Lost response/);
  f.vault.process = process;
  await assert.rejects(f.store.outings.cancelPendingVisit(f.outing.path), /already saved/);
  await f.store.outings.resumeVisit(f.outing.path);
  assert.equal((await f.store.visits.list(f.one.path)).length, 1);
});

test('missing parking in unchanged completed history does not block editing remaining groups', async () => {
  const f = await ready();
  const plan = { name: f.input.name, groups: [
    { ...f.input.groups[0]!, stops: [f.input.groups[0]!.stops[0]!] },
    { id: 'group-two', parkingPath: '', stops: [f.input.groups[0]!.stops[1]!] },
  ] };
  await f.store.outings.updatePlan(f.outing.path, plan); await f.store.outings.start(f.outing.path);
  await f.store.outings.completeStop(f.outing.path, 'stop-one', 'visited');
  f.vault.entries.delete(f.parking.path);
  const current = await f.store.outings.get(f.outing.path);
  const updated = await f.store.outings.updatePlan(f.outing.path, { name: 'Revised plan', groups: current.groups });
  assert.equal(updated.name, 'Revised plan'); assert.equal(updated.groups[0]!.parkingPath, f.parking.path);
  await assert.rejects(f.store.outings.create({ ...plan, name: 'New with missing parking' }), /valid group/);
  const changed = structuredClone(updated.groups); changed[0]!.parkingPath = 'Reseller sourcing/Places/Other missing.md';
  await assert.rejects(f.store.outings.updatePlan(f.outing.path, { name: updated.name, groups: changed }), /valid group/);
  const added = structuredClone(updated.groups);
  added[0]!.stops.push(added[1]!.stops[0]!); added.pop();
  await assert.rejects(f.store.outings.updatePlan(f.outing.path, { name: updated.name, groups: added }), /valid group/);
});
