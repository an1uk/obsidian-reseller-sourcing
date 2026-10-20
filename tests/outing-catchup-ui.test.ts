import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { buildOutingCatchup } from '../src/outings/catch-up';

function harness() {
  class Element {
    children: Element[] = []; tag = 'div'; textContent = ''; cls = ''; disabled = false;
    attributes: Record<string, string> = {}; onclick?: () => unknown;
    createEl(tag: string, options: any = {}) { const el = new Element(); Object.assign(el, { tag, textContent: options.text ?? '', cls: options.cls ?? '', attributes: options.attr ?? {} }); this.children.push(el); return el; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    addClass(value: string) { this.cls += ' ' + value; }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    setText(value: string) { this.textContent = value; }
    empty() { this.children = []; }
  }
  const record: any = { id: 'outing-one', path: 'Book/Examples/Outings/One.md', name: 'A quiet Saturday', status: 'finished', createdAt: '2026-10-16T12:00:00Z', startedAt: '2026-10-17T12:00:00Z', revision: 'o1',
    groups: [{ id: 'group', parkingPath: '', stops: [
      { id: 'one', sourcePath: 'Book/Examples/Places/One.md', status: 'visited', completedAt: '2026-10-17T12:00:00Z', visitId: 'visit-one', visitPath: 'Book/Examples/Visits/One.md' },
      { id: 'two', sourcePath: 'Book/Examples/Places/Two.md', status: 'visited', completedAt: '2026-10-17T13:00:00Z' },
      { id: 'pending', sourcePath: 'Book/Examples/Places/Pending.md', status: 'pending' },
      { id: 'skipped', sourcePath: 'Book/Examples/Places/Skipped.md', status: 'skipped' },
    ] }] };
  const visits: any[] = [{ schema: 1, id: 'visit-one', path: 'Book/Examples/Visits/One.md', sourcePath: 'Book/Examples/Places/One.md', visitDate: '2026-10-17', recordedAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z', observations: 'Good coats', finds: '', nextTime: 'Check seams', outingId: record.id, outingPath: record.path, stopId: 'one', revision: 'v1' }];
  const places = record.groups[0].stops.map((stop: any) => ({ kind: 'shop', path: stop.sourcePath, name: stop.id[0].toUpperCase() + stop.id.slice(1) }));
  const calls = { editors: [] as string[], opened: [] as string[], reads: 0 };
  let pending: Promise<void> | undefined;
  const context: any = { kind: 'examples', root: 'Book/Examples', openFile: async (path: string) => { calls.opened.push(path); }, store: {
    outings: { get: async (path: string) => { assert.equal(path, record.path); calls.reads++; if (pending) await pending; return structuredClone(record); } },
    visits: { inspect: async () => ({ visits: structuredClone(visits), warnings: ['A malformed visit is kept for manual review.'] }) },
    listPlaces: async () => structuredClone(places),
  } };
  const module = { exports: {} as Record<string, any> };
  const code = transformSync(fs.readFileSync(new URL('../src/ui/outing-catchup.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Promise, Error,
    require(id: string) {
      if (id === '../outings/catch-up') return { buildOutingCatchup };
      if (id === '../ui') return { button: (parent: Element, text: string, run: () => unknown) => { const el = parent.createEl('button', { text }); el.onclick = run; return el; }, details: (parent: Element, text: string) => { const el = parent.createEl('details'); el.createEl('summary', { text }); return el; }, errorText: (error: any) => error.message, renderContextBanner: (_context: any, el: Element) => el.createEl('p', { text: 'Examples: fictional practice data' }) };
      if (id === './visits') return { visitSummary: (visit: any) => visit.itemsPurchased === undefined ? 'No purchase count recorded' : visit.itemsPurchased + ' items purchased', renderVisitRecordDetails: (parent: Element, visit: any) => { parent.createEl('p', { text: visit.nextTime }); } };
      throw Error('Unexpected import ' + id);
    },
  });
  return { api: module.exports, context, record, visits, places, calls, element: () => new Element(), open: async (stopId: string) => { calls.editors.push(stopId); }, defer: (value: Promise<void>) => { pending = value; } };
}
function all(el: any): any[] { return [el, ...el.children.flatMap(all)]; }
function text(el: any): string { return all(el).map(value => value.textContent).join('\n'); }
function button(el: any, label: string): any { const value = all(el).find(value => value.tag === 'button' && value.textContent === label); assert.ok(value, label); return value; }

test('catch-up shows actual visited rows, linked summaries, optional missing details and example context', async () => {
  const h = harness(), el = h.element(), before = structuredClone(h.record);
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  assert.deepEqual(all(el).filter(value => value.tag === 'h3').map(value => value.textContent), ['One', 'Two']);
  assert.match(text(el), /Good coats/); assert.match(text(el), /Check seams/); assert.match(text(el), /Items purchased: unknown/);
  assert.match(text(el), /Visited without separate details/); assert.match(text(el), /Examples: fictional practice data/);
  assert.match(text(el), /A malformed visit/); assert.doesNotMatch(text(el), /0 items|remaining|complete \d/);
  assert.deepEqual(h.record, before); assert.deepEqual(h.calls.editors, []);
});

test('add and edit are explicit, use normal editor callbacks and revalidate without creating visits', async () => {
  const h = harness(), el = h.element();
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  await button(el, 'Edit visit details').onclick(); await button(el, 'Add visit details').onclick();
  assert.deepEqual(h.calls.editors, ['one', 'two']); assert.equal(h.calls.reads, 3); assert.equal(h.visits.length, 1);
  assert.equal(h.record.groups[0].stops[1].status, 'visited'); assert.equal(h.record.status, 'finished');
});

test('returning after a save refreshes the explicit zero and keeps the original visit date', async () => {
  const h = harness(), el = h.element();
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  h.visits[0].itemsPurchased = 0; h.visits[0].observations = 'Updated later';
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  assert.match(text(el), /0 items purchased/); assert.match(text(el), /Updated later/); assert.match(text(el), /Visit 2026-10-17/);
});

test('a deleted or changed linked visit offers no editor and no wrong visit navigation', async () => {
  const h = harness(), el = h.element(); h.visits[0].stopId = 'another-stop';
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  const row = all(el).find(value => value.attributes['data-charity-stop'] === 'one');
  assert.match(text(row), /belongs to another/); assert.doesNotMatch(text(row), /Good coats|Open saved visit|Edit visit details/);
  h.visits.length = 0;
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  assert.match(text(el), /linked visit is unavailable/); assert.deepEqual(h.calls.editors, []);
});

test('an existing pending draft is offered only through explicit resume and leaves outcomes untouched', async () => {
  const h = harness(), el = h.element();
  h.record.draft = { operationId: 'draft', stopId: 'pending', updatedAt: '2026-10-20T12:00:00Z', input: { observations: 'Keep me', finds: '', nextTime: '', visitDate: '2026-10-17', updateLastVisited: false } };
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  assert.doesNotMatch(text(el), /Add visit details|Edit visit details/); assert.match(text(el), /saved visit draft for Pending/);
  await button(el, 'Resume visit draft').onclick();
  assert.deepEqual(h.calls.editors, ['pending']); assert.equal(h.record.groups[0].stops[2].status, 'pending'); assert.equal(h.record.draft.input.observations, 'Keep me');
});

test('an unfinished save targets recovery and blocks ordinary row edits', async () => {
  const h = harness(), el = h.element(); h.record.operation = { stopId: 'pending' };
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  assert.doesNotMatch(text(el), /Add visit details|Edit visit details/);
  await button(el, 'Review unfinished visit save').onclick(); assert.deepEqual(h.calls.editors, ['pending']);
});

test('an outcome changed after render cannot be silently converted back to visited', async () => {
  const h = harness(), el = h.element();
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  h.record.groups[0].stops[1].status = 'skipped';
  await button(el, 'Add visit details').onclick(); assert.deepEqual(h.calls.editors, []);
  assert.match(text(el), /outing changed/); assert.equal(h.record.groups[0].stops[1].status, 'skipped');
});

test('stale renders and stale actions cannot open another pane or editor', async () => {
  const h = harness(), el = h.element(); let current = true;
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open, () => current);
  current = false; await button(el, 'Edit visit details').onclick(); await button(el, 'Open source').onclick();
  assert.deepEqual(h.calls.editors, []); assert.deepEqual(h.calls.opened, []);
  let release!: () => void; h.defer(new Promise<void>(resolve => { release = resolve; }));
  const blank = h.element(), loading = h.api.renderOutingCatchup(h.context, {}, blank, h.record.path, h.open, () => false);
  release(); await loading; assert.equal(blank.children.length, 0);
});

test('no visited stops and planned outings remain gentle read-only empty states', async () => {
  const h = harness(), el = h.element(); h.record.groups[0].stops.forEach((stop: any) => { stop.status = 'pending'; });
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  assert.match(text(el), /no visited stops/); assert.equal(all(el).filter(value => value.tag === 'button').length, 0);
  h.record.status = 'planned';
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open);
  assert.match(text(el), /after this outing has started/); assert.deepEqual(h.calls.editors, []);
});

test('an edit survives a passive redraw while its latest-record preflight is pending', async () => {
  const h = harness(), el = h.element(); let generationCurrent = true, actionCurrent = true;
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open, () => generationCurrent, () => actionCurrent);
  let release!: () => void; h.defer(new Promise<void>(resolve => { release = resolve; }));
  const edit = button(el, 'Edit visit details').onclick();
  assert.equal(h.calls.reads, 2); generationCurrent = false;
  release(); await edit;
  assert.deepEqual(h.calls.editors, ['one']); assert.equal(actionCurrent, true);
});

test('navigation during latest-record preflight cancels the action even if render generation is still current', async () => {
  const h = harness(), el = h.element(); let actionCurrent = true;
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open, () => true, () => actionCurrent);
  let release!: () => void; h.defer(new Promise<void>(resolve => { release = resolve; }));
  const edit = button(el, 'Edit visit details').onclick(); actionCurrent = false;
  release(); await edit;
  assert.deepEqual(h.calls.editors, []); assert.doesNotMatch(text(el), /outing changed/);
});

test('a changed-stop error after passive redraw propagates for a visible notice instead of updating detached status', async () => {
  const h = harness(), el = h.element(); let generationCurrent = true;
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open, () => generationCurrent, () => true);
  let release!: () => void; h.defer(new Promise<void>(resolve => { release = resolve; }));
  const add = button(el, 'Add visit details').onclick();
  generationCurrent = false; h.record.groups[0].stops[1].status = 'skipped';
  release(); await assert.rejects(add, /outing changed/);
  assert.deepEqual(h.calls.editors, []); assert.doesNotMatch(text(el), /outing changed/);
});

test('preflight read failures after passive redraw propagate but navigation suppresses them', async () => {
  for (const navigated of [false, true]) {
    const h = harness(), el = h.element(); let generationCurrent = true, actionCurrent = true;
    await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open, () => generationCurrent, () => actionCurrent);
    let reject!: (error: Error) => void; h.defer(new Promise<void>((_resolve, fail) => { reject = fail; }));
    const edit = button(el, 'Edit visit details').onclick();
    generationCurrent = false; actionCurrent = !navigated;
    reject(Error('Latest record unavailable'));
    if (navigated) await edit; else await assert.rejects(edit, /Latest record unavailable/);
    assert.deepEqual(h.calls.editors, []); assert.doesNotMatch(text(el), /Latest record unavailable/);
  }
});

test('file actions use route validity through passive redraw and stop after navigation', async () => {
  const h = harness(), el = h.element(); let generationCurrent = true, actionCurrent = true;
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open, () => generationCurrent, () => actionCurrent);
  generationCurrent = false;
  await button(el, 'Open source').onclick(); await button(el, 'Open saved visit').onclick();
  assert.deepEqual(h.calls.opened, ['Book/Examples/Places/One.md', 'Book/Examples/Visits/One.md']);
  actionCurrent = false;
  await button(el, 'Open source').onclick(); await button(el, 'Open saved visit').onclick();
  assert.equal(h.calls.opened.length, 2);
});

test('route validity never revives an initial render from an obsolete generation', async () => {
  const h = harness(), el = h.element();
  await h.api.renderOutingCatchup(h.context, {}, el, h.record.path, h.open, () => false, () => true);
  assert.equal(el.children.length, 0);
});
