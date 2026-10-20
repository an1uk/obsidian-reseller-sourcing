import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as focus from '../src/outings/focus';
import { validateCoordinates } from '../src/domain/coordinates';

function harness() {
  class Element {
    children: Element[] = []; tag = 'div'; textContent = ''; cls = ''; disabled = false; primary = false;
    attributes: Record<string, string> = {}; onclick?: () => unknown;
    createEl(tag: string, options: any = {}) { const el = new Element(); Object.assign(el, { tag, textContent: options.text ?? '', cls: options.cls ?? '', attributes: options.attr ?? {} }); this.children.push(el); return el; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    addClass(value: string) { this.cls += ' ' + value; }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    setText(value: string) { this.textContent = value; }
  }
  class File {}
  const root = 'Book/Examples', source = (id: string) => ({ kind: 'shop', path: root + '/Places/' + id + '.md', name: id, locality: '', coordinates: [50, Number(id === 'Second') * .01], properties: {} });
  const first: any = source('First'), second: any = source('Second'), parking: any = { ...source('Parking'), kind: 'parking', coordinates: [50.1, 1] };
  const places = [first, second, parking];
  const record: any = { id: 'outing', path: root + '/Outings/Trip.md', name: 'Trip', status: 'active', createdAt: '', revision: 'one', groups: [{ id: 'group', parkingPath: parking.path, stops: [{ id: 'first', sourcePath: first.path, status: 'pending' }, { id: 'second', sourcePath: second.path, status: 'pending' }] }] };
  record.focus = { ...focus.outingFocusView(record, places).state, enabled: true };
  const calls = { external: [] as any[], edits: [] as string[], focus: [] as any[], outcomes: [] as any[], retry: 0, cancel: 0, finish: 0, discard: 0, skip: 0, open: [] as string[], picks: [] as any[] };
  const context: any = { root, kind: 'examples', externalActions: 'preview', app: { vault: { getAbstractFileByPath: () => new File(), read: async () => 'Source text' } }, beginEditing: () => () => {}, openExternal: async (...args: any[]) => calls.external.push(args), openFile: async (path: string) => calls.open.push(path), store: {
    listPlaces: async () => structuredClone(places), visits: { list: async () => [] }, outings: {
      get: async () => structuredClone(record),
      setFocus: async (_path: string, state: any, revision: string, fingerprint: string) => { assert.equal(revision, record.revision); assert.equal(fingerprint, focus.outingFocusFingerprint(record, places)); calls.focus.push(structuredClone(state)); record.focus = structuredClone(state); return record; },
      completeStop: async (...args: any[]) => calls.outcomes.push(args), resumeVisit: async () => calls.retry++, cancelPendingVisit: async () => calls.cancel++,
    },
  } };
  const module = { exports: {} as Record<string, any> }, code = transformSync(fs.readFileSync(new URL('../src/ui/outing-focus.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Promise, Error, structuredClone,
    require(id: string) {
      if (id === 'obsidian') return { TFile: File };
      if (id === '../outings/focus') return focus;
      if (id === '../outings/domain') return { extractSourceContext: () => ({ reminder: 'Check the cuffs before buying.\n\nEverything else can wait.', reminderDate: '2026-10-20' }) };
      if (id === '../domain') return { validateCoordinates, navigationUrl: (coords: any, mode: string) => validateCoordinates(coords) ? 'https://example.invalid/' + mode + '/' + coords.join(',') : '', googleMapsUrl: () => 'https://example.invalid/listing' };
      if (id === '../ui') return {
        button: (parent: Element, text: string, run: () => unknown, primary = false) => { const el = parent.createEl('button', { text }); el.onclick = run; el.primary = primary; return el; },
        details: (parent: Element, text: string) => { const el = parent.createEl('details'); el.createEl('summary', { text }); return el; },
        errorText: (error: any) => error.message, renderContextBanner: (_context: any, el: Element) => el.createEl('p', { text: 'Fictional practice' }),
        PickModal: class { constructor(...args: any[]) { calls.picks.push(args); } open() {} },
      };
      throw Error('Unexpected import ' + id);
    },
  });
  let current = true, actionCurrent = true;
  const actions = { openVisit: (id: string) => calls.edits.push(id), finish: () => calls.finish++, skip: () => calls.skip++, discardDraft: () => calls.discard++, catchup: () => {} };
  return { record, places, first, second, parking, calls, context, render: async () => { const el = new Element(); await module.exports.renderOutingFocus(context, el, structuredClone(record), structuredClone(places), actions, () => current, () => actionCurrent); return el; }, passiveRedraw: () => { current = false; }, stale: () => { current = false; actionCurrent = false; } };
}
function all(el: any): any[] { return [el, ...el.children.flatMap(all)]; }
function text(el: any): string { return all(el).map(value => value.textContent).join('\n'); }
function button(el: any, label: string): any { const value = all(el).find(value => value.tag === 'button' && value.textContent === label); assert.ok(value, label); return value; }
function primaries(el: any): string[] { return all(el).filter(value => value.primary).map(value => value.textContent); }

test('focus leads with one source, one short reminder, one primary action and More escape', async () => {
  const h = harness(), el = await h.render();
  assert.deepEqual(primaries(el), ['Preview Drive to parking']); assert.match(text(el), /First/); assert.match(text(el), /Check the cuffs/);
  const reminder = all(el).find(value => value.cls === 'charity-focus-reminder'); assert.doesNotMatch(text(reminder), /Everything else/);
  const more = all(el).find(value => value.tag === 'details' && text(value).includes('Full outing view')); assert.ok(more); assert.equal(more.attributes.open, undefined);
  assert.match(text(el), /Driving destination: Parking/); assert.doesNotMatch(text(el), /Sourcing rating|Saved opening hours/);
});
test('fictional directions preview the selected parking and never advance phase or progress', async () => {
  const h = harness(), el = await h.render(); await button(el, 'Preview Drive to parking').onclick();
  assert.match(h.calls.external[0][0], /driving\/50.1,1$/); assert.deepEqual(h.calls.focus, []); assert.deepEqual(h.calls.outcomes, []); assert.equal(h.record.focus.phase, 'drive');
});
test('park and arrive confirmations are explicit and record uses the existing editor without recording by itself', async () => {
  const h = harness(); let el = await h.render(); await button(el, 'I have parked').onclick();
  assert.equal(h.record.focus.phase, 'walk'); assert.equal(h.record.focus.parkedParkingPath, h.parking.path);
  el = await h.render(); assert.deepEqual(primaries(el), ['Preview Walk to shop']); await button(el, "I'm at the shop").onclick();
  el = await h.render(); assert.deepEqual(primaries(el), ['Record visit']); await button(el, 'Record visit').onclick();
  assert.deepEqual(h.calls.edits, ['first']); assert.equal(h.record.groups[0].stops[0].status, 'pending'); assert.deepEqual(h.calls.outcomes, []);
});
test('saved drafts and unfinished saves keep recovery prominent and disable ordinary phase/progress controls', async () => {
  const h = harness(); h.record.draft = { stopId: 'second', input: {}, updatedAt: '' }; let el = await h.render();
  assert.deepEqual(primaries(el), ['Resume visit draft']); assert.doesNotMatch(text(el), /Change stage|I have parked|Visited without notes|Skip stop/);
  await button(el, 'Resume visit draft').onclick(); assert.deepEqual(h.calls.edits, ['second']); await button(el, 'Full outing view').onclick(); assert.equal(h.record.focus.enabled, false); assert.ok(h.record.draft);
  h.record.focus.enabled = true; h.record.operation = { stopId: 'second' }; el = await h.render();
  assert.deepEqual(primaries(el), ['Retry visit completion']); assert.doesNotMatch(text(el), /Change stage|Resume visit draft|Skip stop/);
  await button(el, 'Retry visit completion').onclick(); assert.equal(h.calls.retry, 1); await button(el, 'Cancel unsaved attempt').onclick(); assert.equal(h.calls.cancel, 1);
});
test('missing parking pins keep directions and parked confirmation disabled with full-view correction available', async () => {
  const h = harness(); h.parking.coordinates = null; const el = await h.render();
  assert.equal(button(el, 'Preview Drive to parking').disabled, true); assert.equal(button(el, 'I have parked').disabled, true); assert.match(text(el), /Directions need a valid pin/);
  await button(el, 'Full outing view').onclick(); assert.equal(h.record.focus.enabled, false); assert.deepEqual(h.calls.external, []);
});
test('source or pin edits after rendering and stale panes cannot launch a cached destination or editor', async () => {
  const h = harness(), el = await h.render(); h.parking.coordinates = [51, 2];
  await assert.rejects(button(el, 'Preview Drive to parking').onclick(), /location changed/); assert.deepEqual(h.calls.external, []);
  const other = harness(); other.record.focus.phase = 'visit'; const stale = await other.render(); other.stale(); await button(stale, 'Record visit').onclick(); assert.deepEqual(other.calls.edits, []);
});
test('the last recorded stop retains return-to-car, then presents explicit Finish outing', async () => {
  const h = harness(); h.record.focus = { ...focus.confirmOutingParked(h.record, h.places), enabled: true };
  for (const stop of h.record.groups[0].stops) stop.status = 'visited'; let el = await h.render();
  assert.deepEqual(primaries(el), ['Preview Return to car']); await button(el, "I'm back at the car").onclick();
  el = await h.render(); assert.deepEqual(primaries(el), ['Finish outing']); await button(el, 'Finish outing').onclick(); assert.equal(h.calls.finish, 1); assert.equal(h.record.status, 'active');
});
test('missing source retains the exact stop and offers skip or full view without another source destination', async () => {
  const h = harness(); h.record.focus.phase = 'walk'; h.places.splice(h.places.indexOf(h.first), 1); const el = await h.render();
  assert.match(text(el), /Source unavailable/); assert.equal(button(el, 'Preview Walk to shop').disabled, true); assert.equal(button(el, "I'm at the shop").disabled, true);
  await button(el, 'Skip stop').onclick(); assert.equal(h.calls.skip, 1); assert.deepEqual(h.calls.external, []);
});

test('passive redraw during action preflight retains a valid destination and editor action', async () => {
  for (const phase of ['drive', 'visit']) {
    const h = harness(); h.record.focus.phase = phase; const el = await h.render();
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const read = h.context.store.outings.get;
    h.context.store.outings.get = async () => { await pending; return read(); };
    const clicked = button(el, phase === 'drive' ? 'Preview Drive to parking' : 'Record visit').onclick();
    h.passiveRedraw(); release(); await clicked;
    assert.equal(h.record.revision, 'one');
    if (phase === 'drive') assert.match(h.calls.external[0][0], /driving\/50.1,1$/);
    else assert.deepEqual(h.calls.edits, ['first']);
  }
});

test('navigation away during deferred action preflight cancels without launching or editing', async () => {
  for (const phase of ['drive', 'visit']) {
    const h = harness(); h.record.focus.phase = phase; const el = await h.render();
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const read = h.context.store.outings.get;
    h.context.store.outings.get = async () => { await pending; return read(); };
    const clicked = button(el, phase === 'drive' ? 'Preview Drive to parking' : 'Record visit').onclick();
    h.stale(); release(); await clicked;
    assert.deepEqual(h.calls.external, []); assert.deepEqual(h.calls.edits, []); assert.deepEqual(h.calls.focus, []);
  }
});

test('passive redraw never bypasses comparison of changed names or coordinates', async () => {
  for (const property of ['name', 'coordinates']) {
    const h = harness(), el = await h.render();
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const read = h.context.store.outings.get;
    h.context.store.outings.get = async () => { await pending; return read(); };
    h.context.store.listPlaces = async () => { await pending; return structuredClone(h.places); };
    const clicked = button(el, 'Preview Drive to parking').onclick();
    h.passiveRedraw();
    if (property === 'name') h.parking.name = 'Changed parking'; else h.parking.coordinates = [51, 2];
    release();
    await assert.rejects(clicked, /location changed/);
    assert.deepEqual(h.calls.external, []); assert.deepEqual(h.calls.edits, []);
  }
});

test('a stage picker survives passive redraw but becomes inert after navigation away', async () => {
  const h = harness(), el = await h.render(); await button(el, 'Change stage').onclick();
  h.passiveRedraw(); await h.calls.picks.at(-1)[3]('walk');
  assert.equal(h.calls.focus.length, 1); assert.equal(h.record.focus.phase, 'walk');
  h.stale(); await h.calls.picks.at(-1)[3]('visit');
  assert.equal(h.calls.focus.length, 1);
});
