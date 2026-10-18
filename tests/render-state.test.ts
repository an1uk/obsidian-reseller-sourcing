import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function harness() {
  const document: any = { activeElement: undefined, body: undefined, defaultView: { Event: class { realm = 'owner'; constructor(public type: string) {} } } };
  class Element {
    instanceOf(type: unknown) { return type === Element || type === Input && this.tagName === 'INPUT' || type === TextArea && this.tagName === 'TEXTAREA'; }
    tagName = 'DIV'; textContent = ''; children: Element[] = []; parent?: Element; isConnected = true; scrollTop = 0; open = false;
    attributes: Record<string, string> = {}; ownerDocument = document; events: string[] = []; eventRealms: string[] = []; focusCalls = 0; selectionStart: number | null = null; selectionEnd: number | null = null;
    closest(selector: string): Element | null { if (selector === '.workspace-leaf') return pane; return scroller; }
    contains(value: Element): boolean { return all(this).includes(value); }
    append<T extends Element>(value: T): T { value.parent = this; this.children.push(value); return value; }
    querySelectorAll(selector: string) { const tags = selector.split(',').map(value => value.toUpperCase()); return all(this).slice(1).filter(value => tags.includes(value.tagName)); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    getAttribute(key: string) { return this.attributes[key] ?? null; }
    focus() { this.focusCalls++; document.activeElement = this; }
    dispatchEvent(event: any) { this.events.push(event.type); this.eventRealms.push(event.realm ?? 'global'); }
    setSelectionRange(start: number | null, end: number | null) { this.selectionStart = start; this.selectionEnd = end; }
  }
  class Input extends Element { tagName = 'INPUT'; value = ''; type = 'text'; }
  class TextArea extends Element { tagName = 'TEXTAREA'; value = ''; }
  const pane = new Element(), scroller = new Element(), container = new Element(), body = new Element();
  document.body = body; document.activeElement = body;
  const module = { exports: {} as Record<string, any> };
  const code = transformSync(fs.readFileSync(new URL('../src/ui/render-state.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Map, WeakMap, Array, HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: TextArea, Event: class { constructor(public type: string) {} } });
  return { api: module.exports, pane, scroller, container, document, element: (tag = 'BUTTON', label = '') => { const value = new Element(); value.tagName = tag; value.textContent = label; return value; }, input: (type = 'search', value = '', key = 'search') => { const input = new Input(); input.type = type; input.value = value; input.attributes['data-charity-focus'] = key; return input; }, textarea: (value: string) => { const input = new TextArea(); input.value = value; input.attributes['data-charity-focus'] = 'personal-notes'; return input; } };
}
function all(el: any): any[] { return [el, ...el.children.flatMap(all)]; }

test('background redraw restores section expansion, search text and scroll without writing ordinary form fields', () => {
  const h = harness(), search = h.container.append(h.input('search', 'coats')), prose = h.container.append(h.textarea('Old personal text')), count = h.container.append(h.input('number', '2', 'items'));
  const section = h.container.append(h.element('DETAILS')); section.open = true; section.attributes['data-charity-section'] = 'browse'; h.scroller.scrollTop = 240;
  const restore = h.api.rememberRenderState(h.container, 'Book/Home.md');
  h.container.children = []; const currentSearch = h.container.append(h.input('search', '')), currentProse = h.container.append(h.textarea('Concurrent personal text')), currentCount = h.container.append(h.input('number', '9', 'items'));
  const currentSection = h.container.append(h.element('DETAILS')); currentSection.attributes['data-charity-section'] = 'browse'; h.scroller.scrollTop = 0;
  restore();
  assert.equal(currentSearch.value, 'coats'); assert.deepEqual(currentSearch.events, ['input']); assert.equal(currentSection.open, true); assert.equal(h.scroller.scrollTop, 240);
  assert.equal(currentProse.value, 'Concurrent personal text'); assert.equal(currentCount.value, '9'); assert.equal(prose.value, 'Old personal text'); assert.equal(count.value, '2'); assert.equal(search.focusCalls, 0);
  assert.deepEqual(currentSearch.eventRealms, ['owner']);
});

test('pop-out inputs narrow through Obsidian instanceOf and use events from their owner window', () => {
  const h = harness(), foreign: any = h.element('INPUT'); foreign.type = 'search'; foreign.value = 'wool coats'; foreign.attributes['data-charity-focus'] = 'popout-search';
  h.container.append(foreign); const restore = h.api.rememberRenderState(h.container, 'Book/Places.md');
  h.container.children = []; const replacement: any = h.element('INPUT'); replacement.type = 'search'; replacement.value = ''; replacement.attributes['data-charity-focus'] = 'popout-search';
  h.container.append(replacement); restore(); assert.equal(replacement.value, 'wool coats'); assert.deepEqual(replacement.eventRealms, ['owner']);
});
test('restoration never copies a prior search value into a replacement source text field sharing a key', () => {
  const h = harness(); h.container.append(h.input('search', 'discarded query', 'shared-key'));
  const restore = h.api.rememberRenderState(h.container, 'Book/Sources.md');
  h.container.children = []; const sourceText = h.container.append(h.input('text', 'New source takeaway', 'shared-key')); restore();
  assert.equal(sourceText.value, 'New source takeaway'); assert.deepEqual(sourceText.events, []);
});
test('a focused search regains its caret on redraw when focus was lost to the document body', () => {
  const h = harness(), old = h.container.append(h.input('search', 'cashmere coats')); old.selectionStart = 4; old.selectionEnd = 8; h.document.activeElement = old;
  const restore = h.api.rememberRenderState(h.container, 'Book/Visits.md');
  h.container.children = []; old.isConnected = false; const current = h.container.append(h.input('search', '')); h.document.activeElement = h.document.body;
  restore(); assert.equal(h.document.activeElement, current); assert.equal(current.value, 'cashmere coats'); assert.equal(current.selectionStart, 4); assert.equal(current.selectionEnd, 8);
});
test('redraw does not steal focus from a different control selected while asynchronous work was pending', () => {
  const h = harness(), old = h.container.append(h.input('search', 'coats')); h.document.activeElement = old;
  const restore = h.api.rememberRenderState(h.container, 'Book/Visits.md'); h.container.children = []; const current = h.container.append(h.input('search', ''));
  const elsewhere = h.element('BUTTON', 'Another pane'); h.document.activeElement = elsewhere; restore();
  assert.equal(h.document.activeElement, elsewhere); assert.equal(current.focusCalls, 0);
});
test('disconnected render targets do not restore state or focus', () => {
  const h = harness(), old = h.container.append(h.input('search', 'coats')); h.document.activeElement = old;
  const restore = h.api.rememberRenderState(h.container, 'Book/Visits.md'); h.container.isConnected = false; restore();
  assert.equal(old.focusCalls, 0); assert.deepEqual(old.events, []);
});
test('real and example note keys keep their transient state separate within a pane', () => {
  const h = harness(); h.container.append(h.input('search', 'real only')); h.api.rememberRenderState(h.container, 'Book/Visits.md');
  h.container.children = []; const restoreExamples = h.api.rememberRenderState(h.container, 'Book/Examples/Visits.md'); const exampleSearch = h.container.append(h.input('search', 'fictional')); restoreExamples(); assert.equal(exampleSearch.value, 'fictional');
  h.container.children = []; const restoreReal = h.api.rememberRenderState(h.container, 'Book/Visits.md'); const realSearch = h.container.append(h.input('search', '')); restoreReal(); assert.equal(realSearch.value, 'real only');
});
