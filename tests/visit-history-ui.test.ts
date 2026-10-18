import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { visitPeriodRange, isVisitDateInRange } from '../src/visits/periods';

function harness() {
  class Element {
    children: Element[] = []; parent?: Element; tag = 'div'; textContent = ''; value = ''; type = ''; cls = ''; hidden = false; open = false; isConnected = true;
    attributes: Record<string, string> = {}; onclick?: () => unknown; onchange?: () => unknown; oninput?: () => unknown;
    events: Record<string, (() => void)[]> = {};
    createEl(tag: string, options: any = {}) { const el = new Element(); Object.assign(el, { tag, parent: this, textContent: options.text ?? '', value: options.value ?? '', type: options.type ?? '', cls: options.cls ?? '', attributes: options.attr ?? {} }); this.children.push(el); return el; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    createSpan(options: any = {}) { return this.createEl('span', options); }
    addClass(...names: string[]) { this.cls += ' ' + names.join(' '); }
    toggleClass(name: string, value: boolean) { this.cls = this.cls.split(' ').filter(part => part !== name).concat(value ? [name] : []).join(' '); }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    toggle(value: boolean) { this.hidden = !value; }
    appendChild(el: Element) { if (el.parent) el.parent.children = el.parent.children.filter(child => child !== el); el.parent = this; this.children.push(el); }
    empty() { for (const child of all(this).slice(1)) child.isConnected = false; this.children = []; }
    addEventListener(event: string, callback: () => void) { (this.events[event] ??= []).push(callback); }
    closest() { return this; }
  }
  const row = (id: string, date: string, path: string, sourcePath = 'Book/Examples/Sources/One.md') => ({ schema: 1, id, visitDate: date, path, sourcePath, recordedAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z', observations: 'Observed ' + id, finds: '', nextTime: '', revision: 'r' });
  const visits = [
    row('older', '2026-09-30', 'Book/Examples/Visits/old-flat-id.md'),
    { ...row('sunday', '2026-10-18', 'Book/Examples/Visits/2026/10/random-id.md'), itemsPurchased: 0 },
    row('monday', '2026-10-12', 'Book/Examples/Visits/2026/10/uuid.md', 'Book/Examples/Sources/Two.md'),
    row('previous', '2026-10-11', 'Book/Examples/Visits/legacy-flat.md'),
  ];
  const places = [{ kind: 'shop', path: 'Book/Examples/Sources/One.md', name: 'Second Sunrise' }, { kind: 'shop', path: 'Book/Examples/Sources/Two.md', name: 'Label Fable' }];
  const calls = { insights: 0, opened: [] as string[], edits: [] as string[] };
  let waiting: Promise<void> | undefined;
  const context: any = { kind: 'examples', openFile: async (path: string) => { calls.opened.push(path); }, store: { listPlaces: async () => { if (waiting) await waiting; return places; }, visits: { inspect: async () => ({ visits, warnings: ['Malformed legacy visit stays available for manual review.'] }) } } };
  const module = { exports: {} as Record<string, any> };
  const code = transformSync(fs.readFileSync(new URL('../src/ui/visit-history.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Map, WeakMap, Date, Promise, Error,
    require(id: string) {
      if (id === '../storage/markdown') return { localDate: () => '2026-10-18' };
      if (id === '../visits/periods') return { visitPeriodRange, isVisitDateInRange };
      if (id === '../ui') return { button: (el: Element, text: string, run: () => unknown) => { const button = el.createEl('button', { text }); button.onclick = run; return button; }, details: (el: Element, text: string) => { const value = el.createEl('details'); value.createEl('summary', { text }); return value; }, errorText: (error: any) => error.message, renderContextBanner: () => {} };
      if (id === './visits') return { StructuredVisitModal: class { constructor(_context: unknown, source: string, visit: string) { calls.edits.push(source + ':' + visit); } open() {} }, visitSummary: (visit: any) => visit.itemsPurchased === 0 ? '0 items purchased' : 'Purchase count unknown', renderVisitRecordDetails: (el: Element, visit: any) => el.createEl('p', { text: visit.observations }) };
      if (id === './visit-insights') return { renderVisitInsights: async (_context: unknown, _owner: unknown, el: Element) => { calls.insights++; el.createEl('p', { text: 'Statistical comparisons' }); } };
      throw Error('Unexpected module ' + id);
    },
  });
  return { api: module.exports, context, calls, visits, element: () => new Element(), defer: (value: Promise<void>) => { waiting = value; } };
}
function all(el: any): any[] { return [el, ...el.children.flatMap(all)]; }
function text(el: any) { return all(el).map(value => value.textContent).join('\n'); }
function button(el: any, label: string) { const value = all(el).find(value => value.tag === 'button' && value.textContent === label); assert.ok(value, label); return value; }

test('history is the default and lists both flat and nested visits newest first using source labels', async () => {
  const h = harness(), el = h.element(), before = structuredClone(h.visits);
  await h.api.renderVisitsHub(h.context, {}, el, {});
  const headings = all(el).filter(value => value.tag === 'h4').map(value => value.textContent);
  assert.deepEqual(headings, ['2026-10-18 · Second Sunrise', '2026-10-12 · Label Fable', '2026-10-11 · Second Sunrise', '2026-09-30 · Second Sunrise']);
  assert.match(text(el), /0 items purchased/); assert.doesNotMatch(text(el), /random-id|uuid|Statistical comparisons/);
  assert.equal(h.calls.insights, 0); assert.deepEqual(h.visits, before); assert.match(text(el), /Malformed legacy visit/);
});
test('weekly periods and search filter visits without replacing the search control', async () => {
  const h = harness(), el = h.element(), state: any = {};
  await h.api.renderVisitsHub(h.context, {}, el, state);
  button(el, 'This week').onclick(); assert.equal(all(el).filter(value => value.tag === 'article').length, 2);
  const search = all(el).find(value => value.attributes['aria-label'] === 'Search visit history');
  search.value = 'fable'; search.oninput(); assert.equal(all(el).filter(value => value.tag === 'article').length, 1); assert.ok(all(el).includes(search));
  button(el, 'Previous week').onclick(); assert.equal(all(el).filter(value => value.tag === 'article').length, 0);
  search.value = ''; search.oninput(); assert.match(text(el), /2026-10-11 · Second Sunrise/);
  assert.equal(state.period, 'previous-week'); assert.equal(state.query, '');
});
test('custom ranges retain entered invalid values, then recover without losing other filters', async () => {
  const h = harness(), el = h.element(), state: any = { period: 'custom', from: '2026-10-20', to: '2026-10-01', query: 'Sunrise' };
  await h.api.renderVisitsHub(h.context, {}, el, state); assert.match(text(el), /end date/);
  const from = all(el).find(value => value.attributes['aria-label'] === 'From visit date');
  assert.equal(from.value, '2026-10-20'); from.value = '2026-09-01'; from.onchange();
  assert.match(text(el), /2026-09-30 · Second Sunrise/); assert.equal(state.query, 'Sunrise');
});
test('expanded details, period and view survive a refresh and insights is an explicit separate choice', async () => {
  const h = harness(), el = h.element(), state: any = { period: 'this-week' };
  await h.api.renderVisitsHub(h.context, {}, el, state);
  const section = all(el).find(value => value.tag === 'details'); section.open = true; section.events.toggle[0]();
  await h.api.renderVisitsHub(h.context, {}, el, state);
  assert.equal(all(el).find(value => value.tag === 'details').open, true);
  await button(el, 'Insights').onclick(); assert.equal(h.calls.insights, 1); assert.match(text(el), /Statistical comparisons/);
  await button(el, 'History').onclick(); assert.equal(state.period, 'this-week'); assert.equal(all(el).filter(value => value.tag === 'article').length, 2);
});
test('stale rendering and stale history actions cannot open editors or files', async () => {
  const h = harness(), el = h.element(); let current = true;
  await h.api.renderVisitsHub(h.context, {}, el, {}, () => current);
  current = false; await button(el, 'Open visit').onclick(); button(el, 'Edit visit').onclick();
  assert.deepEqual(h.calls.opened, []); assert.deepEqual(h.calls.edits, []);
  const next = h.element(); let resolve!: () => void; h.defer(new Promise<void>(done => { resolve = done; }));
  const pending = h.api.renderVisitsHub(h.context, {}, next, {}, () => false); resolve(); await pending; assert.equal(next.children.length, 0);
});
test('pane state keys keep real and example hub choices separate', () => {
  const h = harness(), el = h.element();
  const real = h.api.embeddedVisitsHubState(el, 'Book/Visits.md'), examples = h.api.embeddedVisitsHubState(el, 'Book/Examples/Visits.md');
  real.period = 'previous-week'; examples.view = 'insights';
  assert.equal(h.api.embeddedVisitsHubState(el, 'Book/Visits.md').period, 'previous-week');
  assert.equal(h.api.embeddedVisitsHubState(el, 'Book/Visits.md').view, undefined); assert.notEqual(real, examples);
});
