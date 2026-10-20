import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { fixture, newDraft } from './storage-fixtures';
import type { PreparationDraft } from '../src/workspace/types';
import { placeEditPatch, type PlaceEditPreparation } from '../src/place-edit/model';

test('closing a reverted edit persists the reversion instead of reviving an older draft on reopen', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: 'Exampletown', locality: '' }, 'Source');
  const snapshot = await f.store.placeEditSnapshot(source.path);
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit', root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '', data: { snapshot, values: { ...snapshot.values, displayName: 'An earlier choice' }, section: 'basics' } };
  const saved = await f.store.preparations.save(draft, '');
  const window = { clearTimeout, setTimeout };
  const element = () => ({ win: window, ownerDocument: { removeEventListener() {} }, inert: false, setAttribute() {}, empty() {} });
  class Modal { contentEl = element(); modalEl = element(); constructor(_app: unknown) {} close() { (this as any).onClose(); } }
  class Component { load() {} unload() {} }
  const module = { exports: {} as Record<string, any> };
  const sourceCode = fs.readFileSync(new URL('../src/workspace/preparation-modal.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(sourceCode, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, { module, exports: module.exports, crypto, structuredClone, require(id: string) {
    if (id === 'obsidian') return { Modal, Component, Notice: class {} };
    if (id === '../ui') return { errorText: String };
    if (id.endsWith('modal-layout')) return { markInputModal() {} };
    throw Error('Unexpected import ' + id);
  } });
  const Base = module.exports.PreparationModal;
  class DraftModal extends Base { constructor(...args: any[]) { super(...args); } meaningful() { return JSON.stringify(this.draft.data.values) !== JSON.stringify(this.draft.data.snapshot.values); } }
  const modal = new DraftModal({ app: f.app, store: f.store, root: f.store.root }, 'place-edit', saved.data);
  modal.draft = structuredClone(saved); modal.signature = JSON.stringify(saved.data);
  modal.draft.data.values = structuredClone(snapshot.values);
  assert.equal(modal.meaningful(), false);
  modal.close();
  for (let i = 0; i < 30 && !modal.closed; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(modal.closed, true);
  const reopened = await f.store.preparations.get(saved.id);
  assert.equal(reopened?.kind, 'place-edit'); if (reopened?.kind !== 'place-edit') throw Error('Edit draft missing');
  assert.deepEqual(reopened.data.values, snapshot.values); assert.notEqual(reopened.revision, saved.revision);
});

test('a fresh editor flushes its draft before comparison failure so recovery is immediately available', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: 'Exampletown', locality: '' }, 'Source');
  const snapshot = await f.store.placeEditSnapshot(source.path), seed = { snapshot, values: { ...snapshot.values, displayName: 'An unsaved choice' }, section: 'basics' };
  const calls: string[] = [];
  class Base {
    context: any; draft: any; busy = false; contentEl = { querySelector: () => null };
    constructor(context: unknown, _kind: unknown, data: unknown) { this.context = context; this.draft = { data, id: 'edit-first-save', phase: 'editing', revision: '' }; }
    setBusy(value: boolean) { this.busy = value; }
    async flush() { calls.push('flush'); this.draft.revision = 'saved-revision'; }
    failure() { calls.push('failed'); }
  }
  const module = { exports: {} as Record<string, any> };
  const sourceCode = fs.readFileSync(new URL('../src/place-edit/editor.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(sourceCode, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, { module, exports: module.exports, require(id: string) {
    if (id === 'obsidian') return {};
    if (id === '../ui' || id === '../map') return {};
    if (id.endsWith('preparation-modal')) return { PreparationModal: Base };
    if (id === './model') return { placeEditPatch };
    throw Error('Unexpected import ' + id);
  } });
  const Modal = module.exports.PlaceEditorModal;
  const modal = new Modal({ store: { async validatePlaceEdit() { calls.push('compare'); throw Error('A concurrent edit needs review'); } } }, seed);
  await modal.finish();
  assert.deepEqual(calls, ['flush', 'compare', 'failed']); assert.equal(modal.draft.revision, 'saved-revision'); assert.equal(modal.draft.data.values.displayName, 'An unsaved choice'); assert.equal(modal.busy, false);
});

async function handoffFixture() {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: 'Exampletown', locality: '' }, 'Source');
  const snapshot = await f.store.placeEditSnapshot(source.path);
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit', root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '', data: { snapshot, values: { ...snapshot.values, openingNotes: 'Keep this unsaved edit during the handoff' }, section: 'location' } };
  const element = () => ({ win: { clearTimeout, setTimeout }, ownerDocument: { removeEventListener() {} }, inert: false, setAttribute() {}, empty() {} });
  class Modal { contentEl = element(); modalEl = element(); constructor(_app: unknown) {} close() { (this as any).onClose(); } }
  class Component { load() {} unload() {} }
  const module = { exports: {} as Record<string, any> };
  vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/workspace/preparation-modal.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code, { module, exports: module.exports, crypto, structuredClone, require(id: string) {
    if (id === 'obsidian') return { Modal, Component, Notice: class {} };
    if (id === '../ui') return { errorText: String };
    if (id.endsWith('modal-layout')) return { markInputModal() {} };
    throw Error('Unexpected import ' + id);
  } });
  const failures: unknown[] = [], Base = module.exports.PreparationModal;
  class DraftModal extends Base { constructor(...args: any[]) { super(...args); } meaningful() { return true; } failure(error: unknown) { failures.push(error); } }
  const modal = new DraftModal({ app: f.app, store: f.store, root: f.store.root }, 'place-edit', draft.data);
  modal.draft = draft;
  let leases = 1, releases = 0;
  modal.finishEditing = () => { leases--; releases++; };
  return { ...f, modal, draft, failures, leases: () => leases, releases: () => releases };
}
test('area and parking handoffs preserve the edit draft and release the parent lease before continuation', async () => {
  for (const action of ['area', 'parking']) {
    const f = await handoffFixture(); let continued = 0;
    await f.modal.closeAndContinue(async () => {
      continued++; assert.equal(f.leases(), 0, action); assert.equal(f.modal.closed, true);
      const saved = await f.store.preparations.get(f.draft.id);
      assert.equal(saved?.kind, 'place-edit'); if (saved?.kind !== 'place-edit') throw Error('Edit draft missing');
      assert.equal(saved.data.values.openingNotes, 'Keep this unsaved edit during the handoff');
    });
    f.modal.onClose(); await f.modal.closeAndContinue(() => { continued++; });
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(continued, 1); assert.equal(f.releases(), 1); assert.deepEqual(f.failures, []);
  }
});
test('a failed draft flush leaves the parent form open and never launches the handoff', async () => {
  const f = await handoffFixture(); let continued = 0;
  f.store.preparations.save = async () => { throw Error('Draft storage unavailable'); };
  await f.modal.closeAndContinue(() => { continued++; });
  assert.equal(continued, 0); assert.equal(f.modal.closed, false); assert.equal(f.modal.busy, false);
  assert.equal(f.leases(), 1); assert.equal(f.releases(), 0); assert.equal(f.failures.length, 1);
  assert.equal(f.modal.draft.data.values.openingNotes, 'Keep this unsaved edit during the handoff');
});
