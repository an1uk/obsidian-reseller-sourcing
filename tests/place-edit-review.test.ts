import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import type { PlaceEditPreparation } from '../src/place-edit/model';
import type { PreparationDraft } from '../src/workspace/types';
import { readNote, writeNote, updateNoteProperty } from '../src/storage/markdown';

async function ready() {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: 'Exampletown', locality: '' }, 'Source');
  const snapshot = await f.store.placeEditSnapshot(source.path), values = { ...snapshot.values, displayName: 'Reviewed personal name' };
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit',
    root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '',
    data: { snapshot, values, section: 'basics' } };
  const saved = await f.store.preparations.save(draft, '');
  return { ...f, source, snapshot, values, saved };
}
const draftFile = (f: Awaited<ReturnType<typeof ready>>) =>
  f.vault.getAbstractFileByPath(f.store.paths.drafts + '/' + f.saved.id + '.json') as TFile;

test('discarding a saved edit blocks a stale editor from applying it', async () => {
  const f = await ready(), before = await f.vault.read(f.source);
  await f.store.preparations.transition(f.saved.id, f.saved.revision, 'discarded');
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, f.saved.revision), /draft|changed|closed|complet|discard|removed/i);
  assert.equal(await f.vault.read(f.source), before);
});

test('deleting a completing draft blocks a previously flushed edit without recreating the draft', async () => {
  const f = await ready(), locked = await f.store.preparations.transition(f.saved.id, f.saved.revision, 'completing');
  const before = await f.vault.read(f.source), path = draftFile(f).path;
  f.vault.entries.delete(path);
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, locked.revision), /draft|changed|closed|removed/i);
  assert.equal(await f.vault.read(f.source), before); assert.equal(f.vault.entries.has(path), false);
});

test('atomic apply requires a completing draft and exactly the reviewed values', async () => {
  const f = await ready(), before = await f.vault.read(f.source);
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, f.saved.revision), /draft|changed|complet/i);
  const locked = await f.store.preparations.transition(f.saved.id, f.saved.revision, 'completing');
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, { ...f.values, displayName: 'Not in the reviewed draft' }, f.saved.id, locked.revision), /draft|changed|details|compar|review/i);
  assert.equal(await f.vault.read(f.source), before);
  await f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, locked.revision);
  assert.equal((await f.store.listPlaces())[0]!.name, 'Reviewed personal name');
});

test('externally changed completing draft revision blocks application and preserves entered details', async () => {
  const f = await ready(), locked = await f.store.preparations.transition(f.saved.id, f.saved.revision, 'completing');
  const before = await f.vault.read(f.source), file = draftFile(f);
  await f.vault.process(file, raw => {
    const envelope = JSON.parse(raw);
    envelope.data.values.displayName = 'Newer draft choice';
    return JSON.stringify(envelope, null, 2) + '\n';
  });
  const changed = await f.vault.read(file);
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, locked.revision), /draft|changed|review/i);
  assert.equal(await f.vault.read(f.source), before); assert.equal(await f.vault.read(file), changed);
});

test('receipt retry within the same locked completion never replays later personal corrections', async () => {
  const f = await ready(), locked = await f.store.preparations.transition(f.saved.id, f.saved.revision, 'completing');
  await f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, locked.revision);
  await f.vault.process(f.source, raw => updateNoteProperty(raw, 'display_name', 'Later personal correction') + 'Fresh prose\n');
  const corrected = await f.vault.read(f.source);
  await f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, locked.revision);
  assert.equal(await f.vault.read(f.source), corrected);
  await f.store.preparations.transition(f.saved.id, locked.revision, 'complete', f.source.path);
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id, locked.revision), /draft|changed|closed|complet/i);
  assert.equal(await f.vault.read(f.source), corrected);
});

test('malformed receipt entries block replay after a field was deliberately restored', async () => {
  for (const corruption of ['fingerprint', 'fields'] as const) {
    const f = await ready();
    await f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id);
    await f.vault.process(f.source, raw => {
      const note = readNote(raw); delete note.properties.display_name;
      const receipts = note.properties.place_edit_receipts as { fingerprint: string; fields: unknown }[];
      if (corruption === 'fingerprint') receipts[0]!.fingerprint = 'corrupted';
      else receipts[0]!.fields = [42];
      return writeNote(note.properties, note.body);
    });
    const before = await f.vault.read(f.source);
    await assert.rejects(f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id), /receipt|review|invalid/i);
    assert.equal(await f.vault.read(f.source), before);
  }
});

test('duplicate receipt identities block retry even when each receipt is individually well formed', async () => {
  const f = await ready();
  await f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id);
  await f.vault.process(f.source, raw => {
    const note = readNote(raw), receipts = note.properties.place_edit_receipts as unknown[];
    return updateNoteProperty(raw, 'place_edit_receipts', [receipts[0], structuredClone(receipts[0])]);
  });
  const before = await f.vault.read(f.source);
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, f.values, f.saved.id), /receipt|review|duplicate|invalid/i);
  assert.equal(await f.vault.read(f.source), before);
});
