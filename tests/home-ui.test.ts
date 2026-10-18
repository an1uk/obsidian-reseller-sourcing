import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function harness(kind: 'real' | 'examples' = 'real') {
  class Element {
    children: Element[] = []; parent?: Element; tag = 'div'; textContent = ''; cls = ''; attributes: Record<string, string> = {}; disabled = false; isConnected = true; onclick?: () => unknown;
    createEl(tag: string, options: any = {}) { const value = new Element(); Object.assign(value, { tag, parent: this, textContent: options.text ?? '', cls: options.cls ?? '', attributes: options.attr ?? {} }); this.children.push(value); return value; }
    createDiv(options: any = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
    addClass(...values: string[]) { this.cls += ' ' + values.join(' '); }
    setText(value: string) { this.textContent = value; }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    empty() { this.children = []; }
  }
  const calls = { opened: [] as string[], newPlaces: [] as string[], newOutings: 0, captures: 0, templates: 0, setups: 0, realHomes: 0, resolved: [] as string[], visits: [] as any[], outingVisits: [] as any[], pickers: [] as any[], recoveries: [] as any[], errors: [] as string[], modals: [] as any[], inspected: 0 };
  class Modal {
    contentEl = new Element(); titleEl = new Element(); modalEl = new Element(); closed = false;
    constructor(public app: unknown) {}
    open() { calls.modals.push(this); (this as any).onOpen?.(); }
    close() { this.closed = true; (this as any).onClose?.(); }
  }
  class TFile {}
  const root = kind === 'examples' ? 'Notebook/Examples' : 'Notebook';
  const source = { kind: 'shop', name: 'Second Sunrise', path: root + '/Sources/Second Sunrise.md', properties: {} };
  let overview: any = { root, places: [source], sources: [source], sourcesAvailable: true, captures: 0, outings: [], others: [], warnings: [] };
  let blocked: Promise<void> | undefined;
  const context: any = { kind, root, app: { vault: { getAbstractFileByPath: () => new TFile() } }, referencePath: root + '/Reference.md', host: { contextForPath: async (path: string) => { calls.resolved.push(path); return { home: async () => { calls.realHomes++; } }; } },
    openFile: async (path: string) => { calls.opened.push(path); }, newPlace: (value: string) => { calls.newPlaces.push(value); }, newOuting: () => { calls.newOutings++; }, reviewCaptures: async () => { calls.captures++; }, openClipperSetup: () => { calls.templates++; }, store: { visits: { inspectSavedWork: async () => ({ operations: [{ id: 'operation', sourcePath: source.path }], warnings: [], drafts: [] }) } } };
  const module = { exports: {} as Record<string, any> };
  const code = transformSync(fs.readFileSync(new URL('../src/ui/home.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Map, Promise, Error, require(id: string) { if (id.endsWith('modal-layout')) return { markInputModal() {} };
    if (id === 'obsidian') return { Modal, TFile };
    if (id === '../home/overview') return { inspectHome: async () => { calls.inspected++; if (blocked) await blocked; return structuredClone(overview); } };
    if (id === '../ui') return {
      button: (parent: Element, text: string, run: () => unknown, primary = false) => { const value = parent.createEl('button', { text, cls: primary ? 'mod-cta' : '' }); value.onclick = async () => { try { await run(); } catch (error: any) { calls.errors.push(error.message); } }; return value; },
      details: (parent: Element, text: string) => { const value = parent.createEl('details'); value.createEl('summary', { text }); return value; },
      propertyText: (value: unknown, fallback = '') => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback, errorText: (error: any) => error.message,
      pickPlace: (_context: unknown, values: unknown[], choose: (value: unknown) => unknown, title: string) => { calls.pickers.push({ context: _context, values, choose, title }); },
      renderContextBanner: (_context: any, el: Element) => { if (_context.kind === 'examples') el.createEl('p', { text: 'Fictional examples' }); },
      renderExamplesEntry: (_context: unknown, el: Element) => el.createEl('button', { text: 'Examples' }),
      SetupModal: class { open() { calls.setups++; } },
      VisitModal: class { constructor(_context: unknown, sourcePath: string, visitPath?: string) { calls.visits.push({ context: _context, sourcePath, visitPath }); } open() {} },
    };
    if (id === './outings') return { OutingVisitModal: class { constructor(_context: unknown, path: string, stopId: string) { calls.outingVisits.push({ context: _context, path, stopId }); } open() {} } };
    if (id === './visits') return { renderRecoveryOperation: (_context: unknown, _el: unknown, operation: unknown) => { calls.recoveries.push({ context: _context, operation }); } };
    throw Error('Unexpected module ' + id);
  } });
  return { api: module.exports, calls, context, source, element: () => new Element(), set: (next: any) => { overview = { ...overview, ...next }; }, get: () => overview, defer: (value: Promise<void>) => { blocked = value; } };
}
function all(el: any): any[] { return [el, ...el.children.flatMap(all)]; }
function text(el: any): string { return all(el).map(value => value.textContent).join('\n'); }
function button(el: any, label: string) { const value = all(el).find(value => value.tag === 'button' && value.textContent === label); assert.ok(value, label); return value; }
async function settle() { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); }
const work = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, id: 'saved', path: 'Notebook/System/Draft.json', label: 'Continue saved visit', updatedAt: '2026-10-18T10:00:00Z', revision: 'reviewed', sourcePath: 'Notebook/Sources/Second Sunrise.md', sourceName: 'Second Sunrise', ...extra });

test('Home keeps its three everyday tasks in a stable order without initial actions or full tables', async () => {
  const h = harness(), el = h.element(); await h.api.renderHome(h.context, {}, el, () => true);
  const tasks = all(el).find(value => value.cls === 'charity-home-tasks');
  assert.deepEqual(all(tasks).filter(value => value.tag === 'button').map(value => value.textContent), ['Record a visit', 'Plan an outing', 'Find sources']);
  assert.equal(all(el).some(value => value.tag === 'table'), false); assert.match(text(el), /Browse notebook/); assert.match(text(el), /Help and notebook tools/);
  assert.deepEqual(h.calls.opened, []); assert.deepEqual(h.calls.newPlaces, []); assert.equal(h.calls.newOutings, 0); assert.equal(h.calls.visits.length, 0); assert.equal(h.calls.recoveries.length, 0);
  await button(el, 'Plan an outing').onclick(); assert.equal(h.calls.newOutings, 1);
});
test('empty Home leads with first source and source-read failures keep tasks and actionable review warnings', async () => {
  const h = harness(), el = h.element(); h.set({ sources: [], places: [] }); await h.api.renderHome(h.context, {}, el, () => true);
  assert.match(text(el), /Start with one source/); await button(el, 'Add your first source').onclick(); assert.deepEqual(h.calls.newPlaces, ['shop']);
  const failed = h.element(); h.set({ sourcesAvailable: false, warnings: [{ path: 'Notebook/System/broken.json', message: 'Saved details could not be read.' }] });
  await h.api.renderHome(h.context, {}, failed, () => true); assert.doesNotMatch(text(failed), /Start with one source/); assert.match(text(failed), /Record a visit/); assert.match(text(failed), /Saved details could not be read/);
  await button(failed, 'Open saved record for review').onclick(); assert.deepEqual(h.calls.opened, ['Notebook/System/broken.json']);
});
test('saved work stays idle until chosen, then resume revalidates the identity and reviewed revision', async () => {
  const h = harness(), el = h.element(); h.set({ primary: work('visit-draft'), others: [work('active-outing', { id: 'active', outingPath: 'Notebook/Outings/Active.md' })] });
  await h.api.renderHome(h.context, {}, el, () => true); assert.equal(h.calls.visits.length, 0); assert.match(text(el), /Other unfinished work \(1\)/);
  await button(el, 'Resume visit').onclick(); assert.equal(h.calls.visits.length, 1); assert.equal(h.calls.visits[0].sourcePath, h.source.path);
  h.set({ primary: work('visit-draft', { revision: 'changed' }) }); await button(el, 'Resume visit').onclick();
  assert.equal(h.calls.visits.length, 1); assert.match(h.calls.errors.at(-1)!, /saved work changed/);
});
test('outing drafts and interrupted saves route through their existing reviewed controls', async () => {
  const h = harness(), draft = h.element(); h.set({ primary: work('outing-draft', { outingPath: 'Notebook/Outings/Active.md', stopId: 'stop' }) });
  await h.api.renderHome(h.context, {}, draft, () => true); await button(draft, 'Resume visit').onclick();
  assert.equal(h.calls.outingVisits[0].path, 'Notebook/Outings/Active.md'); assert.equal(h.calls.outingVisits[0].stopId, 'stop');
  const recovery = h.element(); h.set({ primary: work('visit-operation', { id: 'operation', operationId: 'operation' }) }); await h.api.renderHome(h.context, {}, recovery, () => true);
  assert.equal(h.calls.recoveries.length, 0); await button(recovery, 'Review interrupted save').onclick(); await settle(); assert.equal(h.calls.recoveries.length, 1);
  assert.equal(h.calls.recoveries[0].operation.id, 'operation'); assert.deepEqual(h.calls.opened, []);
});
test('real and Examples Home use their own browsing roots and only real Home offers setup tools', async () => {
  const real = harness(), examples = harness('examples'), a = real.element(), b = examples.element();
  await real.api.renderHome(real.context, {}, a, () => true); await examples.api.renderHome(examples.context, {}, b, () => true);
  assert.match(text(a), /Reseller sourcing/); assert.match(text(b), /Examples Home/); assert.match(text(b), /Examples: fictional practice data/);
  await button(a, 'Find sources').onclick(); await button(b, 'Find sources').onclick();
  assert.deepEqual(real.calls.opened, ['Notebook/Sources.md']); assert.deepEqual(examples.calls.opened, ['Notebook/Examples/Sources.md']);
  assert.match(text(a), /Setup and repair/); assert.doesNotMatch(text(b), /Setup and repair|Web Clipper templates/);
  await button(b, 'Open real notebook').onclick(); assert.deepEqual(examples.calls.resolved, ['Notebook/Home.md']); assert.equal(examples.calls.realHomes, 1);
});
test('standalone source selection is explicit and never acquires an outing association', async () => {
  const h = harness('examples'); await h.api.chooseVisitSource(h.context);
  assert.equal(h.calls.pickers.length, 1); assert.equal(h.calls.visits.length, 0); assert.equal(h.calls.outingVisits.length, 0);
  h.calls.pickers[0].choose(h.source); assert.equal(h.calls.visits.length, 1); assert.equal(h.calls.visits[0].context, h.context);
  assert.equal(h.calls.visits[0].sourcePath, h.source.path); assert.equal(h.calls.visits[0].visitPath, undefined); assert.equal(h.calls.outingVisits.length, 0);
});
test('with an active outing the chooser offers a separate current-outing route and standalone source option', async () => {
  const h = harness(); h.set({ outings: [{ status: 'active', name: 'Afternoon browse', path: 'Notebook/Outings/Active.md' }] });
  await h.api.chooseVisitSource(h.context); const chooser = h.calls.modals.at(-1)!;
  assert.match(text(chooser.contentEl), /For your current outing/); assert.match(text(chooser.contentEl), /standalone visit/);
  assert.equal(h.calls.pickers.length, 0); assert.deepEqual(h.calls.opened, []);
  await button(chooser.contentEl, 'Choose source').onclick(); assert.equal(h.calls.pickers.length, 1); assert.deepEqual(h.calls.opened, []);
  h.calls.pickers[0].choose(h.source); assert.equal(h.calls.visits.length, 1); assert.equal(h.calls.outingVisits.length, 0);
  await h.api.chooseVisitSource(h.context); await button(h.calls.modals.at(-1)!.contentEl, 'Open current outing').onclick();
  assert.deepEqual(h.calls.opened, ['Notebook/Outings/Active.md']); assert.equal(h.calls.visits.length, 1);
});
test('an obsolete Home render creates no late controls', async () => {
  const h = harness(), el = h.element(); let resolve!: () => void; h.defer(new Promise<void>(done => { resolve = done; }));
  const rendering = h.api.renderHome(h.context, {}, el, () => false); resolve(); await rendering;
  assert.equal(el.children.length, 0); assert.equal(h.calls.visits.length, 0);
});
