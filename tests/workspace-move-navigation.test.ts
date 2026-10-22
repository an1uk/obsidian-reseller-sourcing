import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { fixture, newDraft } from './storage-fixtures';
import * as viewState from '../src/workspace/view-state';
import { defaultPlaceQuery } from '../src/workspace/place-query';
import type { WorkspaceRoute, WorkspaceViewState } from '../src/workspace/types';

test('Back follows a reviewed area move and keeps the place scroll and section state', async () => {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft('source'), area.path, 'Source');
  const parking = await f.store.saveCapture(newDraft('parking', 'parking'), area.path, 'Parking');
  const events = new Map<string, (...args: any[]) => void>();
  class ItemView {
    app: any; contentEl: any; containerEl: any;
    constructor() {
      this.app = { vault: { on: (name: string, callback: any) => { events.set(name, callback); return {}; } }, workspace: { requestSaveLayout() {} } };
      this.contentEl = { win: { clearTimeout() {}, setTimeout() {} } }; this.containerEl = { ownerDocument: {} };
    }
    registerDomEvent() {} registerEvent() {}
  }
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/workspace/view.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, structuredClone,
    require(id: string) { return id === './view-state' ? viewState : id === 'obsidian' ? { ItemView, Component: class { load() {} }, Platform: { isMobileApp: false } } : {}; },
  });
  const view = new module.exports.SourcingWorkspace({}, {});
  view.state.root = f.store.root; view.remember = () => {}; view.render = async () => {};
  await view.onOpen();
  const previous = { screen: 'place', path: source.path, section: 'details' };
  await view.navigate(previous); await view.navigate({ screen: 'place', path: parking.path });
  view.state.positions = { [JSON.stringify(previous)]: { scroll: 125, expanded: ['Contacts'], focus: 'place:' + source.path } };
  const oldSourcePath = source.path;
  const selection = { town: 'Exampletown', locality: 'Riverside' };
  await f.store.changePlaceArea(source.path, selection, await f.store.previewPlaceAreaChange(source.path, selection));
  const moved = (await f.store.listPlaces()).find(p => p.kind === 'shop')!;
  events.get('rename')!({ path: moved.path }, oldSourcePath);
  await view.navigate(view.history.pop(), true);
  assert.equal(view.state.route.path, moved.path); assert.equal(view.state.route.section, 'details');
  assert.ok(f.vault.getAbstractFileByPath(view.state.route.path));
  assert.deepEqual(view.state.positions[JSON.stringify(view.state.route)], { scroll: 125, expanded: ['Contacts'], focus: 'place:' + moved.path });
});

test('whole notebook renames remap history and restoration keys within the precise old root', () => {
  const old = 'Notebook', next = 'Moved notebook';
  const route: WorkspaceRoute = { screen: 'place', path: old + '/Places/Source.md', section: 'visits' };
  const history: WorkspaceRoute[] = [{ screen: 'home' }, { screen: 'outing', path: old + '/Outings/Outing.md' }, { screen: 'place', path: old + ' sibling/Source.md' }];
  const state: WorkspaceViewState = {
    root: next, route, places: { query: '', area: old + '/Places/Town/Area.md', kind: 'shop', shortlist: false, view: 'map', criteria: { ...defaultPlaceQuery(), area: old + '/Places/Town/Area.md', nearby: { reference: { kind: 'place', path: route.path }, radiusKm: 5 } } },
    history: { expandedVisits: { [old + '/Visits/Visit.md']: true }, insights: { sourcePath: route.path, areaPath: old + '/Places/Town/Area.md' } },
    positions: { [JSON.stringify(route)]: { scroll: 20, focus: 'place:' + route.path }, legacy: { scroll: 1 } },
  };
  viewState.remapWorkspacePaths(state, history, old, next, true);
  assert.equal(route.path, next + '/Places/Source.md');
  assert.equal((history[1] as any).path, next + '/Outings/Outing.md');
  assert.equal((history[2] as any).path, old + ' sibling/Source.md');
  assert.equal(state.places!.criteria!.area, next + '/Places/Town/Area.md');
  assert.equal((state.places!.criteria!.nearby!.reference as any).path, route.path);
  assert.equal(state.history!.insights!.sourcePath, route.path);
  assert.deepEqual(state.history!.expandedVisits, { [next + '/Visits/Visit.md']: true });
  assert.equal(state.positions![JSON.stringify(route)].focus, 'place:' + route.path);
  assert.equal(state.positions!.legacy.scroll, 1);
});
