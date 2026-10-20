import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as shortTrip from '../src/outings/short-trip';
import * as planning from '../src/outings/planning';
import * as units from '../src/units';
import { validateCoordinates } from '../src/domain/coordinates';

function all(el: any): any[] { return [el, ...el.children.flatMap(all)]; }
function harness() {
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const win = { setTimeout: () => 1, clearTimeout() {} };
  class Element {
    parent?: Element;
    children: Element[] = []; textContent = ''; value = ''; type = ''; disabled = false; inert = false; cls = ''; attributes: Record<string, string> = {};
    ownerDocument = document; win = win; readOnly = false; min = ''; max = ''; step = ''; onclick?: () => unknown; onchange?: () => unknown;
    createEl(tag: string, options: any = {}) { const el = new Element() as Element & { tag: string }; el.parent = this; el.tag = tag; el.textContent = options.text ?? ''; el.type = options.type ?? ''; el.cls = options.cls ?? ''; el.attributes = options.attr ?? {}; el.value = options.value ?? ''; this.children.push(el); return el; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    setText(value: string) { this.textContent = value; } setAttribute(key: string, value: string) { this.attributes[key] = value; }
    addClass(value: string) { this.cls += ' ' + value; } removeClass(value: string) { this.cls = this.cls.replace(value, ''); }
    toggleClass(value: string, enabled: boolean) { const classes = new Set(this.cls.split(' ').filter(Boolean)); enabled ? classes.add(value) : classes.delete(value); this.cls = [...classes].join(' '); }
    insertBefore(child: Element, before: Element | null) {
      if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child);
      const index = before ? this.children.indexOf(before) : -1;
      if (before && index < 0) throw Error('The reference element is not a child.');
      this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parent = this; return child;
    }
    empty() { for (const child of this.children) child.parent = undefined; this.children = []; this.textContent = ''; }
    querySelector(selector: string) { return all(this).slice(1).find(el => selector.startsWith('.') ? el.cls.split(' ').includes(selector.slice(1)) : el.tag === selector) ?? null; }
  }
  class Modal {
    contentEl = new Element(); titleEl = new Element(); modalEl = new Element();
    constructor(public app: unknown) {} open() { (this as any).onOpen(); } close() { (this as any).onClose(); }
  }
  class Component { load() {} unload() {} }
  class Setting {
    settingEl: Element;
    constructor(parent: Element) { this.settingEl = parent.createDiv(); }
    setName(name: string) { this.settingEl.setAttribute('name', name); return this; }
    addText(run: (c: any) => void) {
      const inputEl = this.settingEl.createEl('input');
      const c: any = { inputEl, setValue(value: string) { inputEl.value = value; return c; }, onChange(callback: (value: string) => void) { inputEl.onchange = () => callback(inputEl.value); return c; } }; run(c); return this;
    }
    addDropdown(run: (c: any) => void) {
      const selectEl = this.settingEl.createEl('select');
      const c: any = { selectEl, addOption(value: string, text: string) { selectEl.createEl('option', { value, text }); return c; }, setValue(value: string) { selectEl.value = value; return c; }, onChange(callback: (value: string) => void) { selectEl.onchange = () => callback(selectEl.value); return c; } }; run(c); return this;
    }
    addToggle(run: (c: any) => void) {
      const toggleEl = this.settingEl.createEl('input', { type: 'checkbox' });
      const c: any = { setValue(value: boolean) { toggleEl.value = String(value); return c; }, onChange(callback: (value: boolean) => void) { toggleEl.onchange = () => callback(toggleEl.value === 'true'); return c; } }; run(c); return this;
    }
  }
  const notices: string[] = [], events: string[] = [], saved = new Map<string, any>(), saves: any[] = [], callbacks: string[] = [];
  let waitForPlaces: Promise<void> | undefined, failHours = false, failSave = false, revision = 0;
  let picker: { choices: any[]; choose: (value: any) => unknown } | undefined;
  const places: any[] = [
    { path: 'Book/Sources/A.md', name: 'A', kind: 'shop', locality: '', coordinates: [51, 0], properties: { parking_location: '[[Book/Parking/Car]]' } },
    { path: 'Book/Parking/Car.md', name: 'Car', kind: 'parking', locality: '', coordinates: [51, 0], properties: {} },
  ];
  const context: any = {
    app: {}, root: 'Book', kind: 'real', settings: { distanceUnit: 'miles' }, beginEditing: () => { events.push('acquire'); return () => events.push('release'); },
    store: {
      listPlaces: async () => { if (waitForPlaces) await waitForPlaces; return structuredClone(places); }, listLocalities: async () => [],
      preparations: {
        get: async (id: string) => structuredClone(saved.get(id)),
        save: async (draft: any) => { if (failSave) { failSave = false; throw Error('Temporary draft save failure'); } const value = { ...structuredClone(draft), revision: String(++revision) }; saves.push(value); saved.set(value.id, value); return value; },
      },
      outings: { planningHours: async () => { if (failHours) throw Error('Hours read failed'); return {}; }, create: async () => { throw Error('Preview must never create an outing'); } },
    },
  };
  const helpers = {
    button: (parent: Element, text: string, run: () => unknown, primary = false) => { const b = parent.createEl('button', { text, cls: primary ? 'mod-cta' : '' }); b.onclick = async () => { b.disabled = true; try { await run(); } finally { b.disabled = false; } }; return b; },
    details: (parent: Element, text: string) => { const d = parent.createEl('details'); d.createEl('summary', { text }); return d; },
    errorText: (error: Error) => error.message, PickModal: class { constructor(_context: unknown, private choices: any[], _label: unknown, private choose: (value: any) => unknown) {} open() { picker = { choices: this.choices, choose: this.choose }; } },
  };
  const obsidian = { Modal, Component, Setting, Notice: class { constructor(value: string) { notices.push(value); } } };
  const base = { exports: {} as Record<string, any> };
  const common = { structuredClone, Error, Map, Set, Number, crypto: { randomUUID: () => 'draft-short-trip' } };
  vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/workspace/preparation-modal.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: base, exports: base.exports, ...common,
    require: (id: string) => id === 'obsidian' ? obsidian : id === '../ui' ? helpers : { markInputModal() {} },
  });
  const ui = { exports: {} as Record<string, any> };
  vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/ui/short-trip.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: ui, exports: ui.exports, ...common,
    require: (id: string) => {
      if (id === 'obsidian') return obsidian;
      if (id === '../ui') return helpers;
      if (id.endsWith('preparation-modal')) return base.exports;
      if (id.endsWith('outings/short-trip')) return shortTrip;
      if (id.endsWith('outings/planning')) return planning;
      if (id.endsWith('domain/coordinates')) return { validateCoordinates };
      if (id.endsWith('units')) return units;
      throw Error('Unexpected import ' + id);
    },
  });
  const modal: any = new ui.exports.ShortTripModal(context, (id: string) => { callbacks.push(id); events.push('callback'); assert.equal(events.at(-2), 'release'); });
  return { modal, context, saved, saves, callbacks, events, places, notices,
    chooseSaved: async (path: string) => { const button = all(modal.contentEl).find(el => el.attributes['aria-label'] === 'Saved starting point'); await button.onclick(); assert.ok(picker); const item = picker.choices.find(item => item.path === path); assert.ok(item); await picker.choose(item); },
    deferPlaces: (pending: Promise<void>) => { waitForPlaces = pending; },
    failHours: () => { failHours = true; }, failSave: () => { failSave = true; },
  };
}
async function drain() { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); }
async function open(h: ReturnType<typeof harness>) {
  h.modal.open(); await drain();
  await h.chooseSaved('Book/Parking/Car.md');
  input(h.modal, 'Outing date', '2026-10-19'); input(h.modal, 'Departure time', '09:00'); input(h.modal, 'Time zone', 'UTC');
}
function input(modal: any, label: string, value: string) {
  const el = all(modal.contentEl).find(el => el.attributes['aria-label'] === label); assert.ok(el, label);
  el.value = value; el.onchange?.(); return el;
}
function findButton(modal: any, name: string) { const el = all(modal.contentEl).find(el => el.tag === 'button' && el.textContent === name); assert.ok(el, name); return el; }
async function click(modal: any, name: string) { const el = findButton(modal, name); assert.equal(el.disabled, false); await el.onclick?.(); await drain(); }

test('short-trip preview saves meaningful choices but creates no outing until ordinary preparation is explicitly completed', async () => {
  const h = harness(); await open(h); await h.modal.flush();
  assert.ok(h.saves.length); assert.ok(h.saves.at(-1).data.shortTrip); assert.deepEqual(h.saves.at(-1).data.groups, []);
  assert.equal(findButton(h.modal, 'Use suggestion').disabled, true);
  await click(h.modal, 'Suggest a small journey');
  assert.equal(h.callbacks.length, 0); assert.equal(h.modal.draft.data.groups.length, 0);
  assert.match(all(h.modal.previewEl).map(el => el.textContent).join('\n'), /Drive to Car; walk to A; return to the car/);
  assert.match(all(h.modal.previewEl).map(el => el.textContent).join('\n'), /miles/);
  await click(h.modal, 'Use suggestion');
  assert.deepEqual(h.callbacks, ['draft-short-trip']); assert.equal(h.modal.closed, true);
  const draft = h.saved.get('draft-short-trip'); assert.equal(draft.data.step, 2); assert.equal(draft.data.shortTrip, undefined);
  assert.equal(draft.data.groups[0].parkingPath, 'Book/Parking/Car.md'); assert.equal(draft.data.planning.defaultVisitMinutes, 20);
  assert.match(draft.data.reviewWarnings.join(' '), /60 available/); assert.match(draft.data.reviewWarnings.join(' '), /hours unconfirmed/i);
});

test('a form edit invalidates review immediately and failed preview preserves incomplete text for close recovery', async () => {
  const h = harness(); await open(h); await click(h.modal, 'Suggest a small journey');
  input(h.modal, 'Departure time', ''); assert.equal(findButton(h.modal, 'Use suggestion').disabled, true);
  await click(h.modal, 'Suggest a small journey');
  assert.match(h.modal.status.textContent, /HH:MM/); assert.equal(all(h.modal.contentEl).find(el => el.attributes['aria-label'] === 'Departure time').value, '');
  h.modal.close(); await drain();
  assert.equal(h.saved.get('draft-short-trip').data.shortTrip.form.departureTime, ''); assert.equal(h.callbacks.length, 0);
});

test('fresh changes to parking or hours refuse use and require a new explicit preview', async () => {
  const h = harness(); await open(h); await click(h.modal, 'Suggest a small journey');
  h.places[1].coordinates = [51, 0.001];
  await click(h.modal, 'Use suggestion');
  assert.equal(h.callbacks.length, 0); assert.equal(h.modal.draft.data.groups.length, 0); assert.equal(h.modal.closed, false);
  assert.equal(findButton(h.modal, 'Use suggestion').disabled, true); assert.match(h.modal.status.textContent, /fresh suggestion/);
  await click(h.modal, 'Suggest a small journey'); await click(h.modal, 'Use suggestion');
  assert.equal(h.callbacks.length, 1);
});

test('failed asynchronous reads preserve form choices and never promote a previous comparison', async () => {
  const h = harness(); await open(h); await click(h.modal, 'Suggest a small journey');
  input(h.modal, 'Available minutes', '90'); h.failHours();
  await click(h.modal, 'Suggest a small journey');
  assert.equal(h.callbacks.length, 0); assert.equal(findButton(h.modal, 'Use suggestion').disabled, true);
  assert.match(h.modal.status.textContent, /Hours read failed/); assert.equal(h.modal.options().form.budgetMinutes, '90');
});

test('closing during asynchronous preview invalidates its result and never calls the continuation', async () => {
  const h = harness(); await open(h); let release!: () => void;
  h.deferPlaces(new Promise<void>(resolve => { release = resolve; }));
  const pending = h.modal.preview(); h.modal.onClose(); release(); await pending; await drain();
  assert.equal(h.modal.closed, true); assert.equal(h.callbacks.length, 0); assert.equal(h.modal.comparison, undefined);
  assert.equal(h.saved.get('draft-short-trip').data.shortTrip.form.savedPath, 'Book/Parking/Car.md');
});

test('a handoff save failure restores the short-trip form and leaves it available for a deliberate retry', async () => {
  const h = harness(); await open(h); await h.modal.flush(); await click(h.modal, 'Suggest a small journey');
  h.failSave(); await click(h.modal, 'Use suggestion');
  assert.equal(h.modal.closed, false); assert.equal(h.callbacks.length, 0); assert.ok(h.modal.draft.data.shortTrip);
  assert.equal(h.modal.options().form.savedPath, 'Book/Parking/Car.md'); assert.equal(h.modal.draft.data.groups.length, 0);
  await click(h.modal, 'Use suggestion'); assert.equal(h.callbacks.length, 1);
});

test('the persistent footer keeps Use beside Close and the primary action follows the current review', async () => {
  const h = harness(); await open(h);
  const use = findButton(h.modal, 'Use suggestion'), suggest = findButton(h.modal, 'Suggest a small journey'), close = findButton(h.modal, 'Close');
  assert.ok(use.parent.cls.split(' ').includes('charity-modal-footer'));
  assert.equal(use.parent, close.parent);
  assert.equal(use.parent.children.indexOf(use) + 1, use.parent.children.indexOf(close));
  assert.equal(use.disabled, true); assert.ok(suggest.cls.split(' ').includes('mod-cta'));
  await click(h.modal, 'Suggest a small journey');
  assert.equal(use.disabled, false); assert.equal(suggest.cls.split(' ').includes('mod-cta'), false);
  input(h.modal, 'Available minutes', '90');
  assert.equal(use.disabled, true); assert.ok(suggest.cls.split(' ').includes('mod-cta'));
  await click(h.modal, 'Suggest a small journey');
  h.places[1].coordinates = [51, 0.001]; await click(h.modal, 'Use suggestion');
  assert.equal(use.disabled, true); assert.ok(suggest.cls.split(' ').includes('mod-cta'));
});
