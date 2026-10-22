import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { readNote, updateNoteProperty, writeNote } from '../src/storage/markdown';
import type { PlaceKind } from '../src/types';

async function ready(kind: PlaceKind = 'shop') {
  const f = fixture(); await f.store.setup();
  const root = f.store.root, capturePath = root + '/Capture inbox/New.md';
  const raw = writeNote({
    sourcing_capture: 1, template_version: 2, capture_kind: kind, google_name: 'Fictional source', google_maps_url: '',
    website: 'https://example.org/', address: '1 Main Street, Exampletown', captured_at: '2026-10-22T10:00:00Z',
  }, 'Original raw evidence.  \r\n[[./Sibling]]\r\n[relative](Sibling.md)\r\n<!-- codex-generated: original capture -->\r\nKeep the original marker.\r\n<!-- /codex-generated -->\r\n');
  const capture = await f.vault.create(capturePath, raw);
  await f.vault.create(root + '/Capture inbox/Sibling.md', 'Sibling reference');
  const otherCapture = await f.vault.create(root + '/Capture inbox/Other.md', writeNote({ sourcing_capture: 1 }, '[[./New]]\n[relative](New.md)\n'));
  const inbound = await f.vault.create('Personal.md', 'Personal note\n[[Reseller sourcing/Capture inbox/New|Original capture]]\n[capture](Reseller%20sourcing/Capture%20inbox/New.md#notes)\n');
  const draft = await f.store.draft(capture);
  f.app.fileManager.renameFile = async () => { throw Error('FileManager must not rewrite raw captures'); };
  return { ...f, root, raw, capture, capturePath, otherCapture, inbound, draft, archivePath: root + '/System/Capture archive/' + draft.captureId + '.md' };
}
type Fixture = Awaited<ReturnType<typeof ready>>;
const area = { town: 'Exampletown', locality: '' };
const at = (f: Fixture, path: string) => f.vault.getAbstractFileByPath(path) as TFile;

test('new sources and parking use backed-up raw archival, preserve other captures and update ordinary backlinks', async () => {
  for (const kind of ['shop', 'parking'] as const) {
    const f = await ready(kind), otherRaw = await f.vault.read(f.otherCapture);
    const saved = await f.store.saveCapture(f.draft, area, 'Saved place');
    assert.equal(await f.vault.read(at(f, f.archivePath)), f.raw);
    assert.equal(await f.vault.read(f.otherCapture), otherRaw);
    assert.equal(f.vault.getAbstractFileByPath(f.capturePath), null);
    assert.equal(f.settings.captureReceipts[f.draft.captureId], saved.path);
    const inbound = await f.vault.read(f.inbound);
    assert.ok(inbound.includes('[[' + f.archivePath.replace(/\.md$/, '') + '|Original capture]]'));
    assert.ok(inbound.includes(encodeURI(f.archivePath) + '#notes'));
    const backups = f.vault.getFiles().filter(file => file.extension === 'backup');
    assert.ok((await Promise.all(backups.map(file => f.vault.read(file)))).includes(f.raw));
    assert.ok(f.vault.getFiles().some(file => file.path.endsWith('/complete.json')));
    assert.equal(f.settings.migration, undefined);
    const current = await f.vault.read(saved);
    assert.equal((await f.store.saveCapture(f.draft, { town: 'Unused town', locality: '' }, 'Unused name')).path, saved.path);
    assert.equal(await f.vault.read(saved), current);
    assert.equal((await f.store.listPlaces()).length, 1);
    assert.equal((await f.store.listLocalities()).length, 1);
  }
});

test('an error after native rename rolls archival back and retries without recreating or replaying the source', async () => {
  const f = await ready(), nativeRename = f.vault.rename.bind(f.vault); let fail = true;
  f.vault.rename = async (file, destination) => {
    await nativeRename(file, destination);
    if (fail && destination === f.archivePath) { fail = false; throw Error('Interrupted after raw rename'); }
  };
  await assert.rejects(f.store.saveCapture(f.draft, area, 'Saved place'), /rolled back to the inbox/);
  assert.equal(await f.vault.read(at(f, f.capturePath)), f.raw);
  assert.equal(f.vault.getAbstractFileByPath(f.archivePath), null);
  assert.equal(f.settings.migration, undefined);
  const source = at(f, f.settings.captureReceipts[f.draft.captureId]);
  await f.vault.process(source, raw => updateNoteProperty(raw, 'google_name', 'Later personal correction') + 'Keep this later note.\n');
  const sourceBefore = await f.vault.read(source);
  delete f.settings.captureReceipts[f.draft.captureId];
  const reopened = new SourcingStore(f.app, f.settings, f.save);
  assert.equal((await reopened.saveCapture(f.draft, area, 'Different filename')).path, source.path);
  assert.equal(await f.vault.read(source), sourceBefore);
  assert.equal(await f.vault.read(at(f, f.archivePath)), f.raw);
  assert.equal((await reopened.listPlaces()).length, 1);
});

test('backlink failure restores only archive work and a later retry preserves saved source edits', async () => {
  const f = await ready(), before = await f.vault.read(f.inbound), process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (file, callback) => {
    if (file.path === f.inbound.path && fail) { fail = false; throw Error('Backlink write failed'); }
    return process(file, callback);
  };
  await assert.rejects(f.store.saveCapture(f.draft, area, 'Saved place'), /rolled back to the inbox/);
  assert.equal(await f.vault.read(at(f, f.capturePath)), f.raw);
  assert.equal(await f.vault.read(f.inbound), before);
  const saved = at(f, f.settings.captureReceipts[f.draft.captureId]);
  await f.vault.process(saved, raw => updateNoteProperty(raw, 'website', 'https://example.net/') + 'Later personal prose\n');
  const savedBefore = await f.vault.read(saved);
  await f.store.saveCapture(f.draft, area, 'Duplicate');
  assert.equal(await f.vault.read(saved), savedBefore);
  assert.equal(await f.vault.read(at(f, f.archivePath)), f.raw);
  assert.equal((await f.store.listPlaces()).length, 1);
});

test('conflicting backlink edits retain the recovery journal and never overwrite concurrent personal text', async () => {
  const f = await ready(), before = await f.vault.read(f.inbound), process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (file, callback) => {
    if (file.path === f.inbound.path && fail) {
      fail = false; f.vault.entries.get(file.path)!.text = before + 'Concurrent personal edit\n';
      throw Error('Interrupted during a concurrent edit');
    }
    return process(file, callback);
  };
  await assert.rejects(f.store.saveCapture(f.draft, area, 'Saved place'), /needs move recovery/);
  assert.equal(f.settings.migration?.kind, 'capture-archive');
  assert.equal(f.settings.migration?.status, 'failed');
  assert.equal(await f.vault.read(f.inbound), before + 'Concurrent personal edit\n');
  assert.equal(await f.vault.read(at(f, f.archivePath)), f.raw);
  const saved = at(f, f.settings.captureReceipts[f.draft.captureId]), savedBefore = await f.vault.read(saved);
  await assert.rejects(f.store.saveCapture(f.draft, area, 'Duplicate'), /interrupted move needs recovery/);
  await assert.rejects(f.store.rollbackMove(), /new edits/);
  // The user has explicitly reconciled the conflicting personal note before retrying recovery.
  f.vault.entries.get(f.inbound.path)!.text = before;
  await f.store.rollbackMove();
  assert.equal(await f.vault.read(at(f, f.capturePath)), f.raw);
  assert.equal(await f.vault.read(saved), savedBefore);
  await f.store.saveCapture(f.draft, area, 'Duplicate');
  assert.equal(await f.vault.read(at(f, f.archivePath)), f.raw);
  assert.equal(await f.vault.read(saved), savedBefore);
});

test('failed final archive settings persistence rolls back safely and leaves source creation idempotent', async () => {
  const f = await ready(); let fail = true;
  const store = new SourcingStore(f.app, f.settings, async () => {
    if (fail && !f.settings.migration && f.vault.getAbstractFileByPath(f.archivePath)) { fail = false; throw Error('Final settings persistence failed'); }
    await f.save();
  });
  await assert.rejects(store.saveCapture(f.draft, area, 'Saved place'), /rolled back to the inbox/);
  assert.equal(await f.vault.read(at(f, f.capturePath)), f.raw);
  assert.equal(f.settings.migration, undefined);
  const saved = at(f, f.settings.captureReceipts[f.draft.captureId]), savedBefore = await f.vault.read(saved);
  await store.saveCapture(f.draft, area, 'Duplicate');
  assert.equal(await f.vault.read(saved), savedBefore);
  assert.equal(readNote(savedBefore).properties.source_capture_id, f.draft.captureId);
  assert.equal(await f.vault.read(at(f, f.archivePath)), f.raw);
  assert.equal((await store.listPlaces()).length, 1);
});
