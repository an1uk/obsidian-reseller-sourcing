import * as guards from '../src/domain/guards';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function harness(paths: string[]) {
  class Element {
    instanceOf(type: unknown) { return type === Element; }
    nodeType = 1; isConnected = true; visible = true;
    listeners = new Map<string, Set<(event: any) => void>>();
    ownerDocument: { activeElement: unknown } = { activeElement: undefined };
    querySelector() { return undefined; }
    contains(value: unknown) { return value === this; }
    getClientRects() { return this.visible ? [{}] : []; }
    addEventListener(event: string, run: (event: any) => void) { const values = this.listeners.get(event) ?? new Set(); values.add(run); this.listeners.set(event, values); }
    removeEventListener(event: string, run: (event: any) => void) { this.listeners.get(event)?.delete(run); }
    emit(event: string, value: any = {}) { for (const run of this.listeners.get(event) ?? []) run(value); }
  }
  class MarkdownView {
    file: { path: string }; contentEl = new Element(); heading = new Element(); native = new Element();
    calls: [boolean, boolean | undefined][] = [];
    metadataEditor: { containerEl: Element; headingEl: Element; collapsed: boolean; setCollapse: (collapsed: boolean, persist?: boolean) => void };
    constructor(path: string) {
      this.file = { path }; this.contentEl.contains = element => element === this.native;
      this.native.contains = element => element === this.native || element === this.heading;
      this.metadataEditor = { containerEl: this.native, headingEl: this.heading, collapsed: false,
        setCollapse: (collapsed, persist) => { this.calls.push([collapsed, persist]); this.metadataEditor.collapsed = collapsed; } };
    }
  }
  const views = paths.map(path => new MarkdownView(path)), events = new Map<string, () => void>(), timers = new Map<number, () => void>();
  let timer = 0, disposed: (() => void) | undefined, writes = 0;
  const workspace = {
    getLeavesOfType(type: string) { assert.equal(type, 'markdown'); return views.map(view => ({ view })); },
    on(event: string, run: () => void) { events.set(event, run); return {}; },
    onLayoutReady(run: () => void) { run(); },
  };
  const plugin = {
    app: { workspace, vault: { process() { writes++; throw Error('Unexpected note write'); }, modify() { writes++; throw Error('Unexpected note write'); } } },
    contextRootForPath(path: string) { return path.startsWith('Notebook/Examples/') ? 'Notebook/Examples' : path.startsWith('Notebook/') ? 'Notebook' : undefined; },
    registerEvent() {}, register(run: () => void) { disposed = run; },
  };
  const module = { exports: {} as Record<string, any> };
  const source = fs.readFileSync(new URL('../src/ui/properties.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
    module, exports: module.exports, HTMLElement: Element, require(id: string) { return id.endsWith('domain/guards') ? guards : { MarkdownView }; },
    window: { setTimeout(run: () => void) { timers.set(++timer, run); return timer; }, clearTimeout(id: number) { timers.delete(id); } },
  });
  module.exports.registerPlacePropertiesDefault(plugin);
  const flush = () => { const pending = [...timers.values()]; timers.clear(); for (const run of pending) run(); };
  return { views, flush, emit(event: string) { events.get(event)?.(); }, dispose() { disposed?.(); }, timers, writes: () => writes };
}

test('only exact real and example Home paths receive the native collapsed default without persistence', () => {
  const h = harness(['Notebook/Home.md', 'Notebook/Examples/Home.md', 'Notebook/Areas/Home.md', 'Personal/Home.md', 'Notebook/Home.md.backup']);
  h.flush();
  assert.deepEqual(h.views.map(view => view.calls.length), [1, 1, 0, 0, 0]);
  assert.deepEqual(h.views[0]!.calls, [[true, false]]); assert.deepEqual(h.views[1]!.calls, [[true, false]]);
  assert.equal(h.writes(), 0);
});
test('user expansion persists across repeated Home layout and active-leaf refreshes', () => {
  const h = harness(['Notebook/Home.md']); h.flush();
  const view = h.views[0]!; view.heading.emit('click'); view.metadataEditor.collapsed = false;
  for (const event of ['file-open', 'layout-change', 'active-leaf-change']) { h.emit(event); h.flush(); }
  assert.equal(view.metadataEditor.collapsed, false); assert.equal(view.calls.length, 1); assert.equal(h.writes(), 0);
});
test('focused native Home properties take priority over the deferred default', () => {
  const h = harness(['Notebook/Home.md']), view = h.views[0]!;
  view.native.ownerDocument.activeElement = view.heading; h.flush();
  assert.equal(view.calls.length, 0);
  view.native.ownerDocument.activeElement = undefined; h.emit('layout-change'); h.flush();
  assert.equal(view.calls.length, 0); assert.equal(h.writes(), 0);
});
test('returning to Home in the same pane applies once for the new file opening and disposal removes listeners', () => {
  const h = harness(['Notebook/Home.md']); h.flush(); const view = h.views[0]!;
  assert.ok(view.heading.listeners.get('click')?.size);
  view.file.path = 'Notebook/Guide.md'; h.emit('file-open'); h.flush();
  assert.equal(view.heading.listeners.get('click')?.size, 0);
  view.file.path = 'Notebook/Home.md'; view.metadataEditor.collapsed = false; h.emit('file-open'); h.flush();
  assert.equal(view.calls.length, 2);
  h.emit('layout-change'); assert.ok(h.timers.size); h.dispose(); h.flush();
  assert.equal(h.timers.size, 0); assert.equal(view.heading.listeners.get('click')?.size, 0); assert.equal(h.writes(), 0);
});