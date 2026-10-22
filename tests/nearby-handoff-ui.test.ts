import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as query from '../src/workspace/place-query';
import { fixture, newDraft } from './storage-fixtures';
import type { OutingPreparation, PreparationDraft } from '../src/workspace/types';

test('current-location browsing carries live criteria into an outing while draft persistence stays private', async () => {
  const f = fixture(); await f.store.setup();
  const capture = newDraft(); capture.coordinates = [12.3456789, 45.6789012];
  const source = await f.store.saveCapture(capture, await f.store.ensureLocality('Exampletown').then(a => a.path), 'Nearby source');
  const places = await f.store.listPlaces(), areas = await f.store.listLocalities();
  const criteria: query.PlaceQuery = { ...query.defaultPlaceQuery(), nearby: { reference: { kind: 'current', coordinates: [...capture.coordinates] }, radiusKm: 5 } };
  const sort: query.PlaceSort = { key: 'distance', direction: 'asc' };
  assert.deepEqual(query.queryPlaces(places, areas, new Set(), criteria, sort).places.map(p => p.path), [source.path]);

  let opened: any;
  const element = () => ({ win: { clearTimeout }, inert: false, setAttribute() {}, ownerDocument: {}, createEl() {}, createDiv() {} });
  class Modal {
    contentEl = element(); modalEl = element();
    constructor(public app: unknown) {}
    open() { opened = this; }
  }
  class Component { load() {} unload() {} }
  class ItemView { constructor(public leaf: any) {} }
  let actions: any;
  const cache = new Map<string, any>();
  const load = (path: string): any => {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} as Record<string, any> };
    vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/workspace/' + path + '.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
      module, exports: module.exports, structuredClone, crypto, Date, Map, Set,
      require(id: string) {
        if (id === '../ui') return { button() {} };
        if (id === 'obsidian') return { Modal, Component, ItemView };
        if (id === './place-query') return query;
        if (id === './preparation-modal') return load('preparation-modal');
        if (id === './outing-preparation') return load('outing-preparation');
        if (id === './places-browser') return { renderPlacesBrowser: async (_context: unknown, _owner: unknown, _el: unknown, _state: unknown, received: unknown) => { actions = received; } };
        return {};
      },
    });
    cache.set(path, module.exports); return module.exports;
  };
  const context = { app: f.app, store: f.store, root: f.store.root, kind: 'real' };
  const workspace = new (load('view').SourcingWorkspace)({}, {});
  workspace.context = context; workspace.body = element();
  await workspace.renderPlaces(workspace.body);
  actions.plan(criteria, sort);
  assert.ok(opened, 'The actual workspace action opens the outing preparation');
  const data = opened.seed as OutingPreparation;
  assert.equal(data.placeQuery?.nearby?.reference.kind, 'current');
  assert.deepEqual(query.queryPlaces(places, areas, new Set(), data.placeQuery!, data.placeSort).places.map(p => p.path), [source.path]);
  assert.equal(data.groups.length, 0, 'Handoff does not select stops automatically');

  // Editing the outing query must not mutate the place browser's live criteria.
  data.placeQuery!.text = places[0]!.name;
  assert.equal(criteria.text, '');
  assert.notEqual(data.placeSort, sort);

  const draft: PreparationDraft<OutingPreparation> = {
    schema: 1, id: crypto.randomUUID(), kind: 'outing', root: f.store.root,
    updatedAt: new Date().toISOString(), phase: 'editing', deferred: false, revision: '', data,
  };
  opened.draft = draft;
  await opened.flush();
  assert.equal(opened.draft.data.placeQuery.nearby.reference.kind, 'current', 'Autosaving retains the live session reference');
  assert.equal(query.queryPlaces(places, areas, new Set(), opened.draft.data.placeQuery).places.length, 1);
  const file = f.vault.getAbstractFileByPath(f.store.paths.drafts + '/' + draft.id + '.json')!;
  const raw = await f.vault.read(file as any);
  assert.equal(raw.includes('12.3456789'), false);
  assert.equal(raw.includes('45.6789012'), false);
  const reopened = await f.store.preparations.get(draft.id);
  assert.equal(reopened?.kind, 'outing');
  if (reopened?.kind !== 'outing') throw Error('Expected outing draft');
  assert.equal(reopened.data.placeQuery?.nearby?.reference.kind, 'unavailable');
  assert.equal(query.queryPlaces(places, areas, new Set(), reopened.data.placeQuery!).nearbyUnavailable, true);
});
