import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function host() {
  const statuses: string[] = [], opened: string[] = [];
  let released = 0, done = 0, renders = 0, applied = 0;
  const element = () => ({
    querySelectorAll: () => [], empty() {}, addClass() {}, removeClass() {},
    setText(text: string) { statuses.push(text); }
  });
  class Modal {
    app: unknown; contentEl = element();
    constructor(app: unknown) { this.app = app; }
    close() { (this as any).onClose(); }
  }
  const module = { exports: {} as Record<string, any> };
  const source = fs.readFileSync(new URL('../src/ui/capture-refresh.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
    module, exports: module.exports,
    require(id: string) { if (id.endsWith('modal-layout')) return { markInputModal() {} };
      if (id === 'obsidian') return { Modal };
      if (id === '../ui') return { errorText: (error: unknown) => error instanceof Error ? error.message : String(error) };
      throw Error('Unexpected import ' + id);
    }
  });
  const draft = { captureId: 'capture-1', sourcePath: 'Notebook/Capture inbox/pending.md', capturedAt: '2026-10-17T12:00:00Z' };
  const plugin = {
    app: {}, beginEditing: () => () => released++,
    openFile: async (path: string) => { opened.push(path); },
    store: {
      previewCaptureRefresh: async () => preview(),
      applyCaptureRefresh: async () => { applied++; return { path: 'Notebook/Sources/Exampletown/Shop.md' }; }
    }
  };
  const modal = new module.exports.CaptureRefreshModal(plugin, draft, [], () => done++);
  modal.status = element(); modal.fieldsEl = element(); modal.targetPath = 'Notebook/Sources/Exampletown/Shop.md';
  modal.finishEditing = plugin.beginEditing(); modal.render = () => renders++;
  return { modal, plugin, draft, statuses, opened, counts: () => ({ released, done, renders, applied }) };
}
function preview(fingerprint = 'original', extra: Record<string, unknown> = {}) {
  return {
    targetPath: 'Notebook/Sources/Exampletown/Shop.md', targetName: 'Shop', captureId: 'capture-1',
    captureRevision: 'raw-revision', capturedAt: '2026-10-17T12:00:00Z', fingerprint,
    fields: [
      { key: 'address', label: 'Address', current: 'Old road', incoming: 'New road', available: true, changed: true, selected: true },
      { key: 'coordinates', label: 'Coordinates', current: [1, 2], incoming: [3, 4], available: true, changed: true, selected: false },
      { key: 'website', label: 'Website', current: 'https://example.org', incoming: null, available: false, changed: false, selected: false }
    ],
    warnings: [], blockers: [], completed: false, ...extra
  };
}

test('refresh defaults use available changes, retain explicit choices, and exclude unavailable values', () => {
  const h = host(); h.modal.accept(preview());
  assert.deepEqual(Array.from(h.modal.selectedFields()), ['address']);
  h.modal.choices.set('address', false); h.modal.choices.set('coordinates', true); h.modal.choices.set('website', true);
  h.modal.accept(preview('new'));
  assert.deepEqual(Array.from(h.modal.selectedFields()), ['coordinates']);
});

test('stale comparison requires another action and preserves choices without saving', async () => {
  const h = host(); h.modal.accept(preview()); h.modal.choices.set('coordinates', true);
  h.plugin.store.previewCaptureRefresh = async () => preview('changed');
  await h.modal.perform(() => h.modal.apply(['address', 'coordinates']));
  assert.equal(h.counts().applied, 0);
  assert.equal(h.modal.preview.fingerprint, 'changed');
  assert.deepEqual(Array.from(h.modal.selectedFields()), ['address', 'coordinates']);
  assert.ok(h.statuses.some(text => text.includes('Review the refreshed comparison')));
  await h.modal.perform(() => h.modal.apply(['address', 'coordinates']));
  assert.equal(h.counts().applied, 1);
  assert.equal(h.counts().released, 1); assert.equal(h.counts().done, 1);
  assert.deepEqual(h.opened, ['Notebook/Sources/Exampletown/Shop.md']);
});

test('closing during a pending comparison prevents a later save and releases guards exactly once', async () => {
  const h = host(); h.modal.accept(preview());
  let resume!: (value: any) => void;
  h.plugin.store.previewCaptureRefresh = () => new Promise(resolve => { resume = resolve; });
  const pending = h.modal.perform(() => h.modal.apply(['address']));
  h.modal.close();
  assert.equal(h.counts().released, 0); assert.equal(h.counts().done, 0);
  resume(preview()); await pending;
  assert.equal(h.counts().applied, 0);
  assert.equal(h.counts().released, 1); assert.equal(h.counts().done, 1);
  h.modal.onClose(); h.modal.close();
  assert.equal(h.counts().released, 1); assert.equal(h.counts().done, 1);
  assert.deepEqual(h.opened, []);
});

test('closing during saving retains organisation guard until mutation settles and prevents late note opening', async () => {
  const h = host(); h.modal.accept(preview());
  let resume!: (value: any) => void, started!: () => void;
  const saving = new Promise<void>(resolve => { started = resolve; });
  h.plugin.store.applyCaptureRefresh = () => { started(); return new Promise(resolve => { resume = resolve; }); };
  const pending = h.modal.perform(() => h.modal.apply(['address']));
  await saving;
  h.modal.close(); assert.equal(h.counts().released, 0);
  resume({ path: 'Notebook/Sources/Exampletown/Shop.md' }); await pending;
  assert.equal(h.counts().released, 1); assert.equal(h.counts().done, 1);
  assert.deepEqual(h.opened, []);
});

test('partial archive failure switches to completed receipt state and a retry never reselects fields', async () => {
  const h = host(); h.modal.accept(preview());
  let reads = 0;
  h.plugin.store.previewCaptureRefresh = async () => preview('original', { completed: ++reads > 1 });
  h.plugin.store.applyCaptureRefresh = async () => { throw Error('Archive unavailable'); };
  await h.modal.perform(() => h.modal.apply(['address']));
  assert.equal(h.modal.preview.completed, true);
  assert.ok(h.statuses.some(text => text.includes('Finish archiving')));
  assert.equal(h.modal.closed, false);
  assert.equal(h.draft.sourcePath, 'Notebook/Capture inbox/pending.md');
});

test('changed raw capture failure keeps the draft and tells the user to reopen its review', async () => {
  const h = host();
  h.plugin.store.previewCaptureRefresh = async () => { throw Error('Original capture changed'); };
  await h.modal.perform(() => h.modal.refresh());
  assert.equal(h.modal.failed, true); assert.equal(h.modal.closed, false);
  assert.ok(h.statuses.some(text => text.includes('close this review and reopen')));
  assert.equal(h.draft.captureId, 'capture-1'); assert.equal(h.counts().applied, 0);
});
