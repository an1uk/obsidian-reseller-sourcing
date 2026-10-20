import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as domain from '../src/domain';
import * as policy from '../src/map/policy';
import * as detail from '../src/map/detail';
import type { PlaceRecord } from '../src/types';

class Element {
  children: Element[] = []; parent?: Element; tag = 'div'; cls = ''; text = '';
  action?: () => unknown;
  createEl(tag: string, options: { text?: string; cls?: string } = {}) {
    const child = new Element(); child.tag = tag; child.cls = options.cls ?? ''; child.text = options.text ?? ''; child.parent = this; this.children.push(child); return child;
  }
  createDiv(options: string | { cls?: string } = '') { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
  empty() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelector(selector: string): Element | undefined { const cls = selector.split('.').at(-1)!; return this.children.find(child => child.cls.split(' ').includes(cls)); }
}
function record(name: string, kind: 'shop' | 'parking' = 'shop', coordinates: PlaceRecord['coordinates'] = [1, 2]): PlaceRecord {
  return { path: 'Notebook/Places/' + name + '.md', name, kind, coordinates, locality: '', properties: { rating: 3.5, comments: 'Good knitwear' } };
}
function harness(initial: PlaceRecord[]) {
  let records = initial;
  class File { constructor(readonly path: string) {} }
  const opened: { path: string; mode: string }[] = [];
  const mounts: { records: PlaceRecord[]; focusPath: string }[] = [], updates: PlaceRecord[][] = [], disposed: unknown[] = [], previews: string[] = [];
  const map = { setRecords(value: PlaceRecord[]) { updates.push(value); } };
  const owner = { removeChild(value: unknown) { disposed.push(value); } };
  const context = { app: {
    vault: { getAbstractFileByPath: (path: string) => records.some(record => record.path === path) ? new File(path) : null },
    workspace: { getLeaf: () => ({ openFile: async (file: File, options: { state: { mode: string } }) => { opened.push({ path: file.path, mode: options.state.mode }); } }) },
  }, kind: 'real', store: { listPlaces: async () => records }, mapHost: { settings: { root: 'Notebook' }, ownsPath: (path: string) => path.startsWith('Notebook/') && !path.startsWith('Notebook/Examples/') },
    openExternal: async (url: string) => { previews.push(url); } };
  const module = { exports: {} as { renderPlaceSummary: (...args: any[]) => Promise<typeof map | undefined> } };
  const code = transformSync(fs.readFileSync(new URL('../src/ui/place-summary.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(id: string) {
      if (id === 'obsidian') return { TFile: File };
      if (id === '../domain') return domain;
      if (id === '../map/detail') return detail;
      if (id === '../map/policy') return policy;
      if (id === '../map') return { mountPlaceMap(_owner: unknown, parent: Element, _host: unknown, options: typeof mounts[number]) { mounts.push(options); parent.createDiv('map-canvas'); return map; } };
      if (id === '../ui') return {
        button(parent: Element, text: string, action: () => unknown) { const b = parent.createEl('button', { text }); b.action = action; return b; },
        external(_context: unknown, parent: Element, text: string, url: string) { if (url) { const a = parent.createEl('a', { text }); a.action = () => context.openExternal(url); } },
        pickPlace() {}, VisitModal: class { open() {} },
        propertyText(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; },
      };
      throw Error('Unexpected import ' + id);
    },
  });
  return { api: module.exports, context, owner, mounts, updates, disposed, map, previews, opened, setRecords(value: PlaceRecord[]) { records = value; } };
}
const all = (el: Element): Element[] => [el, ...el.children.flatMap(all)];

test('inline place summary renders its map before compact actions without duplicating the note title', async () => {
  const shop = record('Selected'), parking = record('Linked parking', 'parking'), unrelated = record('Other');
  parking.properties.parking_for = ['[[' + shop.path.replace(/\.md$/, '') + ']]'];
  const h = harness([shop, parking, unrelated]), el = new Element();
  await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path, { onEdit() {}, onOpenWorkspace() {} });
  assert.equal(h.mounts.length, 1);
  assert.deepEqual(h.mounts[0].records.map(p => p.name), ['Selected', 'Linked parking']);
  const root = el.children[0];
  assert.equal(root.children[0].cls, 'charity-place-summary-map');
  assert.equal(root.children[1].cls, 'charity-place-summary-content');
  assert.equal(all(el).some(child => /^h[1-6]$/.test(child.tag)), false);
  assert.ok(all(el).some(child => child.text === 'Drive to parking'));
  assert.ok(all(el).some(child => child.text === 'Edit place'));
  assert.ok(all(el).some(child => child.text === domain.formatRating(3.5)));
});

test('unknown coordinates never mount a map centred on another place and offer a location editor', async () => {
  const shop = record('No pin', 'shop', null), parking = record('Nearby parking', 'parking');
  parking.properties.parking_for = ['[[' + shop.path.replace(/\.md$/, '') + ']]'];
  const h = harness([shop, parking]), el = new Element(), edits: unknown[] = [];
  await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path, { showActions: false, onEdit: (section: unknown) => { edits.push(section); } });
  assert.equal(h.mounts.length, 0);
  assert.ok(all(el).some(child => child.text === 'Location not set'));
  await all(el).find(child => child.text === 'Add location')?.action?.();
  assert.deepEqual(edits, ['location']);
});

test('note map refresh reuses its camera and disposes the map when coordinates or record disappear', async () => {
  const shop = record('Selected'), h = harness([shop]), el = new Element();
  const first = await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path);
  shop.coordinates = [3, 4];
  await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path, { existingMap: first });
  assert.equal(h.mounts.length, 1); assert.equal(h.updates.length, 1);
  shop.coordinates = null;
  const missing = await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path, { existingMap: first });
  assert.equal(missing, undefined); assert.deepEqual(h.disposed, [h.map]);
  assert.ok(all(el).some(child => child.text === 'Location not set'));
  h.setRecords([]);
  await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path);
  assert.ok(all(el).some(child => child.text.startsWith('This place is unavailable')));
});

test('stale asynchronous note rendering cannot mount or replace a newer pane', async () => {
  const shop = record('Selected'), h = harness([shop]), el = new Element();
  await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path, { isCurrent: () => false });
  assert.equal(el.children.length, 0); assert.equal(h.mounts.length, 0);
});

test('detail maps preserve context isolation and include only genuine parking associations', () => {
  const shop = record('Selected'), parking = record('Shared parking', 'parking'), wrong = record('Not related', 'parking');
  parking.properties.parking_for = ['[[' + shop.path.replace(/\.md$/, '') + ']]'];
  const practice = { ...record('Practice', 'parking'), path: 'Notebook/Examples/Places/Practice.md', properties: { parking_for: ['[[' + shop.path.replace(/\.md$/, '') + ']]'] } };
  const h = harness([shop, parking, wrong, practice]);
  assert.deepEqual(detail.detailMapPlaces(shop, [shop, parking, wrong, practice], h.context.mapHost).map(place => place.name), ['Selected', 'Shared parking']);
  assert.deepEqual(detail.detailMapPlaces(parking, [shop, parking, wrong], h.context.mapHost).map(place => place.name), ['Selected', 'Shared parking']);
});

test('Edit notes opens the exact existing Markdown in source mode and never recreates a deleted note', async () => {
  const shop = record('Selected'), h = harness([shop]), el = new Element();
  await h.api.renderPlaceSummary(h.context, h.owner, el, shop.path);
  const action = all(el).find(child => child.text === 'Edit notes')?.action;
  assert.ok(action);
  await action();
  assert.deepEqual(h.opened, [{ path: shop.path, mode: 'source' }]);
  h.setRecords([]);
  await assert.rejects(async () => action(), /no longer exists/);
  assert.equal(h.opened.length, 1);
});
