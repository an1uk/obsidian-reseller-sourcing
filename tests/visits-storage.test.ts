import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { readNote, updateNoteProperty, hashText } from '../src/storage/markdown';
import { readVisitRecord, writeVisitRecord } from '../src/visits/store';
import type { VisitInput } from '../src/types';

const input = (extra: Partial<VisitInput> = {}): VisitInput => ({ observations: '', finds: '', nextTime: '', visitDate: '2026-10-02', updateLastVisited: false, itemsPurchased: 0, ...extra });
async function ready() {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft(), area.path, 'Source');
  return { ...f, source };
}
const file = (f: Awaited<ReturnType<typeof ready>>, path: string) => f.vault.getAbstractFileByPath(path) as TFile;

test('zero and unknown outcomes save separately without changing source bytes or synthesising haul scores', async () => {
  const f = await ready(), before = await f.vault.read(f.source);
  const zero = await f.store.visits.create(f.source.path, input({ haulPotential: 5 }), { operationId: 'zero' });
  const unknown = await f.store.visits.create(f.source.path, input({ itemsPurchased: undefined, observations: 'Observed only' }), { operationId: 'unknown' });
  assert.equal(zero.itemsPurchased, 0); assert.equal(zero.haulPotential, undefined); assert.equal(unknown.itemsPurchased, undefined);
  assert.equal(await f.vault.read(f.source), before); assert.match(zero.path, /\/Visits\/2026\/10\//);
  const p = readNote(await f.vault.read(file(f, zero.path))).properties;
  assert.equal(p.items_purchased, 0); assert.equal(p.source, '[[' + f.source.path.replace(/\.md$/, '') + ']]');
  assert.equal((await f.store.visits.list(f.source.path)).length, 2);
});
test('new visit inputs reject invalid integers and support measures without prose', async () => {
  const f = await ready();
  for (const itemsPurchased of [-1, .5, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(f.store.visits.create(f.source.path, input({ itemsPurchased })), /whole number/);
  for (const haulPotential of [0, 1.5, 6]) await assert.rejects(f.store.visits.create(f.source.path, input({ itemsPurchased: 1, haulPotential })), /1 to 5/);
  const score = await f.store.visits.create(f.source.path, input({ itemsPurchased: undefined, haulPotential: 3 }));
  assert.equal(score.haulPotential, 3); assert.equal(score.itemsPurchased, undefined);
});
test('editing retains visit identity, personal notes, unrelated properties and source body', async () => {
  const f = await ready(), visit = await f.store.visits.create(f.source.path, input({ itemsPurchased: 2, observations: 'Before', stockColour: 'Blue', colourEvidence: 'confirmed' }));
  const vf = file(f, visit.path); await f.vault.process(vf, raw => updateNoteProperty(raw, 'personal_property', 'keep') + 'Personal [[Note]]\n\n## Another section\n\nKeep this too.\n');
  const latest = await f.store.visits.get(visit.path), sourceBefore = await f.vault.read(f.source);
  const edited = await f.store.visits.update(visit.path, input({ observations: 'After', itemsPurchased: undefined, haulPotential: 4, visitDate: '2026-09-01' }), latest.revision);
  assert.equal(edited.id, visit.id); assert.equal(edited.path, visit.path); assert.equal(edited.recordedAt, visit.recordedAt);
  const raw = await f.vault.read(vf); assert.match(raw, /Personal \[\[Note\]\]/); assert.match(raw, /Keep this too/);
  assert.equal(readNote(raw).properties.personal_property, 'keep'); assert.equal(edited.itemsPurchased, undefined);
  assert.equal(await f.vault.read(f.source), sourceBefore);
});
test('stale visit edits preserve all concurrent personal prose', async () => {
  const f = await ready(), visit = await f.store.visits.create(f.source.path, input());
  await f.vault.process(file(f, visit.path), raw => raw + 'Concurrent prose\n');
  const before = await f.vault.read(file(f, visit.path));
  await assert.rejects(f.store.visits.update(visit.path, input({ observations: 'Stale' }), visit.revision), /changed/);
  assert.equal(await f.vault.read(file(f, visit.path)), before);
});
test('explicit source assessment and last date updates preserve body and independent shortlist', async () => {
  const f = await ready(), before = readNote(await f.vault.read(f.source)).body;
  await f.store.updateAssessment(f.source.path, { shortlist: true });
  await f.store.visits.create(f.source.path, input({ rating: 3.5, comments: 'Selective', updateLastVisited: true }));
  const n = readNote(await f.vault.read(f.source)); assert.equal(n.body, before); assert.equal(n.properties.shortlist, true);
  assert.equal(n.properties.rating, 3.5); assert.equal(n.properties.last_visited, '2026-10-02');
});
test('create retries recover a written visit after journal failure and never duplicate or replay assessment', async () => {
  const f = await ready(), process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (vf, run) => {
    const result = await process(vf, run);
    if (fail && vf.path.includes('/Visit operations/') && result.includes('"stage": "complete"')) { fail = false; throw Error('Journal interrupted'); }
    return result;
  };
  const value = input({ itemsPurchased: 2, rating: 4 });
  await assert.rejects(f.store.visits.create(f.source.path, value, { operationId: 'retry' }), /Journal interrupted/);
  assert.equal((await f.store.visits.list()).length, 1);
  await f.store.updateAssessment(f.source.path, { rating: 1 });
  const retry = await f.store.visits.create(f.source.path, value, { operationId: 'retry' });
  assert.equal(retry.id, 'retry'); assert.equal((await f.store.visits.list()).length, 1);
  assert.equal(readNote(await f.vault.read(f.source)).properties.rating, 1);
});
test('interruption before journal stage update preserves concurrent visit personal notes during recovery', async () => {
  const f = await ready(), process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (vf, run) => {
    if (fail && vf.path.includes('/Visit operations/')) { fail = false; throw Error('Stage interrupted'); }
    return process(vf, run);
  };
  await assert.rejects(f.store.visits.create(f.source.path, input(), { operationId: 'stage' }), /Stage interrupted/);
  const pending = (await f.store.visits.pendingOperations())[0]!;
  await f.vault.process(file(f, pending.visitPath), raw => raw + 'Personal recovery note\n');
  await f.store.visits.resumeOperation(pending.id);
  assert.match(await f.vault.read(file(f, pending.visitPath)), /Personal recovery note/);
  assert.equal((await f.store.visits.pendingOperations()).length, 0);
});
test('prepared operations can cancel but written visits cannot be cancelled or recreated after deletion', async () => {
  const f = await ready(), create = f.vault.create.bind(f.vault); let fail = true;
  f.vault.create = async (path, text) => { if (fail && path.includes('/Visits/')) { fail = false; throw Error('Create interrupted'); } return create(path, text); };
  await assert.rejects(f.store.visits.create(f.source.path, input(), { operationId: 'cancel' }), /interrupted/);
  await f.store.visits.cancelOperation('cancel'); assert.equal((await f.store.visits.pendingOperations()).length, 0);
  await assert.rejects(f.store.visits.resumeOperation('cancel'), /cancelled/);
  const saved = await f.store.visits.create(f.source.path, input(), { operationId: 'saved' });
  await assert.rejects(f.store.visits.cancelOperation('saved'), /already saved/);
  f.vault.entries.delete(saved.path);
  await assert.rejects(f.store.visits.resumeOperation('saved'), /no longer exists/);
  assert.equal(f.vault.getAbstractFileByPath(saved.path), null);
});
test('duplicate visit IDs are excluded with visible warnings and cannot be edited', async () => {
  const f = await ready(), visit = await f.store.visits.create(f.source.path, input());
  await f.vault.create(visit.path.replace(/\.md$/, ' copy.md'), await f.vault.read(file(f, visit.path)));
  const state = await f.store.visits.inspect(); assert.equal(state.visits.length, 0); assert.match(state.warnings.join('\n'), /Duplicate visit identifier/);
  await assert.rejects(f.store.visits.get(visit.path), /Duplicate/);
});
test('durable drafts retain unknown fields and do not count as visits or change source bytes', async () => {
  const f = await ready(), before = await f.vault.read(f.source), count = f.vault.getFiles().length;
  assert.equal(await f.store.visits.getDraft(f.source.path), undefined); assert.equal(f.vault.getFiles().length, count);
  await f.store.visits.saveDraft(f.source.path, input({ observations: 'Draft', itemsPurchased: undefined, stockColour: 'Red', colourEvidence: 'suspected' }));
  const reopened = new SourcingStore(f.app, f.settings, f.save);
  assert.equal((await reopened.visits.getDraft(f.source.path))?.itemsPurchased, undefined);
  assert.equal((await reopened.visits.list()).length, 0); assert.equal(await f.vault.read(f.source), before);
  await reopened.visits.clearDraft(f.source.path, undefined, (await reopened.visits.getDraftState(f.source.path))!.revision); assert.equal(await reopened.visits.getDraft(f.source.path), undefined);
});
test('late details edit a linked visit without restarting a finished outing; skipped conversion requires confirmation', async () => {
  const f = await ready(), outing = await f.store.outings.create({ name: 'Late', groups: [{ id: 'g', parkingPath: '', stops: [{ id: 's', sourcePath: f.source.path, status: 'pending' }] }] });
  await f.store.outings.start(outing.path);
  await f.store.outings.completeStop(outing.path, 's', 'visited');
  await f.store.outings.finish(outing.path); const finished = await f.store.outings.get(outing.path);
  await f.store.outings.saveDraft(outing.path, 's', input({ itemsPurchased: 3 }));
  const saved = await f.store.outings.recordVisit(outing.path, 's', input({ itemsPurchased: 3 }));
  assert.equal(saved.status, 'finished'); assert.equal(saved.finishedAt, finished.finishedAt);
  assert.ok(saved.groups[0]!.stops[0]!.visitPath); assert.equal((await f.store.visits.list()).length, 1);
  const edited = await f.store.outings.recordVisit(outing.path, 's', input({ itemsPurchased: 4 }), { visitRevision: (await f.store.visits.get(saved.groups[0]!.stops[0]!.visitPath!)).revision });
  assert.equal((await f.store.visits.list()).length, 1); assert.equal((await f.store.visits.get(edited.groups[0]!.stops[0]!.visitPath!)).itemsPurchased, 4);
  await f.store.outings.undo(outing.path, 's'); await f.store.outings.start(outing.path);
  await f.store.outings.completeStop(outing.path, 's', 'skipped'); await f.store.outings.finish(outing.path);
  await assert.rejects(f.store.outings.recordVisit(outing.path, 's', input()), /Confirm/);
  assert.equal((await f.store.outings.recordVisit(outing.path, 's', input(), { confirmSkipped: true, visitRevision: (await f.store.visits.get(edited.groups[0]!.stops[0]!.visitPath!)).revision })).groups[0]!.stops[0]!.status, 'visited');
});
test('legacy pending operations keep the original inline writer and input receipt hashes', async () => {
  const f = await ready(), outing = await f.store.outings.create({ name: 'Legacy', groups: [{ id: 'g', parkingPath: '', stops: [{ id: 's', sourcePath: f.source.path, status: 'pending' }] }] });
  await f.store.outings.start(outing.path);
  const raw = await f.vault.read(f.source), legacy = input({ observations: 'Old saved payload', itemsPurchased: undefined });
  await f.vault.process(file(f, outing.path), text => {
    const data = readNote(text).properties.outing as any;
    data.operation = { id: 'legacy-op', stopId: 's', sourcePath: f.source.path, input: legacy, recordedAt: '2026-10-14T12:00:00Z', sourceBeforeHash: '', sourceIdentity: 'manual-one' };
    return updateNoteProperty(text, 'outing', data);
  });
  const hash = await hashText(raw);
  await f.vault.process(file(f, outing.path), text => { const data = readNote(text).properties.outing as any; data.operation.sourceBeforeHash = hash; return updateNoteProperty(text, 'outing', data); });
  await f.store.outings.resumeVisit(outing.path);
  assert.match(readNote(await f.vault.read(f.source)).body, /Old saved payload/);
  assert.equal((await f.store.visits.list()).length, 0);
  const receipts = readNote(await f.vault.read(f.source)).properties.sourcing_visit_receipts as any[];
  assert.equal(receipts[0].inputHash, await hashText(JSON.stringify(legacy)));
});

test('recovery rejects tampered inputs, hashes, dates and expected content without any writes', async () => {
  for (const change of ['input', 'hash', 'expected', 'date'] as const) {
    const f = await ready(), create = f.vault.create.bind(f.vault); let fail = true;
    f.vault.create = async (path, text) => { if (fail && path.includes('/Visits/')) { fail = false; throw Error('Prepare only'); } return create(path, text); };
    await assert.rejects(f.store.visits.create(f.source.path, input(), { operationId: 'tamper' }), /Prepare only/);
    const journal = file(f, f.store.root + '/System/Visit operations/tamper.json');
    await f.vault.process(journal, raw => {
      const data = JSON.parse(raw);
      if (change === 'input') data.input.itemsPurchased = -1;
      if (change === 'hash') data.inputHash = 'not-the-input-hash';
      if (change === 'expected') data.expected.itemsPurchased = 42;
      if (change === 'date') data.expected.visitDate = '2026-02-31';
      return JSON.stringify(data, null, 2) + '\n';
    });
    const before = new Map([...f.vault.entries].map(([path, value]) => [path, value.text]));
    await assert.rejects(f.store.visits.resumeOperation('tamper'), /whole number|fingerprint|content|date/);
    assert.deepEqual(new Map([...f.vault.entries].map(([path, value]) => [path, value.text])), before);
    assert.ok((await f.store.visits.inspect()).warnings.length);
    await assert.rejects(f.store.visits.pendingOperations(), /whole number|fingerprint|content|date/);
  }
});
test('ordinary Markdown subheadings round-trip while reserved managed headings fail before writing', async () => {
  const f = await ready(), observations = 'A careful look.\n\n## My heading\n\nSeveral rails deserve a second pass.';
  const visit = await f.store.visits.create(f.source.path, input({ observations }));
  assert.equal(visit.observations, observations);
  const edited = await f.store.visits.update(visit.path, input({ observations: observations + '\n\n## Another idea\n\nRead the labels.' }), visit.revision);
  assert.match(edited.observations, /Another idea/);
  const before = new Map([...f.vault.entries].map(([path, value]) => [path, value.text]));
  await assert.rejects(f.store.visits.create(f.source.path, input({ observations: 'Text\n\n## Notes\n\nAmbiguous' })), /reserved headings/);
  assert.deepEqual(new Map([...f.vault.entries].map(([path, value]) => [path, value.text])), before);
});
test('legacy recovery still refuses a source body changed since its old snapshot', async () => {
  const f = await ready(), outing = await f.store.outings.create({ name: 'Old comparison', groups: [{ id: 'g', parkingPath: '', stops: [{ id: 's', sourcePath: f.source.path, status: 'pending' }] }] });
  await f.store.outings.start(outing.path); const hash = await hashText(await f.vault.read(f.source));
  await f.vault.process(file(f, outing.path), text => {
    const data = readNote(text).properties.outing as any;
    data.operation = { id: 'old-comparison', stopId: 's', sourcePath: f.source.path, input: input({ observations: 'Old data', itemsPurchased: undefined }), recordedAt: '2026-10-14T12:00:00Z', sourceBeforeHash: hash, sourceIdentity: 'manual-one' };
    return updateNoteProperty(text, 'outing', data);
  });
  await f.vault.process(f.source, raw => raw + 'Concurrent legacy prose\n');
  const before = await f.vault.read(f.source);
  await assert.rejects(f.store.outings.resumeVisit(outing.path), /source changed/i);
  assert.equal(await f.vault.read(f.source), before); assert.equal((await f.store.visits.list()).length, 0);
});

test('outing-linked edits require the captured visit revision and never overwrite concurrent visit prose or fields', async () => {
  const f = await ready(), outing = await f.store.outings.create({ name: 'Compared edit', groups: [{ id: 'g', parkingPath: '', stops: [{ id: 's', sourcePath: f.source.path, status: 'pending' }] }] });
  const saved = await f.store.outings.recordVisit(outing.path, 's', input({ itemsPurchased: 2 }));
  const path = saved.groups[0]!.stops[0]!.visitPath!, visit = await f.store.visits.get(path);
  await f.store.outings.saveDraft(outing.path, 's', input({ itemsPurchased: 3 }), saved.revision, visit.revision);
  await f.vault.process(file(f, path), raw => updateNoteProperty(raw, 'items_purchased', 8) + 'Concurrent visit note\n');
  const before = await f.vault.read(file(f, path)), latest = await f.store.outings.get(outing.path);
  assert.equal(latest.draft?.visitRevision, visit.revision);
  await assert.rejects(f.store.outings.recordVisit(outing.path, 's', input({ itemsPurchased: 3 }), { revision: latest.revision, visitRevision: visit.revision }), /linked visit changed/);
  assert.equal(await f.vault.read(file(f, path)), before);
  assert.equal((await f.store.outings.get(outing.path)).operation, undefined);
  await assert.rejects(f.store.outings.recordVisit(outing.path, 's', input({ itemsPurchased: 3 })), /linked visit changed/);
  assert.equal((await f.store.visits.list()).length, 1);
});
test('invalid unrelated visit notes remain visible warnings without preventing valid visits from opening', async () => {
  const f = await ready(), saved = await f.store.visits.create(f.source.path, input());
  await f.vault.create(f.store.root + '/Visits/Invalid.md', '---\nbroken: [\n---\n');
  assert.equal((await f.store.visits.get(saved.path)).id, saved.id);
  const inspected = await f.store.visits.inspect(); assert.equal(inspected.visits.length, 1); assert.ok(inspected.warnings.length > 0);
});

test('standalone draft compare-and-swap prevents competing panes and tombstone resurrection', async () => {
  const f = await ready(), first = input({ observations: 'Pane A' }), other = input({ observations: 'Pane B' });
  const races = await Promise.allSettled([f.store.visits.saveDraft(f.source.path, first), f.store.visits.saveDraft(f.source.path, other)]);
  assert.equal(races.filter(result => result.status === 'fulfilled').length, 1);
  const state = (await f.store.visits.getDraftState(f.source.path))!;
  const next = await f.store.visits.saveDraft(f.source.path, other, undefined, state.revision);
  await assert.rejects(f.store.visits.clearDraft(f.source.path, undefined, state.revision), /changed/);
  assert.equal((await f.store.visits.getDraft(f.source.path))!.observations, 'Pane B');
  await f.store.visits.clearDraft(f.source.path, undefined, next);
  assert.equal(await f.store.visits.getDraft(f.source.path), undefined);
  const tombstone = (await f.store.visits.getDraftState(f.source.path))!;
  assert.equal(tombstone.cleared, true);
  await assert.rejects(f.store.visits.saveDraft(f.source.path, first, undefined, ''), /changed/);
  await f.store.visits.saveDraft(f.source.path, first, undefined, tombstone.revision);
  assert.equal((await f.store.visits.getDraft(f.source.path))!.observations, 'Pane A');
});
test('standalone saved edit drafts retain their reviewed visit base after concurrent changes', async () => {
  const f = await ready(), saved = await f.store.visits.create(f.source.path, input({ itemsPurchased: 2 }));
  await f.store.visits.saveDraft(f.source.path, input({ itemsPurchased: 3 }), saved.path, '', saved.revision);
  await f.vault.process(file(f, saved.path), raw => raw + 'Another pane edited personal visit prose\n');
  const restored = (await f.store.visits.getDraftState(f.source.path, saved.path))!;
  assert.equal(restored.visitRevision, saved.revision);
  const before = await f.vault.read(file(f, saved.path));
  await assert.rejects(f.store.visits.update(saved.path, restored.input, restored.visitRevision!, { draftRevision: restored.revision }), /visit changed/);
  assert.equal(await f.vault.read(file(f, saved.path)), before);
});
test('visit creation and editing recheck the draft comparison in their serial admission operation', async () => {
  const f = await ready(), a = input({ itemsPurchased: 2 }), b = input({ itemsPurchased: 9 });
  const hashA = await f.store.visits.saveDraft(f.source.path, a);
  const hashB = await f.store.visits.saveDraft(f.source.path, b, undefined, hashA);
  const before = new Map([...f.vault.entries].map(([path, entry]) => [path, entry.text]));
  await assert.rejects(f.store.visits.create(f.source.path, a, { draftRevision: hashA }), /draft changed/);
  assert.deepEqual(new Map([...f.vault.entries].map(([path, entry]) => [path, entry.text])), before);
  const saved = await f.store.visits.create(f.source.path, b, { draftRevision: hashB });
  const editA = await f.store.visits.saveDraft(f.source.path, a, saved.path, '', saved.revision);
  await f.store.visits.saveDraft(f.source.path, b, saved.path, editA, saved.revision);
  const raw = await f.vault.read(file(f, saved.path));
  await assert.rejects(f.store.visits.update(saved.path, a, saved.revision, { draftRevision: editA }), /draft changed/);
  assert.equal(await f.vault.read(file(f, saved.path)), raw);
});
