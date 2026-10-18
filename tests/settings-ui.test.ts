import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { DEFAULT_SETTINGS } from '../src/types';
import * as units from '../src/units';

function harness() {
  const notices: string[] = [], persisted: unknown[] = [];
  let updates = 0, leases = 0, releases = 0, ids = 0, fail = false, hold: Promise<void> | undefined;
  class Element {
    id = ''; value = ''; rows = 0; type = ''; step = ''; min = ''; max = '';
    children: Element[] = []; attributes: Record<string, string> = {};
    onchange?: () => void;
    createEl(_tag: string, options: any = {}) { const value = new Element(); value.id = options.attr?.id ?? ''; value.value = options.value ?? ''; this.children.push(value); return value; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
  }
  class Setting {
    controlEl = new Element(); input?: Element; select?: Element; action?: () => void; name = '';
    setName(name: string) { this.name = name; return this; }
    addText(run: (control: any) => void) { this.input = new Element(); const control = { inputEl: this.input, setValue: (value: string) => { this.input!.value = value; return control; }, getValue: () => this.input!.value }; run(control); return this; }
    addTextArea(run: (control: any) => void) { return this.addText(run); }
    addDropdown(run: (control: any) => void) {
      this.select = new Element(); const control = { selectEl: this.select, addOption: () => control, setValue: (value: string) => { this.select!.value = value; return control; }, onChange: (change: (value: string) => void) => { this.select!.onchange = () => change(this.select!.value); return control; } }; run(control); return this;
    }
    addButton(run: (control: any) => void) { const control = { setButtonText: () => control, setCta: () => control, onClick: (action: () => void) => { this.action = action; return control; } }; run(control); return this; }
  }
  class Tab { constructor(_app: unknown, _plugin: unknown) {} update() { updates++; } }
  const plugin: any = {
    settings: structuredClone(DEFAULT_SETTINGS), manifest: { version: '0.11.1' }, basesReady: true, examplesAvailable: false, store: { migrationActive: false },
    beginEditing: () => { leases++; return () => releases++; },
    saveSettings: async () => { persisted.push(structuredClone(plugin.settings)); if (hold) await hold; if (fail) throw Error('Disk unavailable'); },
  };
  const module = { exports: {} as any };
  const source = fs.readFileSync(new URL('../src/ui/settings.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
    module, exports: module.exports, Set, Number, Promise, crypto: { randomUUID: () => 'setting-' + (++ids) },
    require(id: string) {
      if (id === 'obsidian') return { PluginSettingTab: Tab, Platform: { isMobileApp: false }, Notice: class { constructor(message: string) { notices.push(message); } } };
      if (id === '../units') return units;
      if (id === '../domain') return { validateRootPath: (value: string) => { if (value.includes('..')) throw Error('Invalid folder'); return value.trim(); } };
      if (id === '../capture') return { CLIPPER_TEMPLATE_RELEASE: '0.4.2' };
      if (id === '../ui') return { errorText: (value: Error) => value.message };
      throw Error('Unexpected settings import ' + id);
    },
  });
  const tab = new module.exports.SourcingSettings({}, plugin);
  const definitions = () => tab.getSettingDefinitions().flatMap((group: any) => group.items);
  const render = (name: string) => { const definition = definitions().find((item: any) => item.name === name); assert.ok(definition, name); const row = new Setting(); definition.render(row); return row; };
  return { tab, plugin, definitions, render, notices, persisted, fail: (value = true) => fail = value, hold: (value?: Promise<void>) => hold = value, counts: () => ({ updates, leases, releases, ids }) };
}

test('searchable settings definitions have functional headings and indexing has no side effects', () => {
  const h = harness(), before = structuredClone(h.plugin.settings);
  const groups = h.tab.getSettingDefinitions(); h.tab.getSettingDefinitions();
  assert.deepEqual(Array.from(groups.map((group: any) => group.heading)), ['Notebook', 'Capture and travel defaults', 'Map backgrounds', 'Setup and information']);
  for (const name of ['Default source type', 'Distance units', 'Nearby locality radius', 'Web Clipper templates', 'About and licences']) assert.ok(h.definitions().some((row: any) => row.name === name));
  assert.deepEqual(h.plugin.settings, before); assert.deepEqual(h.counts(), { updates: 0, leases: 0, releases: 0, ids: 0 }); assert.equal(h.persisted.length, 0);
});

test('failed settings changes roll back values and visible controls while later saves remain usable', async () => {
  const h = harness(); h.fail();
  const folder = h.render('Notebook folder'); folder.input!.value = 'Other notebook'; folder.input!.onchange!(); await h.tab.saves;
  assert.equal(h.plugin.settings.root, DEFAULT_SETTINGS.root); assert.equal(folder.input!.value, DEFAULT_SETTINGS.root);
  const types = h.render('Source types'); types.input!.value = 'Rag house\nMarket'; types.input!.onchange!(); await h.tab.saves;
  assert.deepEqual(h.plugin.settings.sourceTypes, DEFAULT_SETTINGS.sourceTypes); assert.equal(types.input!.value, DEFAULT_SETTINGS.sourceTypes.join('\n'));
  const units = h.render('Distance units'); units.select!.value = 'km'; units.select!.onchange!(); await h.tab.saves;
  assert.equal(h.plugin.settings.distanceUnit, 'miles'); assert.equal(units.select!.value, 'miles'); assert.equal(h.counts().updates, 0);
  h.fail(false); units.select!.value = 'km'; units.select!.onchange!(); await h.tab.saves;
  assert.equal(h.plugin.settings.distanceUnit, 'km'); assert.equal(h.counts().updates, 1); assert.equal(h.counts().leases, h.counts().releases); assert.equal(h.notices.length, 3);
});

test('queued map setting changes merge against current values and preserve unrelated settings', async () => {
  const h = harness(); h.plugin.settings.tileSets = [{ id: 'custom', name: 'Original', lightTiles: '', darkTiles: '' }];
  let finish = () => {}; h.hold(new Promise<void>(resolve => finish = resolve));
  const name = h.render('Name — Original'), light = h.render('Light tiles — Original');
  name.input!.value = 'Reviewed'; name.input!.onchange!(); light.input!.value = 'https://example.invalid/light'; light.input!.onchange!();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.persisted.length, 1);
  finish(); await h.tab.saves;
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.tileSets)), [{ id: 'custom', name: 'Reviewed', lightTiles: 'https://example.invalid/light', darkTiles: '' }]);
  assert.equal(h.plugin.settings.defaultSourceType, 'Charity shop'); assert.equal(h.counts().leases, h.counts().releases);
});

test('configured custom default stays selectable and invalid source types never save', async () => {
  const h = harness(); h.plugin.settings.defaultSourceType = 'Estate clearance'; h.plugin.settings.sourceTypes = ['Market'];
  const row = h.render('Default source type'); assert.ok(row.controlEl.children[0]!.children.some(item => item.value === 'Estate clearance'));
  row.input!.value = ''; row.input!.onchange!(); await h.tab.saves;
  assert.equal(row.input!.value, 'Estate clearance'); assert.equal(h.persisted.length, 0);
});
