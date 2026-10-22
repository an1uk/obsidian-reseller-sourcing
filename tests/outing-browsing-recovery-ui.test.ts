import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { fixture, newDraft } from './storage-fixtures';
import { localDate, readNote, updateNoteProperty } from '../src/storage/markdown';
import * as repeat from '../src/outings/repeat';

function ui(context: unknown) {
  const notices: string[] = [], opened: any[] = [];
  class Notice { constructor(message: string) { notices.push(message); } }
  class OutingPreparationModal {
    constructor(...args: unknown[]) { opened.push(args); }
    open() {}
  }
  const module = { exports: {} as Record<string, any> };
  vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/ui/outing-shortcuts.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports,
    require(id: string) {
      if (id === 'obsidian') return { Notice };
      if (id === '../workspace/outing-preparation') return { OutingPreparationModal };
      if (id === './short-trip') return {};
      if (id === '../outings/repeat') return repeat;
      if (id === '../storage/markdown') return { localDate };
      throw Error('Unexpected import: ' + id);
    },
  });
  return { notices, opened, resume: () => module.exports.resumeCurrentOuting(context), repeat: (path: string) => module.exports.repeatOuting(context, path) };
}

async function ready() {
  const f = fixture(); await f.store.setup();
  const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft(), area.path, 'Source');
  const make = (name: string) => f.store.outings.create({ name, groups: [{ id: 'group', parkingPath: '', stops: [{ id: 'stop', sourcePath: source.path, status: 'pending' }] }] });
  const finished = async (name: string) => {
    let record = await make(name);
    record = await f.store.outings.start(record.path, record.revision);
    return f.store.outings.finish(record.path, record.revision);
  };
  const good = await finished('Route'), broken = await finished('Route ' + localDate());
  let active = await make('Current outing'); active = await f.store.outings.start(active.path, active.revision);
  const file = f.vault.getAbstractFileByPath(broken.path)!;
  await f.vault.process(file as any, raw => {
    const data = readNote(raw).properties.outing as any;
    data.groups[0].stops[0].status = 'invalid';
    return updateNoteProperty(raw, 'outing', data);
  });
  const before = await f.vault.read(file as any), opened: string[] = [];
  const context = { store: f.store, root: f.store.root, openFile: async (path: string) => { opened.push(path); } };
  return { ...f, good, broken, active, file, before, opened, context };
}

test('Resume opens an intact active outing and reports the exact damaged historical record', async () => {
  const f = await ready(), h = ui(f.context);
  await h.resume();
  assert.deepEqual(f.opened, [f.active.path]);
  assert.equal(h.notices.length, 1);
  assert.ok(h.notices[0]!.includes(f.broken.path));
  assert.equal(await f.vault.read(f.file as any), f.before);
});

test('Repeat tolerates unrelated historical damage while reserving its filename and retaining review details', async () => {
  const f = await ready(), h = ui(f.context);
  await h.repeat(f.good.path);
  assert.equal(h.opened.length, 1);
  const preparation = h.opened[0][4];
  assert.equal(preparation.name, 'Route ' + localDate() + ' (2)');
  assert.equal(preparation.groups[0].stops[0].status, 'pending');
  assert.ok(preparation.reviewWarnings.some((warning: string) => warning.includes(f.broken.path)));
  assert.equal(await f.vault.read(f.file as any), f.before);
  const count = (await f.store.outings.inspect()).records.length;
  await assert.rejects(h.repeat(f.broken.path), /invalid/);
  assert.equal(h.opened.length, 1, 'The affected record still requires review');
  assert.equal((await f.store.outings.inspect()).records.length, count, 'Preparing a repeat does not create an outing');
});
