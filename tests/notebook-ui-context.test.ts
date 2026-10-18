import * as units from '../src/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function harness() {
  const notices: string[] = [], opened: { url: string; label: string }[] = [];
  class Element {
    children: Element[] = []; attributes: Record<string, string> = {}; textContent = ''; tag = 'div'; value = ''; rows = 0; type = ''; disabled = false; style = {};
    onclick?: (event?: any) => unknown; onauxclick?: (event: any) => unknown; onchange?: () => unknown; cls = '';
    createEl(tag: string, options: any = {}) { const value = new Element(); value.tag = tag; value.type = options.type ?? ''; value.textContent = options.text ?? ''; value.cls = options.cls ?? ''; value.attributes = { ...options.attr, ...(options.href ? { href: options.href } : {}) }; this.children.push(value); return value; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    createSpan(options: any = {}) { return this.createEl('span', options); }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    getAttribute(key: string) { return this.attributes[key] ?? null; }
    setText(value: string) { this.textContent = value; }
    addClass(value: string) { this.cls += ' ' + value; }
    removeClass(value: string) { this.cls = this.cls.replace(value, ''); }
    empty() { this.children = []; this.textContent = ''; }
    hide() {} show() {} toggle() {}
    querySelector(selector: string): Element | null { return this.children.find(value => value.cls.split(' ').includes(selector.split('.').at(-1)!)) ?? null; }
    querySelectorAll(selector: string): Element[] { return this.children.flatMap(value => [...(selector.split(',').includes(value.tag) ? [value] : []), ...value.querySelectorAll(selector)]); }
  }
  class File { constructor(public path: string) {} }
  class Modal {
    contentEl = new Element(); modalEl = new Element(); titleEl = new Element();
    constructor(public app: unknown) {}
    close() { (this as any).onClose?.(); }
    open() { (this as any).onOpen?.(); }
  }
  class Setting {
    settingEl: Element;
    constructor(parent: Element) { this.settingEl = parent.createDiv(); }
    setName(value: string) { this.settingEl.setAttribute('name', value); return this; }
    setDesc(_value: string) { return this; } setHeading() { return this; }
    addText(run: (control: any) => void) { return this.text('input', run); }
    addTextArea(run: (control: any) => void) { return this.text('textarea', run); }
    private text(tag: string, run: (control: any) => void) {
      const inputEl = this.settingEl.createEl(tag);
      const control: any = { inputEl, setValue(value: string) { inputEl.value = value; return control; }, getValue: () => inputEl.value,
        onChange(callback: (value: string) => void) { inputEl.onchange = () => callback(inputEl.value); return control; } };
      run(control); return this;
    }
    addDropdown(run: (control: any) => void) {
      const selectEl = this.settingEl.createEl('select');
      const control: any = { selectEl, addOption(value: string, label: string) { selectEl.createEl('option', { value, text: label }); return control; }, setValue(value: string) { selectEl.value = value; return control; },
        onChange(callback: (value: string) => void) { selectEl.onchange = () => callback(selectEl.value); return control; } };
      run(control); return this;
    }
    addButton(run: (control: any) => void) {
      const buttonEl = this.settingEl.createEl('button');
      const control: any = { buttonEl, setButtonText(value: string) { buttonEl.textContent = value; return control; }, onClick(callback: () => unknown) { buttonEl.onclick = callback; return control; } };
      run(control); return this;
    }
  }
  class Notice { constructor(message: string) { notices.push(message); } }
  const obsidian = { Modal, SuggestModal: Modal, Component: class {}, Notice, Setting, TFile: File, Platform: { isMobileApp: false } };
  const module = { exports: {} as Record<string, any> };
  const source = fs.readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
    module, exports: module.exports, structuredClone, crypto: { randomUUID: () => 'test-ui-id' },
    require(id: string) { if (id.endsWith('modal-layout')) return { markInputModal() {} };
      if (id === 'obsidian') return obsidian;
      if (id === './units') return units;
      if (id === './storage/markdown') return { localDate: () => '2026-10-17' };
      return {};
    }
  });
  let saves = 0, realSaves = 0, releases = 0, recoveries = 0;
  const context: any = {
    kind: 'examples', root: 'Examples', label: 'Examples', externalActions: 'preview', referencePath: 'Examples/Reference.md',
    app: { vault: { getAbstractFileByPath: (path: string) => path === 'Examples/Reference.md' ? new File(path) : null } },
    settings: { defaultSourceType: 'Charity shop', sourceTypes: ['Charity shop', 'Other'], suggestionKm: 1, distanceUnit: 'km', tileSets: [], areaHints: [] },
    store: { migrationActive: false, rollbackMove: async () => { recoveries++; } },
    host: { examplesAvailable: true, showExamples() {} }, manifest: { version: 'test' },
    openExternal: async (url: string, label: string) => { opened.push({ url, label }); }, openFile: async () => {},
    beginEditing: () => () => releases++, saveSettings: async () => { saves++; },
    runRootOperation: async (run: () => Promise<unknown>, recovery: boolean) => { assert.equal(recovery, true); return run(); },
  };
  const real = { settings: { defaultSourceType: 'Wholesaler' }, saveSettings: async () => { realSaves++; } };
  return { api: module.exports, element: () => new Element(), context, real, opened, notices, counts: () => ({ saves, realSaves, releases, recoveries }) };
}
function all(element: any): any[] { return [element, ...element.children.flatMap(all)]; }

test('example external actions are preview buttons without navigable links and only use the captured gateway', async () => {
  const h = harness(), parent = h.element();
  h.api.external(h.context, parent, 'Drive here', 'https://www.google.com/maps/dir/?api=1');
  const button = parent.children[0]; assert.equal(button.tag, 'button'); assert.equal(button.textContent, 'Preview Drive here');
  assert.equal(button.getAttribute('href'), null);
  await button.onclick?.();
  assert.deepEqual(h.opened, [{ url: 'https://www.google.com/maps/dir/?api=1', label: 'Drive here' }]);
});

test('real links preserve their URL but left and middle clicks go through their own notebook gateway', async () => {
  const h = harness(), parent = h.element(); h.context.kind = 'real'; h.context.externalActions = 'open';
  h.api.external(h.context, parent, 'Website', 'https://example.org/');
  const link = parent.children[0]; assert.equal(link.tag, 'a'); assert.equal(link.getAttribute('href'), 'https://example.org/');
  let prevented = 0, stopped = 0;
  const event = { type: 'click', button: 0, preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
  await link.onclick?.(event);
  await link.onauxclick?.({ ...event, type: 'auxclick', button: 1 });
  await link.onauxclick?.({ ...event, type: 'auxclick', button: 2 });
  assert.equal(prevented, 2); assert.equal(stopped, 2); assert.equal(h.opened.length, 2);
});

test('example Setup renders Reference only and cannot invoke real setup, root changes or browser import', () => {
  const h = harness(); let unsafe = 0;
  h.context.store.setup = () => unsafe++; h.context.openClipperSetup = () => unsafe++;
  const modal = new h.api.SetupModal(h.context); modal.onOpen();
  const text = all(modal.contentEl).map(value => value.textContent).join('\n');
  assert.match(text, /fictional practice data/); assert.match(text, /Reference: setup and capture/);
  assert.doesNotMatch(text, /Create notebook|Use existing notebook|Repair components|Move notebook/);
  assert.equal(unsafe, 0); assert.equal(h.counts().saves, 0);
});

test('practice settings save only their captured settings and retain a custom default in suggestions', async () => {
  const h = harness(), parent = h.element();
  await h.api.renderPracticeSettings(h.context, parent);
  const input = all(parent).find(value => value.getAttribute('aria-label') === 'Practice default source type');
  input.value = 'Practice market'; input.onchange();
  const radius = all(parent).find(value => value.getAttribute('aria-label') === 'Practice nearby locality radius');
  radius.value = '2.5'; radius.onchange();
  await all(parent).find(value => value.tag === 'button' && value.textContent === 'Save practice settings').onclick();
  assert.equal(h.context.settings.defaultSourceType, 'Practice market'); assert.equal(h.context.settings.suggestionKm, 2.5);
  assert.ok(h.context.settings.sourceTypes.includes('Practice market'));
  assert.equal(h.real.settings.defaultSourceType, 'Wholesaler');
  assert.deepEqual(h.counts(), { saves: 1, realSaves: 0, releases: 1, recoveries: 0 });
});

test('failed practice settings save restores settings while retaining the editable form draft', async () => {
  const h = harness(), parent = h.element(); h.context.saveSettings = async () => { throw Error('Interrupted write'); };
  await h.api.renderPracticeSettings(h.context, parent);
  const input = all(parent).find(value => value.getAttribute('aria-label') === 'Practice default source type');
  input.value = 'Unsaved practice type'; input.onchange();
  await all(parent).find(value => value.tag === 'button' && value.textContent === 'Save practice settings').onclick();
  assert.equal(h.context.settings.defaultSourceType, 'Charity shop'); assert.equal(input.value, 'Unsaved practice type');
  assert.match(all(parent).map(value => value.textContent).join('\n'), /not saved:.*Interrupted write/);
  assert.equal(h.counts().releases, 1);
});

test('practice migration recovery is explicit and prevents ordinary settings editing until resolved', async () => {
  const h = harness(), parent = h.element(); h.context.store.migrationActive = true;
  await h.api.renderPracticeSettings(h.context, parent);
  assert.equal(all(parent).some(value => value.textContent === 'Save practice settings'), false);
  await all(parent).find(value => value.textContent === 'Restore previous organisation').onclick();
  assert.deepEqual(h.counts(), { saves: 0, realSaves: 0, releases: 0, recoveries: 1 });
});

test('a synchronous stale-context gateway failure is reported without an unhandled click rejection', async () => {
  const h = harness(), parent = h.element(); h.context.kind = 'real'; h.context.externalActions = 'open';
  h.context.openExternal = () => { throw Error('Notebook context was replaced'); };
  h.api.external(h.context, parent, 'Website', 'https://example.org/');
  await parent.children[0].onclick!({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {} });
  assert.ok(h.notices.some(message => message.includes('Notebook context was replaced')));
});

test('a deleted optional examples tour has no action and normal notebook move stays Reference only', () => {
  const h = harness(), parent = h.element(); h.context.tourPath = 'Examples/Guided tour/Start here.md';
  h.api.renderExamplesEntry(h.context, parent);
  assert.equal(parent.children.length, 0);
  const modal = new h.api.NotebookMoveModal(h.context); modal.onOpen();
  const text = all(modal.contentEl).map(value => value.textContent).join('\n');
  assert.match(text, /Reference: setup and capture/); assert.doesNotMatch(text, /Preview move|New notebook folder/);
  assert.equal(h.counts().saves, 0);
});


test('practice settings keep unsaved fields and validation when an address-rule save rerenders the same owner', async () => {
  const h = harness(), owner = {}, first = h.element();
  await h.api.renderPracticeSettings(h.context, first, owner);
  const field = (el: any, label: string) => all(el).find(value => value.getAttribute('aria-label') === label);
  field(first, 'Practice default source type').value = 'Draft market';
  field(first, 'Practice default source type').onchange();
  field(first, 'Practice nearby locality radius').value = '0';
  field(first, 'Practice nearby locality radius').onchange();
  await all(first).find(value => value.textContent === 'Save practice settings').onclick();
  assert.equal(h.counts().saves, 0);
  assert.equal(h.context.settings.defaultSourceType, 'Charity shop');
  const reloaded = { ...h.context, settings: { ...h.context.settings, sourceTypes: ['Charity shop', 'Other', 'After rule edit'], suggestionKm: 3, areaHints: [{ phrase: 'Fictional arcade' }] } };
  const second = h.element();
  await h.api.renderPracticeSettings(reloaded, second, owner);
  assert.equal(field(second, 'Practice default source type').value, 'Draft market');
  assert.equal(field(second, 'Practice nearby locality radius').value, '0');
  assert.match(field(second, 'Practice source types').value, /After rule edit/);
  assert.match(all(second).map(value => value.textContent).join('\n'), /Use a radius from 0.1 to 50 km/);
  field(second, 'Practice nearby locality radius').value = '2.5';
  field(second, 'Practice nearby locality radius').onchange();
  await all(second).find(value => value.textContent === 'Save practice settings').onclick();
  assert.equal(reloaded.settings.defaultSourceType, 'Draft market');
  assert.equal(reloaded.settings.suggestionKm, 2.5);
  assert.equal(h.context.settings.defaultSourceType, 'Charity shop');
  reloaded.settings.defaultSourceType = 'Later saved default';
  const pristine = h.element();
  await h.api.renderPracticeSettings(reloaded, pristine, owner);
  assert.equal(field(pristine, 'Practice default source type').value, 'Later saved default');
});

test('a failed practice save keeps the draft and error across a context rerender', async () => {
  const h = harness(), owner = {}, first = h.element();
  h.context.saveSettings = async () => { throw Error('State changed elsewhere'); };
  await h.api.renderPracticeSettings(h.context, first, owner);
  const input = all(first).find(value => value.getAttribute('aria-label') === 'Practice default source type');
  input.value = 'Keep this draft'; input.onchange();
  await all(first).find(value => value.textContent === 'Save practice settings').onclick();
  const second = h.element();
  await h.api.renderPracticeSettings({ ...h.context, settings: structuredClone(h.context.settings) }, second, owner);
  assert.equal(all(second).find(value => value.getAttribute('aria-label') === 'Practice default source type').value, 'Keep this draft');
  assert.match(all(second).map(value => value.textContent).join('\n'), /not saved:.*State changed elsewhere/);
  assert.equal(h.context.settings.defaultSourceType, 'Charity shop');
});

test('a dirty practice settings owner keeps an editing lease until save or unload', async () => {
  const h = harness(), callbacks: (() => void)[] = [], owner = { register(callback: () => void) { callbacks.push(callback); } };
  const first = h.element();
  await h.api.renderPracticeSettings(h.context, first, owner);
  const input = all(first).find(value => value.getAttribute('aria-label') === 'Practice default source type');
  input.value = 'Dirty practice type'; input.onchange(); input.onchange();
  assert.equal(h.counts().releases, 0);
  const second = h.element();
  await h.api.renderPracticeSettings(h.context, second, owner);
  assert.equal(callbacks.length, 1);
  await all(second).find(value => value.textContent === 'Save practice settings').onclick();
  assert.equal(h.counts().releases, 1);
  const third = h.element();
  await h.api.renderPracticeSettings(h.context, third, owner);
  const draft = all(third).find(value => value.getAttribute('aria-label') === 'Practice default source type');
  draft.value = 'Unsaved on unload'; draft.onchange();
  callbacks[0]();
  assert.equal(h.counts().releases, 2);
  assert.equal(h.context.settings.defaultSourceType, 'Dirty practice type');
});


test('unloading a practice settings pane during saving holds its editing guard until the write settles', async () => {
  const h = harness(), callbacks: (() => void)[] = [], owner = { register(callback: () => void) { callbacks.push(callback); } };
  let settle!: () => void;
  h.context.saveSettings = () => new Promise<void>(resolve => { settle = resolve; });
  const parent = h.element();
  await h.api.renderPracticeSettings(h.context, parent, owner);
  const input = all(parent).find(value => value.getAttribute('aria-label') === 'Practice default source type');
  input.value = 'Pending save'; input.onchange();
  const saving = all(parent).find(value => value.textContent === 'Save practice settings').onclick();
  callbacks[0]();
  assert.equal(h.counts().releases, 0);
  settle(); await saving;
  assert.equal(h.counts().releases, 1);
  callbacks[0]();
  assert.equal(h.counts().releases, 1);
});


test('detaching an invalid practice context releases its lease but retains the draft for a valid context reload', async () => {
  const h = harness(), callbacks: (() => void)[] = [], owner = { register(callback: () => void) { callbacks.push(callback); } };
  const first = h.element();
  await h.api.renderPracticeSettings(h.context, first, owner);
  const input = all(first).find(value => value.getAttribute('aria-label') === 'Practice default source type');
  input.value = 'Survives context reload'; input.onchange();
  h.api.releasePracticeSettingsOwner(owner);
  h.api.releasePracticeSettingsOwner(owner);
  assert.equal(h.counts().releases, 1);
  const second = h.element();
  await h.api.renderPracticeSettings({ ...h.context, settings: structuredClone(h.context.settings) }, second, owner);
  assert.equal(all(second).find(value => value.getAttribute('aria-label') === 'Practice default source type').value, 'Survives context reload');
  callbacks[0]();
  assert.equal(h.counts().releases, 2);
  assert.equal(h.context.settings.defaultSourceType, 'Charity shop');
});

test('practice unit-only changes preserve the exact stored radius across rerenders and saves', async () => {
  const h = harness(), owner = {}, first = h.element();
  h.context.settings.suggestionKm = 1.23456789012345;
  await h.api.renderPracticeSettings(h.context, first, owner);
  const field = (el: any, label: string) => all(el).find(value => value.getAttribute('aria-label') === label);
  const select = field(first, 'Practice distance units');
  select.value = 'miles'; select.onchange();
  assert.equal(field(first, 'Practice nearby locality radius').value, String(Number(units.distanceFromKm(1.23456789012345, 'miles').toFixed(3))));
  const second = h.element(); await h.api.renderPracticeSettings(h.context, second, owner);
  assert.equal(field(second, 'Practice distance units').value, 'miles');
  await all(second).find(value => value.textContent === 'Save practice settings').onclick();
  assert.equal(h.context.settings.distanceUnit, 'miles');
  assert.equal(h.context.settings.suggestionKm, 1.23456789012345);
  assert.equal(h.counts().realSaves, 0);
});

test('practice radius entry converts miles to metric once and unit switches do not round stored values', async () => {
  const h = harness(), parent = h.element();
  await h.api.renderPracticeSettings(h.context, parent);
  const field = (label: string) => all(parent).find(value => value.getAttribute('aria-label') === label);
  const select = field('Practice distance units'); select.value = 'miles'; select.onchange();
  const radius = field('Practice nearby locality radius'); radius.value = '1.2345'; radius.onchange();
  select.value = 'km'; select.onchange();
  select.value = 'miles'; select.onchange();
  await all(parent).find(value => value.textContent === 'Save practice settings').onclick();
  assert.equal(h.context.settings.suggestionKm, units.distanceToKm(1.2345, 'miles'));
  assert.equal(h.context.settings.distanceUnit, 'miles');
  assert.equal(h.counts().realSaves, 0);
});

test('practice unit save failure restores saved preferences while keeping the new editable choice', async () => {
  const h = harness(), parent = h.element(), owner = {};
  h.context.saveSettings = async () => { throw Error('Unit write interrupted'); };
  await h.api.renderPracticeSettings(h.context, parent, owner);
  const select = all(parent).find(value => value.getAttribute('aria-label') === 'Practice distance units');
  select.value = 'miles'; select.onchange();
  await all(parent).find(value => value.textContent === 'Save practice settings').onclick();
  assert.equal(h.context.settings.distanceUnit, 'km');
  assert.equal(h.context.settings.suggestionKm, 1);
  const next = h.element(); await h.api.renderPracticeSettings(h.context, next, owner);
  assert.equal(all(next).find(value => value.getAttribute('aria-label') === 'Practice distance units').value, 'miles');
  assert.match(all(next).map(value => value.textContent).join('\n'), /Unit write interrupted/);
  assert.equal(h.counts().realSaves, 0);
});
