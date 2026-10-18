import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import type { NotebookContext } from '../src/notebook-context';
import type { VisitInput } from '../src/types';
import { inspectHome } from '../src/home/overview';
import { fixture, newDraft } from './storage-fixtures';
import { readNote, updateNoteProperty } from '../src/storage/markdown';
import { SourcingStore } from '../src/storage/store';

const input = (extra: Partial<VisitInput> = {}): VisitInput => ({ observations: 'Check the seams before celebrating.', finds: '', nextTime: '', visitDate: '2026-10-18', updateLastVisited: false, ...extra });
async function ready() {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft(), area.path, 'Source');
  const context = { kind: 'real', root: f.store.root, app: f.app, store: f.store } as NotebookContext;
  return { ...f, source, context };
}
const file = (f: Awaited<ReturnType<typeof ready>>, path: string) => f.vault.getAbstractFileByPath(path) as TFile;
const bytes = (f: Awaited<ReturnType<typeof ready>>) => new Map([...f.vault.entries].map(([path, value]) => [path, value.text]));
async function outing(f: Awaited<ReturnType<typeof ready>>, name = 'Afternoon browse') {
  return f.store.outings.create({ name, groups: [{ id: 'group-' + name, parkingPath: '', stops: [{ id: 'stop-' + name, sourcePath: f.source.path, status: 'pending' }] }] });
}
async function savedDraft(f: Awaited<ReturnType<typeof ready>>, date: string) {
  await f.store.visits.saveDraft(f.source.path, input());
  const path = f.vault.getFiles().find(file => file.path.includes('/Visit drafts/'))!.path;
  await f.vault.process(file(f, path), raw => { const data = JSON.parse(raw); data.updatedAt = date; return JSON.stringify(data); });
  return path;
}
test('empty and populated Home are read-only and distinguish a failed source read', async () => {
  const f = await ready(), before = bytes(f), home = await inspectHome(f.context);
  assert.equal(home.sources.length, 1); assert.equal(home.sourcesAvailable, true); assert.equal(home.primary, undefined); assert.deepEqual(bytes(f), before);
  f.store.listPlaces = async () => { throw Error('Storage unavailable'); };
  const failed = await inspectHome(f.context);
  assert.equal(failed.sourcesAvailable, false); assert.match(failed.warnings.map(warning => warning.message).join('\n'), /Storage unavailable/);
  const empty = fixture(); await empty.store.setup();
  assert.equal((await inspectHome({ kind: 'real', root: empty.store.root, app: empty.app, store: empty.store } as NotebookContext)).sources.length, 0);
});
test('most recently saved unfinished visit precedes an active outing with stable identities', async () => {
  const f = await ready(), o = await outing(f); await f.store.outings.start(o.path);
  const draftPath = await savedDraft(f, '2026-10-18T10:00:00Z'), before = bytes(f);
  const home = await inspectHome(f.context);
  assert.equal(home.primary?.kind, 'visit-draft'); assert.equal(home.primary?.path, draftPath); assert.equal(home.primary?.sourceName, 'Fixture Charity');
  assert.equal(home.primary?.updatedAt, '2026-10-18T10:00:00Z'); assert.match(home.primary!.revision, /^[a-f0-9]{64}$/);
  assert.equal(home.others[0]?.kind, 'active-outing'); assert.deepEqual(bytes(f), before);
});
test('standalone and outing drafts share newest-first ordering without auto-resuming', async () => {
  const f = await ready(), o = await outing(f), draftPath = await savedDraft(f, '2026-10-18T08:00:00Z');
  await f.store.outings.saveDraft(o.path, o.groups[0]!.stops[0]!.id, input());
  await f.vault.process(file(f, o.path), raw => {
    const data = readNote(raw).properties.outing as any; data.draft.updatedAt = '2026-10-18T09:00:00Z'; return updateNoteProperty(raw, 'outing', data);
  });
  const before = bytes(f), home = await inspectHome(f.context);
  assert.equal(home.primary?.kind, 'outing-draft'); assert.equal(home.primary?.outingPath, o.path);
  assert.equal(home.others[0]?.path, draftPath); assert.deepEqual(bytes(f), before);
});
test('interrupted saves precede newer drafts and remain unapplied during inspection', async () => {
  const f = await ready(), create = f.vault.create.bind(f.vault); let blocked = true;
  f.vault.create = async (path, raw) => { if (blocked && path.includes('/Visits/')) { blocked = false; throw Error('Interrupted'); } return create(path, raw); };
  await assert.rejects(f.store.visits.create(f.source.path, input(), { operationId: 'interrupted', recordedAt: '2026-10-17T10:00:00Z' }), /Interrupted/);
  await savedDraft(f, '2026-10-18T10:00:00Z');
  const before = bytes(f), home = await inspectHome(f.context);
  assert.equal(home.primary?.kind, 'visit-operation'); assert.equal(home.primary?.operationId, 'interrupted');
  assert.equal(home.others[0]?.kind, 'visit-draft'); assert.deepEqual(bytes(f), before);
});
test('linked outing save and journal produce one actionable interrupted-save item', async () => {
  const f = await ready(), o = await outing(f), create = f.vault.create.bind(f.vault); let blocked = true;
  f.vault.create = async (path, raw) => { if (blocked && path.includes('/Visits/')) { blocked = false; throw Error('Interrupted'); } return create(path, raw); };
  await assert.rejects(f.store.outings.recordVisit(o.path, o.groups[0]!.stops[0]!.id, input(), { operationId: 'outing-interrupted' }), /Interrupted/);
  const before = bytes(f), home = await inspectHome(f.context);
  assert.equal(home.primary?.kind, 'outing-operation'); assert.equal(home.primary?.operationId, 'outing-interrupted');
  assert.equal(home.others.filter(item => item.operationId === 'outing-interrupted').length, 0); assert.deepEqual(bytes(f), before);
});
test('one malformed draft or outing does not suppress other saved work and warnings retain paths', async () => {
  const f = await ready(), draftPath = await savedDraft(f, '2026-10-18T08:00:00Z'), o = await outing(f);
  const badDraft = f.store.root + '/System/Visit drafts/broken.json'; await f.vault.create(badDraft, '{');
  await f.vault.process(file(f, o.path), raw => updateNoteProperty(raw, 'outing', { schema: 1, id: 'bad' }));
  const before = bytes(f), home = await inspectHome(f.context);
  assert.equal(home.primary?.path, draftPath); assert.ok(home.warnings.some(warning => warning.path === badDraft));
  assert.ok(home.warnings.some(warning => warning.path === o.path)); assert.deepEqual(bytes(f), before);
});
test('draft inspection preserves incomplete form values but rejects source replacement and cleared drafts', async () => {
  const f = await ready(); await f.store.visits.saveDraft(f.source.path, input({ visitDate: '' }));
  const first = await f.store.visits.inspectSavedWork(); assert.equal(first.drafts.length, 1);
  await f.vault.process(f.source, raw => updateNoteProperty(raw, 'source_capture_id', 'replacement'));
  const replaced = await f.store.visits.inspectSavedWork();
  assert.equal(replaced.drafts.length, 0); assert.match(replaced.warnings[0]!.message, /identity changed/);
  const path = first.drafts[0]!.path;
  await f.vault.process(file(f, path), raw => { const data = JSON.parse(raw); data.cleared = true; return JSON.stringify(data); });
  assert.deepEqual(await f.store.visits.inspectSavedWork(), { drafts: [], operations: [], warnings: [] });
});
test('existing-visit draft requires the original visit identity and revision', async () => {
  const f = await ready(), visit = await f.store.visits.create(f.source.path, input());
  await f.store.visits.saveDraft(f.source.path, input({ observations: 'Draft edit' }), visit.path, '', visit.revision);
  assert.equal((await f.store.visits.inspectSavedWork()).drafts[0]?.visitRevision, visit.revision);
  await f.vault.process(file(f, visit.path), raw => raw + 'Concurrent personal note.\n');
  const inspected = await f.store.visits.inspectSavedWork();
  assert.equal(inspected.drafts.length, 0); assert.match(inspected.warnings[0]!.message, /saved visit changed/);
  assert.match(await f.vault.read(file(f, visit.path)), /Concurrent personal note/);
});
test('duplicate or outside-context drafts are review messages rather than ambiguous resume actions', async () => {
  const f = await ready(), path = await savedDraft(f, '2026-10-18T08:00:00Z');
  await f.vault.create(path.replace(/\.json$/, '-copy.json'), await f.vault.read(file(f, path)));
  let inspected = await f.store.visits.inspectSavedWork();
  assert.equal(inspected.drafts.length, 0); assert.equal(inspected.warnings.length, 2);
  for (const draft of f.vault.getFiles().filter(file => file.path.includes('/Visit drafts/'))) {
    await f.vault.process(draft, raw => { const data = JSON.parse(raw); data.sourcePath = 'Another notebook/Sources/Source.md'; return JSON.stringify(data); });
  }
  inspected = await f.store.visits.inspectSavedWork(); assert.equal(inspected.drafts.length, 0); assert.match(inspected.warnings[0]!.message, /outside this notebook/);
});
test('real and example contexts never offer each other sources or unfinished drafts', async () => {
  const f = await ready(), practiceSettings = { ...structuredClone(f.settings), root: f.store.root + '/Examples', assets: {} };
  const practice = new SourcingStore(f.app, practiceSettings, async () => {}, { mode: 'examples' });
  const area = await practice.ensureLocality('Fictionalton');
  const p = await practice.saveCapture(newDraft('practice-source'), area.path, 'Fictional source');
  await practice.visits.saveDraft(p.path, input());
  const context = { kind: 'examples', root: practice.root, app: f.app, store: practice } as NotebookContext;
  const [real, examples] = await Promise.all([inspectHome(f.context), inspectHome(context)]);
  assert.equal(real.sources.length, 1); assert.equal(real.primary, undefined);
  assert.equal(examples.sources.length, 1); assert.equal(examples.primary?.sourcePath, p.path);
});
test('tampered interrupted operations are isolated as warnings and never offered for resume', async () => {
  const f = await ready(), create = f.vault.create.bind(f.vault); let blocked = true;
  f.vault.create = async (path, raw) => { if (blocked && path.includes('/Visits/')) { blocked = false; throw Error('Interrupted'); } return create(path, raw); };
  await assert.rejects(f.store.visits.create(f.source.path, input(), { operationId: 'tampered' }), /Interrupted/);
  const path = f.store.root + '/System/Visit operations/tampered.json';
  await f.vault.process(file(f, path), raw => { const data = JSON.parse(raw); data.input.observations = 'Tampered'; return JSON.stringify(data); });
  const before = bytes(f), home = await inspectHome(f.context);
  assert.equal(home.primary, undefined); assert.ok(home.warnings.some(warning => warning.path === path && /fingerprint/.test(warning.message))); assert.deepEqual(bytes(f), before);
});test('draft ordering compares instants when saved dates carry different timezone offsets', async () => {
  const f = await ready(), o = await outing(f); await savedDraft(f, '2026-10-18T09:30:00Z');
  await f.store.outings.saveDraft(o.path, o.groups[0]!.stops[0]!.id, input());
  await f.vault.process(file(f, o.path), raw => {
    const data = readNote(raw).properties.outing as any; data.draft.updatedAt = '2026-10-18T10:00:00+01:00'; return updateNoteProperty(raw, 'outing', data);
  });
  const home = await inspectHome(f.context);
  assert.equal(home.primary?.kind, 'visit-draft'); assert.equal(home.others[0]?.kind, 'outing-draft');
});
