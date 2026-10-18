
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as guards from '../src/domain/guards';

function contextHarness() {
  class File { constructor(public path: string) {} }
  const files = new Map<string, object>(), opened: object[] = [], linkTextRequests: { path: string; sourcePath: string; newLeaf: boolean }[] = [];
  let current = true;
  const app = {
    vault: { getAbstractFileByPath(path: string) { return files.get(path) ?? null; } },
    workspace: {
      getLeaf(newLeaf: boolean) { assert.equal(newLeaf, false); return { async openFile(file: object) { opened.push(file); } }; },
      async openLinkText(path: string, sourcePath: string, newLeaf: boolean) { linkTextRequests.push({ path, sourcePath, newLeaf }); const filePath = path.split('#')[0]!; if (!files.has(filePath)) files.set(filePath, new File(filePath)); },
    },
  };
  const module = { exports: {} as Record<string, any> };
  const source = fs.readFileSync(new URL('../src/examples/context.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
    module, exports: module.exports,
    require(id: string) { return id === '../domain/guards' ? guards : id === '../workspace/view' ? {routeForPath: () => undefined} : id === 'obsidian' ? { TFile: File, Notice: class {} } : {}; },
  });
  const host = { app, manifest: { version: 'test' }, basesReady: true };
  const session = { root: 'Notebook/Examples', settings: { root: 'Notebook/Examples' }, store: {},
    assertCurrent() { if (!current) throw Error('Examples context changed'); } };
  const context = new module.exports.ExamplesContext(host, session);
  return { File, context, files, opened, linkTextRequests, invalidate() { current = false; } };
}

test('Examples navigation opens the exact existing file without link resolution or note creation', async () => {
  const h = contextHarness(), path = 'Notebook/Examples/Reference/Fictional town/Exact source.md', file = new h.File(path);
  h.files.set(path, file);
  h.files.set('Elsewhere/Exact source.md', new h.File('Elsewhere/Exact source.md'));
  await h.context.openFile(path);
  assert.deepEqual(h.opened, [file]);
  assert.deepEqual(h.linkTextRequests, []);
});

test('a deleted example or missing tour cannot be recreated by stale navigation', async () => {
  const h = contextHarness(), path = 'Notebook/Examples/Reference/Fictional town/Deleted source.md';
  h.files.set(path, new h.File(path)); h.files.delete(path);
  await assert.rejects(h.context.openFile(path), /no longer exists.*not be recreated/);
  await assert.rejects(h.context.openFile('Notebook/Examples/Guided tour/Start here.md'), /no longer exists/);
  h.files.set('Notebook/Examples/Sources', { path: 'Notebook/Examples/Sources', children: [] });
  await assert.rejects(h.context.openFile('Notebook/Examples/Sources'), /no longer exists/);
  assert.equal(h.files.has(path), false); assert.deepEqual(h.opened, []); assert.deepEqual(h.linkTextRequests, []);
});

test('Examples navigation rejects stale contexts and paths outside its captured root', async () => {
  const h = contextHarness();
  await assert.rejects(h.context.openFile('Notebook/Sources/Real source.md'), /inside Examples/);
  await assert.rejects(h.context.openFile('Notebook/Examples/../Real source.md'), /inside Examples/);
  h.invalidate();
  await assert.rejects(h.context.openFile('Notebook/Examples/Home.md'), /context changed/);
  assert.deepEqual(h.opened, []); assert.deepEqual(h.linkTextRequests, []);
});

test('Examples Base views use the exact existing file with the captured notebook context', async () => {
  const h = contextHarness(), path = 'Notebook/Examples/System/Sources.base';
  const file = new h.File(path); h.files.set(path, file);
  h.files.set('Elsewhere/Sources.base', new h.File('Elsewhere/Sources.base'));
  await h.context.openFile(path + '#Shortlist');
  assert.deepEqual(h.linkTextRequests, [{ path: path + '#Shortlist', sourcePath: 'Notebook/Examples/Home.md', newLeaf: false }]);
  assert.deepEqual(h.opened, []); assert.equal(h.files.get(path), file);
  assert.equal(h.files.has(path + '#Shortlist'), false);
});

test('a missing Base or folder with a view fragment cannot be recreated by link resolution', async () => {
  const h = contextHarness(), path = 'Notebook/Examples/System/Deleted.base';
  h.files.set(path, new h.File(path)); h.files.delete(path);
  await assert.rejects(h.context.openFile(path + '#Shortlist'), /no longer exists.*not be recreated/);
  h.files.set(path, { path, children: [] });
  await assert.rejects(h.context.openFile(path + '#Shortlist'), /no longer exists/);
  assert.deepEqual(h.linkTextRequests, []); assert.deepEqual(h.opened, []);
});

test('view fragments never permit file paths outside Examples or stale context navigation', async () => {
  const h = contextHarness();
  for (const path of ['Notebook/System/Sources.base#Shortlist', 'Notebook/Examples/../System/Sources.base#Shortlist', 'Notebook/Examples/System\\Sources.base#Shortlist']) {
    await assert.rejects(h.context.openFile(path), /inside Examples/);
  }
  const path = 'Notebook/Examples/System/Sources.base'; h.files.set(path, new h.File(path)); h.invalidate();
  await assert.rejects(h.context.openFile(path + '#Shortlist'), /context changed/);
  assert.deepEqual(h.linkTextRequests, []); assert.deepEqual(h.opened, []);
});

test('an ordinary Base without a view and an empty fragment retain direct existing-file opening', async () => {
  const h = contextHarness(), path = 'Notebook/Examples/System/Sources.base', file = new h.File(path); h.files.set(path, file);
  await h.context.openFile(path); await h.context.openFile(path + '#');
  assert.deepEqual(h.opened, [file, file]); assert.deepEqual(h.linkTextRequests, []);
});
