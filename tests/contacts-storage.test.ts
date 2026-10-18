import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { readNote, updateNoteProperty, writeNote } from '../src/storage/markdown';
import { placeProperties } from '../src/storage/assets';
import { telephoneUrl } from '../src/domain/contacts';

test('new source and parking templates have optional blank contact fields', () => {
  for (const kind of ['shop', 'parking'] as const) {
    const properties = placeProperties(kind);
    assert.equal(properties.website, ''); assert.equal(properties.telephone, '');
  }
});

test('capture saves optional website and telephone as text without altering visit or shortlist fields', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture({ ...newDraft('contact-source'), website: ' charity.example/shops ', telephone: ' 01632 960123 ' }, { town: 'Exampletown', locality: '' }, 'Source');
  const props = readNote(await f.vault.read(source)).properties;
  assert.equal(props.website, 'https://charity.example/shops'); assert.equal(props.telephone, '01632 960123');
  assert.equal(props.shortlist, false); assert.equal(props.last_visited, null); assert.equal(props.rating, 0);
  const parking = await f.store.saveCapture({ ...newDraft('contact-parking', 'parking'), website: 'https://parking.example', telephone: '+44 1632 960123' }, { town: 'Exampletown', locality: '' }, 'Parking');
  const parkingProps = readNote(await f.vault.read(parking)).properties;
  assert.equal(parkingProps.website, 'https://parking.example/'); assert.equal(parkingProps.telephone, '+44 1632 960123');
  const legacy = await f.store.saveCapture(newDraft('legacy'), { town: 'Exampletown', locality: '' }, 'Legacy fields');
  assert.equal(readNote(await f.vault.read(legacy)).properties.telephone, '');
});

test('invalid nonblank website is rejected before staged areas or place files are created', async () => {
  const f = fixture(); await f.store.setup();
  const before = f.vault.getFiles().map(file => file.path).sort();
  await assert.rejects(f.store.saveCapture({ ...newDraft(), website: 'javascript:alert(1)' }, { town: 'New town', locality: 'New area' }, 'Rejected'), /valid http or https/);
  assert.deepEqual(f.vault.getFiles().map(file => file.path).sort(), before);
  assert.equal((await f.store.listLocalities()).length, 0);
  assert.equal(f.vault.getAbstractFileByPath('Reseller sourcing/Places/New town/Area.md'), null);
});

test('contact editing is atomic and preserves YAML comments, unrelated fields and current personal text', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: 'Exampletown', locality: '' }, 'Source');
  await f.vault.process(source, raw => raw.replace('website: ""', 'website: "" # Keep this comment').replace('telephone: ""', 'telephone: "" # Keep the phone comment') + 'My own note\n');
  await f.store.updateAssessment(source.path, { rating: 3.5, comments: 'My judgement', shortlist: true });
  // Add comments after the unrelated older assessment writer has completed.
  await f.vault.process(source, raw => raw.replace('website: ""', 'website: "" # Website comment').replace('telephone: ""', 'telephone: "" # Telephone comment'));
  f.vault.beforeProcess = (_path, raw) => updateNoteProperty(raw, 'custom_fact', 'Keep newest edit') + 'Concurrent personal text\n';
  await f.store.updateContact(source.path, { website: 'charity.example', telephone: '01632960123' });
  const raw = await f.vault.read(source), props = readNote(raw).properties;
  assert.equal(props.website, 'https://charity.example/'); assert.equal(props.telephone, '01632960123'); assert.equal(typeof props.telephone, 'string');
  assert.equal(props.rating, 3.5); assert.equal(props.comments, 'My judgement'); assert.equal(props.shortlist, true); assert.equal(props.custom_fact, 'Keep newest edit');
  assert.match(raw, /# Website comment/); assert.match(raw, /# Telephone comment/);
  assert.match(raw, /My own note/); assert.ok(raw.endsWith('Concurrent personal text\n'));
  const before = await f.vault.read(source);
  await assert.rejects(f.store.updateContact(source.path, { website: 'data:text/plain,test', telephone: 'new phone' }), /valid http or https/);
  assert.equal(await f.vault.read(source), before);
});

test('manual telephone text is retained even when no safe call link can be made, and contacts can be cleared', async () => {
  const f = fixture(); await f.store.setup();
  const parking = await f.store.saveCapture(newDraft('parking', 'parking'), { town: 'Exampletown', locality: '' }, 'Parking');
  await f.store.updateContact(parking.path, { website: '', telephone: 'Ask at reception' });
  assert.equal(readNote(await f.vault.read(parking)).properties.telephone, 'Ask at reception');
  assert.equal(telephoneUrl(readNote(await f.vault.read(parking)).properties.telephone), '');
  await f.store.updateContact(parking.path, { website: '', telephone: '' });
  assert.equal(readNote(await f.vault.read(parking)).properties.telephone, '');
  await f.vault.create('Outside.md', writeNote({ tags: ['places', 'parking'] }, 'Keep this'));
  await assert.rejects(f.store.updateContact('Outside.md', { website: 'example.org', telephone: '123' }), /source or parking/);
});

test('setup upgrades templates without changing older place notes', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: 'Exampletown', locality: '' }, 'Source');
  await f.vault.process(source, raw => { const note = readNote(raw); delete note.properties.website; delete note.properties.telephone; return writeNote(note.properties, note.body); });
  const before = await f.vault.read(source);
  await f.store.setup();
  assert.equal(await f.vault.read(source), before);
  const template = f.vault.getAbstractFileByPath('Reseller sourcing/System/Templates/Source.md') as TFile;
  assert.equal(readNote(await f.vault.read(template)).properties.website, '');
});

test('contact snapshot rejects a concurrent phone change without overwriting either field', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture({ ...newDraft(), website: 'first.example', telephone: '01632 960111' }, { town: 'Exampletown', locality: '' }, 'Source');
  const original = readNote(await f.vault.read(source)).properties;
  const expected = { website: original.website, telephone: original.telephone };
  await f.store.updateContact(source.path, { website: 'first.example', telephone: '01632 960222' });
  const before = await f.vault.read(source);
  await assert.rejects(f.store.updateContact(source.path, { website: 'new.example', telephone: '01632 960111' }, expected), /Contact details changed.*Reopen/);
  assert.equal(await f.vault.read(source), before);
  const latest = readNote(before).properties;
  const latestExpected = { website: latest.website, telephone: latest.telephone };
  // The guard runs inside the atomic callback, after any external file edit.
  f.vault.beforeProcess = (_path, raw) => updateNoteProperty(raw, 'telephone', '01632 960333');
  await assert.rejects(f.store.updateContact(source.path, { website: 'new.example', telephone: '01632 960222' }, latestExpected), /Contact details changed/);
  const afterRace = readNote(await f.vault.read(source)).properties;
  assert.equal(afterRace.website, latest.website); assert.equal(afterRace.telephone, '01632 960333');
});

test('expected contact snapshot allows unrelated edits and preserves their current values', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft(), { town: 'Exampletown', locality: '' }, 'Source');
  const props = readNote(await f.vault.read(source)).properties;
  const expected = { website: props.website, telephone: props.telephone };
  f.vault.beforeProcess = (_path, raw) => updateNoteProperty(raw, 'comments', 'Newer sourcing judgement') + 'Added in another pane\n';
  await f.store.updateContact(source.path, { website: 'new.example', telephone: '01632 960123' }, expected);
  const raw = await f.vault.read(source), after = readNote(raw).properties;
  assert.equal(after.website, 'https://new.example/'); assert.equal(after.telephone, '01632 960123');
  assert.equal(after.comments, 'Newer sourcing judgement'); assert.ok(raw.endsWith('Added in another pane\n'));
});
