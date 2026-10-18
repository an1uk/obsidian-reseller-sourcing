import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function harness(withObserver = true) {
  class Target {
    events = new Map<string, Set<() => void>>();
    addEventListener(event: string, run: () => void) { const list = this.events.get(event) ?? new Set(); list.add(run); this.events.set(event, list); }
    removeEventListener(event: string, run: () => void) { this.events.get(event)?.delete(run); }
    emit(event: string) { for (const run of this.events.get(event) ?? []) run(); }
  }
  const timers = new Map<number, { run: () => void; delay: number }>(); let timer = 0;
  const body = { keyboardHeight: '0px' };
  const viewport = Object.assign(new Target(), { offsetTop: 0, height: 650 });
  const win = Object.assign(new Target(), { visualViewport: viewport, innerHeight: 900,
    setTimeout(run: () => void, delay: number) { timers.set(++timer, { run, delay }); return timer; },
    clearTimeout(id: number | undefined) { if (id !== undefined) timers.delete(id); },
    getComputedStyle(element: unknown) { assert.equal(element, body); return { getPropertyValue(property: string) { assert.equal(property, '--keyboard-height'); return body.keyboardHeight; } }; },
  });
  const footer = { getBoundingClientRect: () => ({ top: 560 }) };
  const scroller = Object.assign(new Target(), { scrollTop: 0, getBoundingClientRect: () => ({ top: 50, bottom: 760 }), querySelector: () => footer });
  const field = { matches: () => true, getBoundingClientRect: () => ({ top: 600 - scroller.scrollTop, bottom: 640 - scroller.scrollTop, height: 40 }) };
  const parent = Object.assign(new Target(), { isConnected: true, ownerDocument: { defaultView: win, body, activeElement: field as typeof field | null },
    closest: () => scroller, contains: (value: unknown) => value === field });
  const observers: Observer[] = [], mutations: KeyboardObserver[] = [];
  class Observer {
    disconnected = false; observed?: unknown;
    constructor(readonly callback: () => void) { observers.push(this); }
    observe(value: unknown) { this.observed = value; }
    disconnect() { this.disconnected = true; }
  }
  class KeyboardObserver {
    disconnected = false; observed?: unknown; options?: { attributes: boolean; attributeFilter: string[] };
    constructor(readonly callback: () => void) { mutations.push(this); }
    observe(value: unknown, options: { attributes: boolean; attributeFilter: string[] }) { this.observed = value; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const module = { exports: {} as Record<string, any> };
  const source = fs.readFileSync(new URL('../src/ui/visits.ts', import.meta.url), 'utf8') + '\nexport { keepVisitFieldVisible };';
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
    module, exports: module.exports, ...(withObserver ? { ResizeObserver: Observer } : {}), MutationObserver: KeyboardObserver,
    require(id: string) { return id === 'obsidian' ? { Modal: class {}, Component: class {}, Setting: class {}, Notice: class {} } : {}; },
  });
  const dispose = module.exports.keepVisitFieldVisible(parent);
  const flush = (delay?: number) => {
    const pending = [...timers].filter(([, item]) => delay === undefined || item.delay === delay).sort((a, b) => a[1].delay - b[1].delay);
    for (const [id, item] of pending) { if (!timers.delete(id)) continue; item.run(); }
  };
  return { parent, scroller, field, win, viewport, observers, mutations, body, timers, flush, dispose };
}
test('modal resizing and viewport changes reveal the focused field above the footer without repeated scrolling', () => {
  const h = harness(); assert.equal(h.observers[0]!.observed, h.scroller);
  h.observers[0]!.callback(); assert.equal(h.timers.size, 3); h.flush();
  assert.equal(h.scroller.scrollTop, 88);
  h.parent.ownerDocument.activeElement = null; h.win.emit('resize'); h.flush(); assert.equal(h.scroller.scrollTop, 88);
});
test('bounded later checks correct delayed Android native focus scrolling', () => {
  const h = harness(); h.parent.emit('focusin'); h.flush(160);
  assert.equal(h.scroller.scrollTop, 88); assert.equal(h.timers.size, 2);
  h.scroller.scrollTop = 0; h.flush(500);
  assert.equal(h.scroller.scrollTop, 88); assert.equal(h.timers.size, 1);
  h.flush(1000); assert.equal(h.scroller.scrollTop, 88); assert.equal(h.timers.size, 0);
});
test('manual pointer interaction cancels pending late checks and preserves the chosen scroll position', () => {
  const h = harness(); h.parent.emit('focusin'); h.flush(160);
  h.scroller.scrollTop = 50; h.scroller.emit('pointerdown');
  assert.equal(h.timers.size, 0); h.flush(); assert.equal(h.scroller.scrollTop, 50);
});
test('only changed keyboard-height body mutations trigger visibility checks', () => {
  const h = harness(), observer = h.mutations[0]!;
  assert.equal(observer.observed, h.body); assert.equal(observer.options?.attributes, true);
  assert.equal(JSON.stringify(observer.options?.attributeFilter), JSON.stringify(['style', 'class']));
  observer.callback(); assert.equal(h.timers.size, 0);
  h.body.keyboardHeight = '320px'; observer.callback(); assert.equal(h.timers.size, 3);
  h.flush(); assert.equal(h.scroller.scrollTop, 88);
  observer.callback(); assert.equal(h.timers.size, 0);
});
test('disposing visit fields cancels all checks, disconnects both observers and removes viewport and pointer listeners', () => {
  const h = harness(); h.parent.emit('focusin'); assert.equal(h.timers.size, 3);
  h.dispose(); h.dispose(); assert.equal(h.timers.size, 0); assert.equal(h.observers[0]!.disconnected, true); assert.equal(h.mutations[0]!.disconnected, true);
  assert.equal(h.parent.events.get('focusin')?.size, 0); assert.equal(h.win.events.get('resize')?.size, 0); assert.equal(h.viewport.events.get('resize')?.size, 0);
  assert.equal(h.scroller.events.get('pointerdown')?.size, 0);
  h.observers[0]!.callback(); h.body.keyboardHeight = '320px'; h.mutations[0]!.callback();
  assert.equal(h.timers.size, 0); h.flush(); assert.equal(h.scroller.scrollTop, 0);
});
test('keyboard visibility protection works without ResizeObserver and ignores detached forms', () => {
  const h = harness(false); h.viewport.emit('resize'); h.flush(); assert.equal(h.scroller.scrollTop, 88);
  h.parent.isConnected = false; h.scroller.scrollTop = 0; h.parent.emit('focusin'); h.flush(); assert.equal(h.scroller.scrollTop, 0); h.dispose();
});