import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { fixture, newDraft } from './storage-fixtures';
import { defaultPlaceQuery, queryPlaces } from '../src/workspace/place-query';
import { appendNavigation } from '../src/map/navigation';
import { hostOwnsPath } from '../src/map/policy';
import { formatRating } from '../src/domain';

class Element {
  children: Element[] = []; textContent = ''; href = ''; events = new Map<string, () => void>();
  createEl(_tag: string, options: any = {}) { const child = new Element(); child.textContent = options.text ?? ''; child.href = options.href ?? ''; this.children.push(child); return child; }
  createDiv() { return this.createEl('div'); }
  setText(value: string) { this.textContent = value; this.children = []; }
  empty() { this.setText(''); }
  addClass() {}
  addEventListener(name: string, callback: () => void) { this.events.set(name, callback); }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
}
function mapClass(mobile = false) {
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/map/place-map.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, createDiv: () => new Element(),
    require(id: string) {
      if (id === 'obsidian') return { Component: class {}, Platform: { isMobileApp: mobile } };
      if (id === './navigation') return { appendNavigation };
      if (id === './policy') return { hostOwnsPath };
      if (id === '../domain') return { formatRating };
      return {};
    },
  });
  return module.exports.PlaceMap;
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function setup(mobile = false) {
  const f = fixture(); await f.store.setup();
  const area = await f.store.ensureLocality('Exampletown');
  const sourceDraft = newDraft('source'); sourceDraft.coordinates = [12.3, 45.6];
  const parkingDraft = newDraft('parking', 'parking'); parkingDraft.coordinates = [12.31, 45.61];
  const source = await f.store.saveCapture(sourceDraft, area.path, 'Source');
  const parking = await f.store.saveCapture(parkingDraft, area.path, 'Parking');
  await f.store.linkParking(parking.path, source.path);
  const map = Object.create(mapClass(mobile).prototype);
  map.host = { settings: f.settings, getPlaces: () => f.store.listPlaces() };
  map.options = { readOnly: true }; map.markerGeneration = 0; map.disposed = false;
  return { ...f, source, parking, map };
}

test('filtered inline popup resolves shared and preferred parking from all context records', async () => {
  const f = await setup();
  for (const preferred of [false, true]) {
    if (preferred) await f.store.setPreferredParking(f.source.path, f.parking.path);
    const records = await f.store.listPlaces();
    const visible = queryPlaces(records, await f.store.listLocalities(), new Set(), defaultPlaceQuery()).places;
    assert.deepEqual(visible.map(p => p.path), [f.source.path]);
    f.map.setRecords(visible);
    const popup: Element = f.map.popup(visible[0]); await tick();
    assert.match(popup.all().find(el => el.textContent === 'Drive here')!.href, /destination=12.31,45.61/);
    assert.match(popup.all().find(el => el.textContent === 'Walk here')!.href, /destination=12.3,45.6/);
    assert.deepEqual(f.map.records.map((p: any) => p.path), [f.source.path], 'Parking lookup does not change map filtering');
  }
});

test('popup lookup failures offer retry without substituting a shop destination', async () => {
  const f = await setup(), records = await f.store.listPlaces();
  let attempts = 0;
  f.map.host.getPlaces = async () => { if (++attempts === 1) throw Error('Read failed'); return records; };
  const popup: Element = f.map.popup(records.find(p => p.path === f.source.path)); await tick();
  assert.equal(popup.all().some(el => el.textContent === 'Drive here'), false);
  const retry = popup.all().find(el => el.textContent === 'Retry directions'); assert.ok(retry);
  retry.events.get('click')!(); await tick();
  assert.match(popup.all().find(el => el.textContent === 'Drive here')!.href, /destination=12.31,45.61/);
});

test('pending popup lookups cannot revive replaced or closed maps', async () => {
  const f = await setup(), records = await f.store.listPlaces();
  let resolve!: (value: typeof records) => void;
  let calls = 0;
  f.map.host.getPlaces = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first: Element = f.map.popup(records[0]), second: Element = f.map.popup(records[1]);
  await tick(); assert.equal(calls, 1, 'One complete-record lookup serves a marker generation');
  f.map.setRecords([]); resolve(records); await tick();
  assert.equal(first.all().some(el => el.textContent === 'Drive here'), false);
  assert.equal(second.all().some(el => el.textContent === 'Drive here'), false);
  const closed: Element = f.map.popup(records[0]); await tick(); f.map.disposed = true; resolve(records); await tick();
  assert.equal(closed.all().some(el => el.textContent === 'Drive here'), false);
});

test('mobile practice popup filters foreign parking and only previews external actions', async () => {
  const f = await setup(true), records = await f.store.listPlaces();
  const shop = records.find(p => p.path === f.source.path)!;
  const foreign = { ...records.find(p => p.path === f.parking.path)!, path: 'Another notebook/Parking.md' };
  const opened: string[] = [];
  f.map.host = { ...f.map.host, mode: 'examples', ownsPath: (path: string) => f.store.scoped(path), getPlaces: async () => [...records, foreign], openExternal: async (url: string) => { opened.push(url); } };
  const popup: Element = f.map.popup(shop); await tick();
  assert.equal(popup.all().some(el => !!el.href), false);
  popup.all().find(el => el.textContent === 'Preview Drive here')!.events.get('click')!(); await tick();
  assert.equal(opened.length, 1); assert.match(opened[0], /destination=12.31,45.61/);
});

test('unsaved capture previews retain navigation as the draft pin changes, while deleted saved pins never fall back', async () => {
  const f = await setup(), records = await f.store.listPlaces();
  const preview = { ...records[0], path: f.store.root + '/Sources/.review.md', coordinates: [10, 20] };
  f.map.options = { onPick() {}, unsavedPath: preview.path };
  f.map.host.getPlaces = async () => [];
  const first: Element = f.map.popup(preview); await tick();
  assert.match(first.all().find(el => el.textContent === 'Drive here')!.href, /destination=10,20/);
  preview.coordinates = [11, 21]; f.map.setRecords([preview]);
  const changed: Element = f.map.popup(preview); await tick();
  assert.match(changed.all().find(el => el.textContent === 'Drive here')!.href, /destination=11,21/);
  const deleted: Element = f.map.popup(records[0]); await tick();
  assert.equal(deleted.all().some(el => el.textContent === 'Drive here'), false);
  assert.ok(deleted.all().some(el => el.textContent === 'This place is no longer available.'));
  const captureUi = fs.readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');
  assert.match(captureUi, /unsavedPath: this\.previewPath\(\)/);
});
