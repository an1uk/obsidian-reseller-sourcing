import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as query from '../src/workspace/place-query';
import { resolveParking } from '../src/domain';
import { defaultPlanningOptions } from '../src/outings/planning';
import type { OutingPreparation } from '../src/workspace/types';
import type { OutingStop } from '../src/outings/types';

function all(el: any): any[] { return [el, ...el.children.flatMap(all)]; }
function harness(stops: OutingStop[], closedPaths: string[] = [], missingPaths: string[] = []) {
  class Element {
    children: Element[] = []; textContent = ''; tag = 'div'; disabled = false; open = false; value = ''; attributes: Record<string, string> = {}; onclick?: () => unknown;
    createEl(tag: string, options: any = {}) { const el = new Element(); el.tag = tag; el.textContent = options.text ?? ''; el.attributes = options.attr ?? {}; this.children.push(el); return el; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    createSpan(options: any = {}) { return this.createEl('span', options); }
    setAttribute(key: string, value: string) { this.attributes[key] = value; } setText(value: string) { this.textContent = value; }
    empty() { this.children = []; this.textContent = ''; }
  }
  const places = stops.filter(stop => !missingPaths.includes(stop.sourcePath)).map(stop => ({ path: stop.sourcePath, kind: 'shop' as const, name: stop.sourcePath.split('/').at(-1)!, coordinates: [51, 0], locality: '', properties: { shop_closed: closedPaths.includes(stop.sourcePath) } }));
  class PreparationModal {
    draft: any; contentEl = new Element(); titleEl = new Element(); closed = false; owner = {};
    constructor(protected context: unknown, _kind: unknown, seed: OutingPreparation) { this.draft = { data: seed, phase: 'editing', revision: 'saved' }; }
    changed() {} async flush() {} async render() { this.contentEl.empty(); await (this as any).renderStep(); } close() { this.closed = true; }
  }
  const context = { store: { listPlaces: async () => places, listLocalities: async () => [], visits: { list: async () => [] } } };
  const ui = {
    button: (parent: Element, text: string, run: () => unknown) => { const b = parent.createEl('button', { text }); b.onclick = run; return b; },
    details: (parent: Element, text: string) => { const d = parent.createEl('details'); d.createEl('summary', { text }); return d; },
    PickModal: class { open() {} },
  };
  const module = { exports: {} as Record<string, any> };
  vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/workspace/outing-preparation.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, structuredClone, Error, Set, Map, crypto: { randomUUID: () => 'new-group' },
    require: (id: string) => {
      if (id === './preparation-modal') return { PreparationModal };
      if (id === '../ui') return ui;
      if (id === '../domain') return { resolveParking, formatRating: () => 'Not rated' };
      if (id === './place-query') return query;
      if (id === '../storage/markdown') return { localDate: () => '2026-10-20' };
      if (id === 'obsidian') return { Setting: class {} };
      if (id === '../ui/outing-planner') return { OutingPlannerModal: class { open() {} } };
      if (id === '../domain/guards') return { propertyText: () => '' };
      if (id === '../outings/domain') return {};
      if (id === '../map') return {};
      throw Error('Unexpected import ' + id);
    },
  });
  const modal: any = new module.exports.OutingPreparationModal(context);
  const planning = defaultPlanningOptions(); planning.stopOverrides = Object.fromEntries(stops.map(stop => [stop.id, { visitMinutes: 25 }]));
  modal.draft.data = { name: 'Existing outing', groups: [{ id: 'group', parkingPath: '', stops: structuredClone(stops) }], planning, step: 2, unresolved: [], filter: { text: '', area: '', shortlist: false, type: '', view: 'list' } };
  modal.places = places; modal.areas = []; modal.review();
  return modal;
}
function stop(id: string, status: OutingStop['status'] = 'pending'): OutingStop { return { id, sourcePath: 'Book/Sources/' + id + '.md', status, ...(status === 'visited' ? { completedAt: '2026-10-19T10:00:00Z' } : {}) }; }
function button(modal: any, label: string) { return all(modal.contentEl).find(el => el.tag === 'button' && el.textContent === label); }

test('closed visited and skipped sources retain their history without blocking review of remaining stops', () => {
  const visited = stop('Visited', 'visited'), skipped = stop('Skipped', 'skipped'), pending = stop('Available');
  const modal = harness([visited, skipped, pending], [visited.sourcePath, skipped.sourcePath]);
  assert.equal(button(modal, 'Ready to go').disabled, false);
  assert.equal(button(modal, 'Remove unavailable place'), undefined);
  assert.deepEqual(modal.draft.data.groups[0].stops.slice(0, 2), [visited, skipped]);
  assert.equal(all(modal.contentEl).some(el => /permanently closed/.test(el.textContent)), false);
});

test('a closed pending source blocks review until explicitly removed and leaves recorded history intact', async () => {
  const visited = stop('Visited', 'visited'), closed = stop('Closed'), available = stop('Available');
  const modal = harness([visited, closed, available], [closed.sourcePath]);
  modal.draft.data.unresolved = [closed.sourcePath];
  assert.equal(button(modal, 'Ready to go').disabled, true);
  await button(modal, 'Remove unavailable place').onclick();
  assert.equal(button(modal, 'Ready to go').disabled, false);
  assert.deepEqual(modal.draft.data.groups[0].stops, [visited, available]);
  assert.deepEqual(modal.draft.data.unresolved, []); assert.equal(modal.draft.data.planning.stopOverrides[closed.id], undefined);
  assert.equal(modal.draft.data.planning.stopOverrides[visited.id].visitMinutes, 25);
});

test('a missing repeated pending source can be explicitly removed without dropping another source or its duration', async () => {
  const missing = stop('Missing'), available = stop('Available');
  const modal = harness([missing, available], [], [missing.sourcePath]);
  modal.draft.data.unresolved = [missing.sourcePath];
  assert.equal(button(modal, 'Ready to go').disabled, true);
  assert.match(all(modal.contentEl).map(el => el.textContent).join('\n'), /Place no longer exists/);
  await button(modal, 'Remove unavailable place').onclick();
  assert.equal(button(modal, 'Ready to go').disabled, false); assert.deepEqual(modal.draft.data.groups[0].stops, [available]);
  assert.equal(modal.draft.data.planning.stopOverrides[available.id].visitMinutes, 25);
});
