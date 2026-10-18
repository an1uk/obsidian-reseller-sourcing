import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { SourcingStore } from '../src/storage/store';
import { fixture } from './storage-fixtures';
import { CLIPPER_TEMPLATE_RELEASE } from '../src/capture';
import { hashText } from '../src/storage/markdown';

const fileAt = (f: ReturnType<typeof fixture>, path: string) => f.vault.getAbstractFileByPath(path) as TFile;
async function makeOlderOwnedExports(f: ReturnType<typeof fixture>) {
  const status = await f.store.getClipperStatus();
  for (const template of status.templates) {
    const old = JSON.stringify({ ...JSON.parse(template.json), name: template.kind === 'shop' ? 'Source — Google Maps' : 'Parking — Google Maps' }, null, 2) + '\n';
    await f.vault.process(fileAt(f, template.path), () => old);
    f.settings.assets[template.path] = { ...f.settings.assets[template.path]!, hash: await hashText(old) };
  }
  await f.save();
  return status;
}

test('Clipper status is read-only before setup and refresh never starts a notebook', async () => {
  const f = fixture();
  const before = [...f.vault.entries];
  const status = await f.store.getClipperStatus();
  assert.equal(status.release, CLIPPER_TEMPLATE_RELEASE);
  assert.equal(status.templates.length, 2);
  for (const template of status.templates) {
    assert.equal(template.exportState, 'missing'); assert.equal(template.confirmedAt, null);
    assert.match(template.name, new RegExp('v' + CLIPPER_TEMPLATE_RELEASE.replaceAll('.', '\\.')));
    assert.equal(template.fingerprint, await hashText(template.json));
  }
  assert.deepEqual([...f.vault.entries], before);
  await assert.rejects(f.store.refreshClipperTemplates(), /Set up the sourcing notebook/);
  assert.deepEqual([...f.vault.entries], before);
  assert.equal(f.persisted(), undefined);
});

test('first setup exposes current exports while browser import remains unconfirmed', async () => {
  const f = fixture(); await f.store.setup();
  const status = await f.store.getClipperStatus();
  for (const template of status.templates) {
    assert.equal(template.exportState, 'current'); assert.equal(template.confirmedAt, null);
    assert.equal(await f.vault.read(fileAt(f, template.path)), template.json);
  }
  const before = f.vault.getFiles().map(file => file.path).sort();
  assert.deepEqual(await f.store.refreshClipperTemplates(), { created: [], updated: [], conflicts: [] });
  assert.deepEqual(f.vault.getFiles().map(file => file.path).sort(), before);
  assert.equal(f.settings.clipperImports, undefined);
});

test('targeted refresh updates older owned exports without repairing other scaffolding or changing queued captures', async () => {
  const f = fixture(); await f.store.setup();
  const status = await makeOlderOwnedExports(f);
  const home = fileAt(f, 'Reseller sourcing/Home.md');
  await f.vault.process(home, () => 'My edited home and personal text\n');
  const captures = [
    ['Reseller sourcing/Capture inbox/Legacy v1.md', "---\nsourcing_capture: 1\ncapture_kind: shop\ntemplate_version: 1\ngoogle_name: Legacy source\n---\nRaw original v1\n"],
    ['Reseller sourcing/Capture inbox/Pending v2.md', "---\nsourcing_capture: 1\ncapture_kind: parking\ntemplate_version: 2\ngoogle_name: Pending parking\n---\nRaw original v2\n"],
  ];
  for (const [path, raw] of captures) await f.vault.create(path!, raw!);
  const readStatus = await f.store.getClipperStatus();
  assert.ok(readStatus.templates.every(template => template.exportState === 'edited'));
  const report = await f.store.refreshClipperTemplates();
  assert.deepEqual(report.updated, status.templates.map(template => template.path));
  assert.deepEqual(report.created, []); assert.deepEqual(report.conflicts, []);
  assert.equal(await f.vault.read(home), 'My edited home and personal text\n');
  for (const [path, raw] of captures) assert.equal(await f.vault.read(fileAt(f, path!)), raw);
  for (const template of (await f.store.getClipperStatus()).templates) {
    assert.equal(template.exportState, 'current');
    assert.equal(f.persisted()!.assets[template.path]!.hash, template.fingerprint);
  }
});

test('edited exports are preserved independently while another older owned export is refreshed', async () => {
  const f = fixture(); await f.store.setup(); const status = await makeOlderOwnedExports(f);
  const source = status.templates.find(template => template.kind === 'shop')!;
  const parking = status.templates.find(template => template.kind === 'parking')!;
  const oldOwnership = structuredClone(f.settings.assets[source.path]);
  const personal = JSON.stringify({ ...JSON.parse(source.json), name: 'My own source template', noteNameFormat: 'Personal naming' }, null, 2);
  await f.vault.process(fileAt(f, source.path), () => personal);
  const report = await f.store.refreshClipperTemplates();
  assert.deepEqual(report.conflicts, [source.path]); assert.deepEqual(report.updated, [parking.path]);
  assert.equal(await f.vault.read(fileAt(f, source.path)), personal);
  assert.deepEqual(f.settings.assets[source.path], oldOwnership);
  const fresh = await f.store.getClipperStatus();
  assert.equal(fresh.templates.find(template => template.kind === 'shop')!.exportState, 'edited');
  assert.equal(fresh.templates.find(template => template.kind === 'parking')!.exportState, 'current');
});

test('each import acknowledgement and update notice are recorded separately without detecting browser state', async () => {
  const f = fixture(); await f.store.setup(); const status = await f.store.getClipperStatus();
  await f.store.markClipperNoticeSeen(status.fingerprint);
  assert.equal(f.persisted()!.clipperNoticeFingerprint, status.fingerprint);
  assert.equal(f.settings.clipperImports, undefined);
  const source = status.templates.find(template => template.kind === 'shop')!;
  await f.store.confirmClipperImport('shop', source.fingerprint);
  const fresh = await f.store.getClipperStatus();
  const recorded = fresh.templates.find(template => template.kind === 'shop')!.confirmedAt;
  assert.ok(recorded && Number.isFinite(Date.parse(recorded)));
  assert.equal(fresh.templates.find(template => template.kind === 'parking')!.confirmedAt, null);
  assert.equal(f.persisted()!.clipperImports!.shop!.release, CLIPPER_TEMPLATE_RELEASE);
  assert.equal(f.persisted()!.clipperImports!.parking, undefined);
  const before = structuredClone(f.settings);
  await assert.rejects(f.store.confirmClipperImport('unknown' as 'shop', source.fingerprint), /template changed/);
  assert.deepEqual(f.settings, before);
});

test('root and vault name changes invalidate confirmations and bundle notices without rewriting them', async () => {
  const f = fixture(); await f.store.setup(); const initial = await f.store.getClipperStatus();
  const source = initial.templates.find(template => template.kind === 'shop')!;
  await f.store.confirmClipperImport('shop', source.fingerprint);
  await f.store.markClipperNoticeSeen(initial.fingerprint);
  const savedConfirmation = structuredClone(f.settings.clipperImports);
  f.settings.root = 'Different sourcing folder';
  const moved = await f.store.getClipperStatus();
  assert.notEqual(moved.fingerprint, initial.fingerprint);
  assert.ok(moved.templates.every(template => template.confirmedAt === null));
  assert.ok(moved.templates.every(template => template.exportState === 'missing'));
  const before = structuredClone(f.settings);
  await assert.rejects(f.store.confirmClipperImport('shop', source.fingerprint), /template changed/);
  await assert.rejects(f.store.markClipperNoticeSeen(initial.fingerprint), /templates changed/);
  assert.deepEqual(f.settings, before);
  f.settings.root = 'Reseller sourcing';
  assert.ok((await f.store.getClipperStatus()).templates.find(template => template.kind === 'shop')!.confirmedAt);
  f.vault.getName = () => 'Renamed test vault';
  const renamed = await f.store.getClipperStatus();
  assert.notEqual(renamed.fingerprint, initial.fingerprint);
  assert.ok(renamed.templates.every(template => template.confirmedAt === null));
  assert.deepEqual(f.settings.clipperImports, savedConfirmation);
});

test('actual notebook moves make old imports stale while preserving acknowledgement history', async () => {
  const f = fixture(); await f.store.setup(); const initial = await f.store.getClipperStatus();
  await f.store.confirmClipperImport('shop', initial.templates.find(template => template.kind === 'shop')!.fingerprint);
  const acknowledgement = structuredClone(f.settings.clipperImports);
  await f.store.moveNotebook('Moved sourcing');
  const moved = await f.store.getClipperStatus();
  assert.ok(moved.templates.every(template => template.exportState === 'current'));
  assert.ok(moved.templates.every(template => template.confirmedAt === null));
  assert.notEqual(moved.fingerprint, initial.fingerprint);
  assert.deepEqual(f.settings.clipperImports, acknowledgement);
});

test('an interrupted refresh persists ownership of the completed file and resumes safely', async () => {
  const f = fixture(); await f.store.setup(); const status = await makeOlderOwnedExports(f);
  const parking = status.templates.find(template => template.kind === 'parking')!;
  const originalProcess = f.vault.process.bind(f.vault);
  f.vault.process = async (file, callback) => {
    if (file.path === parking.path) throw new Error('Simulated interrupted refresh');
    return originalProcess(file, callback);
  };
  await assert.rejects(f.store.refreshClipperTemplates(), /interrupted refresh/);
  const source = status.templates.find(template => template.kind === 'shop')!;
  assert.equal(f.persisted()!.assets[source.path]!.hash, source.fingerprint);
  assert.notEqual(f.persisted()!.assets[parking.path]!.hash, parking.fingerprint);
  f.vault.process = originalProcess;
  const resumed = await f.store.refreshClipperTemplates();
  assert.deepEqual(resumed.updated, [parking.path]);
  assert.ok((await f.store.getClipperStatus()).templates.every(template => template.exportState === 'current'));
});

test('a concurrent export edit prevents replacement and preserves its ownership record', async () => {
  const f = fixture(); await f.store.setup(); const status = await makeOlderOwnedExports(f);
  const source = status.templates.find(template => template.kind === 'shop')!;
  const ownership = structuredClone(f.settings.assets[source.path]);
  f.vault.beforeProcess = (_path, raw) => raw + 'My concurrent edit\n';
  await assert.rejects(f.store.refreshClipperTemplates(), /changed during repair/);
  assert.match(await f.vault.read(fileAt(f, source.path)), /My concurrent edit/);
  assert.deepEqual(f.settings.assets[source.path], ownership);
});

test('refresh, confirmations and notices obey the existing interrupted-move guard', async () => {
  const f = fixture(); await f.store.setup(); const status = await f.store.getClipperStatus();
  f.settings.migration = { status: 'failed' } as typeof f.settings.migration;
  const before = structuredClone(f.settings);
  await assert.rejects(f.store.refreshClipperTemplates(), /interrupted move/);
  await assert.rejects(f.store.confirmClipperImport('shop', status.templates[0]!.fingerprint), /interrupted move/);
  await assert.rejects(f.store.markClipperNoticeSeen(status.fingerprint), /interrupted move/);
  assert.deepEqual(f.settings, before);
});

test('failed acknowledgement persistence leaves imports pending and the update reminder retryable', async () => {
  const f = fixture(); await f.store.setup(); const status = await f.store.getClipperStatus();
  const store = new SourcingStore(f.app, f.settings, async () => { throw Error('Settings unavailable'); });
  await assert.rejects(store.confirmClipperImport('shop', status.templates[0]!.fingerprint), /Settings unavailable/);
  assert.ok((await store.getClipperStatus()).templates.every(template => template.confirmedAt === null));
  await assert.rejects(store.markClipperNoticeSeen(status.fingerprint), /Settings unavailable/);
  assert.equal(f.settings.clipperNoticeFingerprint, undefined);
});
