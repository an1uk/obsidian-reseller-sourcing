import test from 'node:test';
import assert from 'node:assert/strict';
import type { NotebookContext } from '../src/notebook-context';
import { workspaceContext } from '../src/workspace/context';
import { checkedViewState } from '../src/workspace/view-state';
import { fixture, newDraft } from './storage-fixtures';
import { readNote } from '../src/storage/markdown';
import { prepareMove } from '../src/storage/migration';

test('workspace facade forwards live context capabilities while pane navigation stays local', async () => {
  const f = fixture(), calls: string[] = [];
  let root = f.settings.root, current = f.settings;
  const original = {
    kind: 'real', label: 'Notebook', externalActions: 'open', app: f.app, manifest: { version: 'test' }, basesReady: true,
    get root() { return root; }, get settings() { return current; }, store: f.store,
    mapHost: { settings: current, openFile: async () => { throw Error('Original navigation must stay outside this pane.'); } },
    beginEditing() { assert.equal(this, original); calls.push('editing'); return () => calls.push('end'); },
    async runRootOperation<T>(action: () => Promise<T>) { assert.equal(this, original); return action(); },
    async saveSettings() { assert.equal(this, original); calls.push('settings'); },
    async openExternal(url: string) { assert.equal(this, original); calls.push(url); },
    onClipperStatusChanged(callback: () => void) { callback(); return () => calls.push('unsubscribe'); },
  } as unknown as NotebookContext;
  const facade = workspaceContext(original, { openFile: async path => { calls.push('pane:' + path); }, home: async () => { calls.push('home'); }, newPlace: () => calls.push('place'), newOuting: () => calls.push('outing') });
  assert.equal(facade.root, root); root = 'Renamed'; current = { ...current, root };
  assert.equal(facade.root, root); assert.equal(facade.settings, current);
  facade.beginEditing()?.(); await facade.saveSettings();
  assert.equal(await facade.runRootOperation(async () => 42), 42);
  await facade.openFile('one'); await facade.mapHost.openFile?.('two'); await facade.home(); facade.newPlace('shop'); facade.newOuting(); await facade.openExternal('preview');
  facade.onClipperStatusChanged(() => calls.push('status'))();
  assert.deepEqual(calls, ['editing', 'end', 'settings', 'pane:one', 'pane:two', 'home', 'place', 'outing', 'preview', 'status', 'unsubscribe']);
});

test('layout parsing resets malformed sections independently and never trusts route objects', () => {
  assert.equal(checkedViewState(null), undefined);
  const state = checkedViewState({ root: 'Notebook', route: { screen: 'place', path: 'Outside/Source.md' }, places: { query: 'wool', area: '', kind: 'shop', shortlist: false, view: 'list' }, history: { period: 'previous-week', query: 'coat' }, positions: { good: { scroll: 12, expanded: ['Details'] }, invalid: { scroll: -1 }, object: { scroll: {} } } });
  assert.deepEqual(state?.route, { screen: 'home' }); assert.equal(state?.places?.query, 'wool'); assert.equal(state?.history?.period, 'previous-week');
  assert.deepEqual(state?.positions, { good: { scroll: 12, expanded: ['Details'] } });
  assert.equal(checkedViewState({ root: 'Notebook', history: { insights: { query: {} } } })?.history, undefined);
});

test('routine browsing stays within notebook folders without enumerating unrelated vault files', async () => {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Exampletown');
  await f.store.saveCapture(newDraft(), area.path, 'Source'); await f.vault.create('Unrelated/Broken.md', '---\n[invalid yaml\n---\n');
  f.vault.getFiles = () => { throw Error('Global enumeration was called'); };
  f.vault.getMarkdownFiles = () => { throw Error('Global Markdown enumeration was called'); };
  assert.equal((await f.store.listPlaces()).length, 1); assert.equal((await f.store.listLocalities()).length, 1);
  assert.deepEqual(await f.store.visits.list(), []); assert.deepEqual(await f.store.outings.list(), []); assert.equal((await f.store.preparations.inspect()).drafts.length, 0);
});

test('reviewed notebook moves identify a custom configuration directory without changing it', async () => {
  const f = fixture(); await f.store.setup(); f.vault.configDir = 'custom-config'; await f.vault.createFolder(f.settings.root + '/custom-config');
  const before = [...f.vault.entries.keys()];
  const preview = await prepareMove(f.app, f.settings, { kind: 'notebook', toRoot: 'Moved', mapping: new Map() });
  assert.ok(preview.warnings.some(warning => warning.includes('/custom-config'))); assert.deepEqual([...f.vault.entries.keys()], before);
});

test('untrusted YAML collections are rejected before note properties become typed', () => {
  for (const yaml of ['[]', 'null', 'plain text']) assert.throws(() => readNote('---\n' + yaml + '\n---\nPersonal notes'), /Invalid note properties/);
  const parsed = readNote('---\nname: Fictional\n---\nPersonal notes'); assert.equal(parsed.properties.name, 'Fictional'); assert.equal(parsed.body, 'Personal notes');
});

test('preparation parsing rejects coercible enum values and preserves incomplete valid input', async () => {
  const f = fixture(); await f.store.setup();
  const id = 'draft-review-identity', path = f.store.paths.drafts + '/' + id + '.json';
  const data = { name: '', groups: [], unresolved: [], step: 1, filter: { text: '', area: '', shortlist: false, type: '', view: 'list' } };
  const envelope = { schema: 1, id, kind: 'outing', root: f.settings.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', data };
  const file = await f.vault.create(path, JSON.stringify(envelope));
  assert.deepEqual((await f.store.preparations.get(id))?.data, data);
  for (const malformed of [{ ...data, step: '1' }, { ...data, filter: { ...data.filter, view: ['list'] } }, { ...data, groups: [{ id: 'group', parkingPath: '', stops: [{ id: 'stop', sourcePath: f.settings.root + '/Places/Source.md', status: ['pending'] }] }] }]) {
    const raw = JSON.stringify({ ...envelope, data: malformed }); await f.vault.process(file, () => raw);
    await assert.rejects(f.store.preparations.get(id), /needs review/); assert.equal(await f.vault.read(file), raw);
  }
});
