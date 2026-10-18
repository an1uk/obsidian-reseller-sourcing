import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { defaultPlanningOptions } from '../src/outings/planning';
import * as units from '../src/units';

function harness(saved = true) {
  class Element {
    children: Element[] = []; parent?: Element; tag = 'div'; textContent = ''; value = ''; type = ''; disabled = false; isConnected = true; open = false;
    attributes: Record<string, string> = {}; cls = ''; style = {}; min = ''; max = ''; step = ''; hidden = false; scrollTop = 0; rectTop = 0;
    getBoundingClientRect() { return { top: this.rectTop }; }
    onclick?: () => unknown; onchange?: () => unknown;
    createEl(tag: string, options: any = {}) { const el = new Element(); el.parent = this; el.tag = tag; el.type = options.type ?? ''; el.textContent = options.text ?? ''; el.cls = options.cls ?? ''; el.value = options.value ?? ''; el.attributes = options.attr ?? {}; this.children.push(el); return el; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    createSpan(options: any = {}) { return this.createEl('span', options); }
    setAttribute(key: string, value: string) { this.attributes[key] = value; } getAttribute(key: string) { return this.attributes[key] ?? null; }
    setText(value: string) { this.textContent = value; } addClass(value: string) { this.cls += ' ' + value; }
    removeClass(value: string) { this.cls = this.cls.replace(value, ''); } toggleClass(value: string, show: boolean) { show ? this.addClass(value) : this.removeClass(value); }
    hide() { this.hidden = true; } show() { this.hidden = false; } toggle(show: boolean) { this.hidden = !show; }
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(el => el !== this); }
    empty() { for (const child of all(this).slice(1)) child.isConnected = false; this.children = []; this.textContent = ''; }
    querySelectorAll(selector: string): Element[] { return all(this).slice(1).filter(el => selector.split(',').includes(el.tag)); }
    querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] ?? null; }
  }
  class Modal {
    contentEl = new Element(); modalEl = new Element(); titleEl = new Element(); closed = false;
    constructor(public app: unknown) {} open() { (this as any).onOpen?.(); } close() { this.closed = true; (this as any).onClose?.(); }
  }
  let ownerUnloads = 0, maps = 0, mapsDestroyed = 0;
  let pick: ((coordinates: [number, number]) => void) | undefined;
  class Component { load() {} unload() { ownerUnloads++; } }
  class Setting {
    settingEl: Element;
    constructor(parent: Element) { this.settingEl = parent.createDiv(); }
    setName(value: string) { this.settingEl.setAttribute('name', value); return this; }
    addText(run: (control: any) => void) {
      const inputEl = this.settingEl.createEl('input');
      const control: any = { inputEl, setValue(value: string) { inputEl.value = value; return control; }, onChange(callback: (value: string) => void) { inputEl.onchange = () => callback(inputEl.value); return control; } }; run(control); return this;
    }
    addDropdown(run: (control: any) => void) {
      const selectEl = this.settingEl.createEl('select');
      const control: any = { selectEl, addOption(value: string, text: string) { selectEl.createEl('option', { value, text }); return control; }, setValue(value: string) { selectEl.value = value; return control; }, onChange(callback: (value: string) => void) { selectEl.onchange = () => callback(selectEl.value); return control; } }; run(control); return this;
    }
  }
  const notices: string[] = [], applied: any[] = [], draftApplied: any[] = [], previewOptions: any[] = [];
  let release = 0, previewCount = 0, fingerprint = 'first', failApply = false;
  let delay: Promise<unknown> | undefined;
  const record: any = { id: 'outing-id', path: 'Book/Examples/Outings/Test.md', name: 'Test outing', status: 'planned', revision: 'revision', createdAt: '', groups: [{ id: 'group', parkingPath: 'Book/Examples/Parking/One.md', stops: [{ id: 'stop', sourcePath: 'Book/Examples/Sources/One.md', status: 'pending' }] }] };
  const places: any[] = [
    { path: 'Book/Examples/Sources/One.md', name: 'Source one', kind: 'shop', coordinates: [1, 2], properties: {} },
    { path: 'Book/Examples/Parking/One.md', name: 'Parking one', kind: 'parking', coordinates: [1, 2.1], properties: {} },
  ];
  const estimate = () => ({ drivingKm: 2, walkingKm: 1, totalKm: 3, totalMinutes: 40, waitingMinutes: 0, openingConflicts: 0, unconfirmedHours: 1, startAt: 1000, finishAt: 2000, latestFinishMissed: false, timeline: [{ groupId: 'group', stopId: 'stop', sourcePath: places[0].path, arrival: 1200, visitStarts: 1200, departure: 1500, waitMinutes: 0, visitMinutes: 20, hoursStatus: 'unconfirmed', hoursChecked: '' }] });
  async function preview(options: any) { previewCount++; previewOptions.push(structuredClone(options)); if (delay) await delay; return { fingerprint, options: structuredClone(options), groups: structuredClone(record.groups), current: estimate(), proposed: estimate(), warnings: ['Holiday hours unconfirmed'], blockers: [] }; }
  const context: any = {
    kind: 'examples', settings: { distanceUnit: 'miles' }, app: {}, mapHost: {}, beginEditing: () => () => release++,
    store: { listPlaces: async () => places, outings: {
      get: async () => structuredClone(record),
      planningHours: async () => ({}),
      previewPlanning: async (_path: string, options: any) => preview(options),
      applyPlanning: async (path: string, options: any, expected: string) => { applied.push({ path, options, expected }); if (failApply) { failApply = false; fingerprint = 'second'; throw Error('Comparison changed'); } return structuredClone(record); },
    } },
  };
  const module = { exports: {} as Record<string, any> };
  const source = fs.readFileSync(new URL('../src/ui/outing-planner.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
    module, exports: module.exports, structuredClone, navigator: {}, Number, Map, Set, Error,
    require(id: string) {
      if (id === 'obsidian') return { Modal, Component, Setting, Notice: class { constructor(message: string) { notices.push(message); } } };
      if (id === '../units') return units;
      if (id === '../outings/planning') return { defaultPlanningOptions, buildOutingOptimisationPreview: (_r: unknown, _p: unknown, _h: unknown, options: any) => preview(options), formatPlanningTime: () => '09:30' };
      if (id === '../storage/markdown') return { linkPath: (value: string) => value.replace(/^\\[\\[|\\]\\]$/g, '') };
      if (id === '../ui') return {
        details: (parent: Element, title: string) => { const el = parent.createEl('details'); el.createEl('summary', { text: title }); return el; },
        errorText: (error: any) => error.message ?? String(error), renderContextBanner: () => {},
      };
      if (id === '../map') return { mountPlaceMap: (_owner: unknown, _el: unknown, _host: unknown, options: any) => { pick = options.onPick; maps++; return { setPickMode() {}, destroy() { mapsDestroyed++; } }; } };
      throw Error('Unexpected import ' + id);
    },
  });
  const target = saved ? { path: record.path } : { draft: () => structuredClone(record), onApplyDraft: (groups: any, options: any) => draftApplied.push({ groups, options }) };
  const modal = new module.exports.OutingPlannerModal(context, target);
  return { modal, api: module.exports, record, context, applied, draftApplied, notices, previewOptions,
    counts: () => ({ release, previewCount, ownerUnloads, maps, mapsDestroyed }),
    changeFingerprint: () => { fingerprint = 'second'; }, failNextApply: () => { failApply = true; },
    defer: (pending: Promise<unknown>) => { delay = pending; },
    pick: (coordinates: [number, number]) => { assert.ok(pick); pick(coordinates); },
  };
}
function all(element: any): any[] { return [element, ...element.children.flatMap(all)]; }
async function settle(modal: any) { for (let i = 0; i < 30 && modal.busy; i++) await new Promise(resolve => setImmediate(resolve)); }
function input(modal: any, label: string, value: string) { const el = all(modal.contentEl).find(el => el.attributes['aria-label'] === label); assert.ok(el, label); el.value = value; el.onchange?.(); return el; }
async function click(modal: any, label: string) { const el = all(modal.contentEl).find(el => el.tag === 'button' && el.textContent === label); assert.ok(el, label); assert.equal(el.disabled, false, label + ' enabled'); el.onclick?.(); await settle(modal); }
async function open(h: ReturnType<typeof harness>) { h.modal.open(); await settle(h.modal); }

test('planner defaults are visible, apply requires explicit preview and cancellation writes nothing', async () => {
  const h = harness(); await open(h);
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Planning priority').value, 'hours');
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Minutes per source').value, '20');
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Journey finish').value, 'last');
  assert.equal(all(h.modal.contentEl).find(el => el.textContent === 'Use suggested plan').disabled, true);
  await click(h.modal, 'Keep current plan');
  assert.equal(h.applied.length, 0); assert.equal(h.counts().release, 1);
});

test('saved planner uses only its captured notebook and selected comparison', async () => {
  const h = harness(); await open(h);
  input(h.modal, 'Starting point saved location', 'Book/Examples/Parking/One.md');
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.applied.length, 0);
  await click(h.modal, 'Use suggested plan');
  assert.equal(h.applied.length, 1); assert.equal(h.applied[0].path, h.record.path); assert.equal(h.applied[0].expected, 'first');
  assert.equal(h.applied[0].options.start.kind, 'record');
  assert.equal(h.counts().release, 1);
});

test('draft planner applies groups/options only to the draft callback', async () => {
  const h = harness(false); await open(h);
  await click(h.modal, 'Preview suggested plan');
  await click(h.modal, 'Use suggested plan');
  assert.equal(h.applied.length, 0); assert.equal(h.draftApplied.length, 1); assert.equal(h.draftApplied[0].options.defaultVisitMinutes, 20);
});

test('changing an input invalidates the comparison and leaves controls and entered values intact', async () => {
  const h = harness(); await open(h); await click(h.modal, 'Preview suggested plan');
  input(h.modal, 'Departure time', '10:15');
  assert.equal(all(h.modal.contentEl).find(el => el.textContent === 'Use suggested plan').disabled, true);
  assert.equal(h.modal.previewEl.children.length, 0);
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.previewOptions.at(-1).departureTime, '10:15');
});

test('date changes clear date-specific hours but retain visit durations', async () => {
  const h = harness(); h.record.planning = defaultPlanningOptions();
  h.record.planning.stopOverrides.stop = { visitMinutes: 35, hours: { closed: true, intervals: [] } };
  await open(h); input(h.modal, 'Outing date', '2026-11-01');
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.previewOptions.at(-1).stopOverrides.stop.visitMinutes, 35);
  assert.equal(h.previewOptions.at(-1).stopOverrides.stop.hours, undefined);
});

test('invalid date-specific interval keeps the draft and prevents a preview until corrected', async () => {
  const h = harness(); await open(h);
  input(h.modal, 'Hours override for Source one', 'open');
  input(h.modal, 'Opening intervals for Source one', 'maybe lunchtime');
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.counts().previewCount, 0); assert.match(h.modal.status.textContent, /opening intervals/i);
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Opening intervals for Source one').value, 'maybe lunchtime');
  input(h.modal, 'Opening intervals for Source one', '09:00-12:00; 13:00-17:00');
  await click(h.modal, 'Preview suggested plan'); assert.equal(h.counts().previewCount, 1);
});

test('stale saved apply refreshes the comparison without automatically applying it', async () => {
  const h = harness(); await open(h); await click(h.modal, 'Preview suggested plan'); h.failNextApply();
  await click(h.modal, 'Use suggested plan');
  assert.equal(h.applied.length, 1); assert.match(h.modal.status.textContent, /Review the refreshed comparison/);
  assert.equal(h.modal.closed, false);
  await click(h.modal, 'Use suggested plan'); assert.equal(h.applied[1].expected, 'second'); assert.equal(h.modal.closed, true);
});

test('closing during a preview prevents late DOM changes and holds the editing lease until work settles', async () => {
  const h = harness(); await open(h);
  let resolve!: () => void; h.defer(new Promise<void>(done => resolve = done));
  const el = all(h.modal.contentEl).find(el => el.textContent === 'Preview suggested plan'); el.onclick();
  await new Promise(done => setImmediate(done)); h.modal.close();
  assert.equal(h.counts().release, 0); assert.equal(h.modal.contentEl.children.length, 0);
  resolve(); await settle(h.modal);
  assert.equal(h.counts().release, 1); assert.equal(h.modal.contentEl.children.length, 0); assert.equal(h.applied.length, 0);
});

test('unfinished visit drafts block planning before exposing save controls', async () => {
  const h = harness(); h.record.draft = { stopId: 'stop' }; await open(h);
  assert.match(h.modal.status.textContent, /saved visit draft/);
  assert.equal(all(h.modal.contentEl).some(el => el.textContent === 'Use suggested plan'), false);
  h.modal.close(); assert.equal(h.counts().release, 1);
});

test('hours override parser accepts split and overnight clocks, rejecting uncertain or invalid text', () => {
  const h = harness(), parse = h.api.parsePlanningHoursOverride;
  assert.equal(parse('09:00-12:00;13:00-17:00').intervals.length, 2);
  assert.equal(parse('22:00-02:00').intervals[0].close, '02:00');
  assert.equal(parse('00:00-24:00').intervals[0].close, '24:00');
  for (const raw of ['', 'whenever', '25:00-26:00', '09:00-09:00']) assert.throws(() => parse(raw));
});

test('switching finish modes preserves the chosen endpoint instead of showing a stale selection', async () => {
  const h = harness(); await open(h);
  input(h.modal, 'Journey finish', 'another');
  input(h.modal, 'Finishing point saved location', 'Book/Examples/Parking/One.md');
  input(h.modal, 'Journey finish', 'return');
  input(h.modal, 'Journey finish', 'another');
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.previewOptions.at(-1).end.kind, 'record');
  assert.equal(h.previewOptions.at(-1).end.path, 'Book/Examples/Parking/One.md');
});
test('draft comparisons refresh after places or source assumptions changed, with no automatic application', async () => {
  const h = harness(false); await open(h);
  await click(h.modal, 'Preview suggested plan'); h.changeFingerprint();
  await click(h.modal, 'Use suggested plan');
  assert.equal(h.draftApplied.length, 0); assert.equal(h.modal.closed, false);
  assert.match(h.modal.status.textContent, /Review the refreshed comparison/);
  await click(h.modal, 'Use suggested plan'); assert.equal(h.draftApplied.length, 1);
});
test('travel assumption controls advertise only values accepted by the planner', async () => {
  const h = harness(); h.context.settings.distanceUnit = 'km'; await open(h);
  const walk = all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Walking speed (km/h)');
  const park = all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Parking minutes per group');
  assert.equal(walk.min, '0.5'); assert.equal(walk.max, '20'); assert.equal(park.max, '120');
});

test('map selections are inert during a pending preview and become available after calculation', async () => {
  const h = harness(); await open(h);
  input(h.modal, 'Starting point location method', 'coordinates');
  input(h.modal, 'Starting point latitude', '1');
  input(h.modal, 'Starting point longitude', '2');
  await click(h.modal, 'Pick starting point on map');
  let resolve!: () => void; h.defer(new Promise<void>(done => resolve = done));
  const preview = all(h.modal.contentEl).find(el => el.textContent === 'Preview suggested plan');
  preview.onclick(); await new Promise(done => setImmediate(done));
  h.pick([3, 4]);
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Starting point latitude').value, '1');
  assert.equal(h.modal.mapContainer.inert, true);
  resolve(); await settle(h.modal);
  assert.equal(h.modal.options.start.coordinates[0], 1); assert.equal(h.modal.preview.options.start.coordinates[0], 1);
  assert.equal(h.modal.mapContainer.inert, false);
  h.pick([3, 4]);
  assert.equal(h.modal.options.start.coordinates[0], 3); assert.equal(h.modal.preview, undefined);
});

test('superseded preview generations cannot overwrite newer form values', async () => {
  const h = harness(); await open(h);
  let resolve!: () => void; h.defer(new Promise<void>(done => resolve = done));
  const preview = all(h.modal.contentEl).find(el => el.textContent === 'Preview suggested plan');
  preview.onclick(); await new Promise(done => setImmediate(done));
  // Simulate a queued input event that arrived after its DOM control was disabled.
  input(h.modal, 'Departure time', '11:45');
  resolve(); await settle(h.modal);
  assert.equal(h.modal.options.departureTime, '11:45'); assert.equal(h.modal.preview, undefined);
  assert.equal(all(h.modal.contentEl).find(el => el.textContent === 'Use suggested plan').disabled, true);
  assert.match(h.modal.status.textContent, /Inputs changed while calculating/);
});

test('map selections cannot alter the endpoint while an explicit save is pending', async () => {
  const h = harness(); await open(h);
  input(h.modal, 'Starting point location method', 'coordinates');
  input(h.modal, 'Starting point latitude', '1');
  input(h.modal, 'Starting point longitude', '2');
  await click(h.modal, 'Pick starting point on map');
  await click(h.modal, 'Preview suggested plan');
  let resolve!: () => void;
  const pending = new Promise<void>(done => resolve = done);
  h.context.store.outings.applyPlanning = async (_path: string, options: any) => { h.applied.push({ options }); await pending; };
  const apply = all(h.modal.contentEl).find(el => el.textContent === 'Use suggested plan');
  apply.onclick(); await new Promise(done => setImmediate(done));
  h.pick([3, 4]);
  assert.equal(h.applied[0].options.start.coordinates[0], 1);
  assert.equal(h.modal.options.start.coordinates[0], 1);
  resolve(); await settle(h.modal); assert.equal(h.modal.closed, true);
});

test('completed previews scroll only the modal content to the comparison and retain entered values', async () => {
  const h = harness(); await open(h);
  input(h.modal, 'Departure time', '10:30');
  h.modal.contentEl.scrollTop = 20; h.modal.contentEl.rectTop = 100; h.modal.previewEl.rectTop = 360;
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.modal.contentEl.scrollTop, 280);
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Departure time').value, '10:30');
  assert.equal(h.modal.options.departureTime, '10:30');
});

test('miles are the default for planner distances and editable speeds', async () => {
  const h = harness(); await open(h); await click(h.modal, 'Preview suggested plan');
  const text = all(h.modal.previewEl).map(el => el.textContent).join('\n');
  assert.match(text, /1\.9 miles estimated/); assert.match(text, /1\.2 miles driving, 0\.6 miles walking/);
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Driving speed (mph)').value, '18.6');
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Walking speed (mph)').value, '2.8');
});

test('kilometre preference uses metric distances and speed labels', async () => {
  const h = harness(); h.context.settings.distanceUnit = 'km'; await open(h); await click(h.modal, 'Preview suggested plan');
  const text = all(h.modal.previewEl).map(el => el.textContent).join('\n');
  assert.match(text, /3\.0 km estimated/); assert.match(text, /2\.0 km driving, 1\.0 km walking/);
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Driving speed (km/h)').value, '30');
  assert.equal(h.context.settings.distanceUnit, 'km');
});

test('mph edits convert to canonical kilometres per hour and enforce physical limits', async () => {
  const h = harness(); await open(h);
  input(h.modal, 'Driving speed (mph)', '25'); input(h.modal, 'Walking speed (mph)', '3.2');
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.previewOptions.at(-1).estimates.driveKph, units.distanceToKm(25, 'miles'));
  assert.equal(h.previewOptions.at(-1).estimates.walkKph, units.distanceToKm(3.2, 'miles'));
  const walking = all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Walking speed (mph)');
  assert.equal(walking.min, String(units.distanceFromKm(.5, 'miles'))); assert.equal(walking.max, String(units.distanceFromKm(20, 'miles'))); assert.equal(walking.step, 'any');
  const previews = h.counts().previewCount;
  input(h.modal, 'Walking speed (mph)', '.1'); await click(h.modal, 'Preview suggested plan');
  assert.equal(h.counts().previewCount, previews); assert.match(h.modal.status.textContent, /Walking speed.*mph/);
});

test('opening, unchanged displayed inputs and unit re-renders retain exact saved speeds', async () => {
  const h = harness(); h.record.planning = defaultPlanningOptions();
  h.record.planning.estimates.driveKph = 37.123456; h.record.planning.estimates.walkKph = 4.567891;
  await open(h);
  for (const label of ['Driving speed (mph)', 'Walking speed (mph)']) {
    const field = all(h.modal.contentEl).find(el => el.attributes['aria-label'] === label);
    input(h.modal, label, field.value);
  }
  h.context.settings.distanceUnit = 'km'; h.modal.render();
  h.context.settings.distanceUnit = 'miles'; h.modal.render();
  await click(h.modal, 'Preview suggested plan');
  assert.equal(h.previewOptions.at(-1).estimates.driveKph, 37.123456);
  assert.equal(h.previewOptions.at(-1).estimates.walkKph, 4.567891);
});

test('saved return choices survive the new finish-at-last default', async () => {
  const h = harness(); h.record.planning = defaultPlanningOptions(); h.record.planning.end = { kind: 'return' };
  await open(h); await click(h.modal, 'Preview suggested plan');
  assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Journey finish').value, 'return');
  assert.equal(h.previewOptions.at(-1).end.kind, 'return');
});

test('an open planner keeps its labelled unit basis when another pane changes preferences', async () => {
  const h = harness(); await open(h);
  h.context.settings.distanceUnit = 'km';
  input(h.modal, 'Driving speed (mph)', '20'); await click(h.modal, 'Preview suggested plan');
  assert.equal(h.previewOptions.at(-1).estimates.driveKph, units.distanceToKm(20, 'miles'));
  assert.match(all(h.modal.previewEl).map(el => el.textContent).join('\n'), /miles estimated/);
  assert.equal(h.context.settings.distanceUnit, 'km');
});
