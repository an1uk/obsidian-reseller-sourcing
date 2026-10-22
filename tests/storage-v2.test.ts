import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { hashText, readNote, writeNote } from '../src/storage/markdown';
import { resolveLocalities } from '../src/domain/hierarchy';
import { DEFAULT_SETTINGS } from '../src/types';

const rawCapture = (name = 'A source') => writeNote({
  sourcing_capture: 1, template_version: 1, capture_kind: 'shop',
  google_name: name, captured_at: '2026-10-14', google_maps_url: '',
}, '');
const contents = (f: ReturnType<typeof fixture>) => Object.fromEntries(f.vault.getFiles().map(file => [file.path, f.vault.entries.get(file.path)!.text]));
test('locality hierarchy uses explicit parents, duplicate names remain distinct and loops are rejected', async () => {
  const f = fixture(); await f.store.setup();
  const exampletown = await f.store.ensureLocality('Exampletown'), otherford = await f.store.ensureLocality('Otherford');
  const riverside = await f.store.ensureLocality('Riverside', exampletown.path);
  const other = await f.store.ensureLocality('Riverside', otherford.path);
  assert.equal(riverside.path, 'Reseller sourcing/Places/Exampletown/Riverside/Area.md');
  assert.deepEqual(riverside.segments, ['Exampletown', 'Riverside']);
  assert.equal(riverside.label, 'Exampletown → Riverside');
  assert.notEqual(riverside.path, other.path);
  assert.equal((await f.store.ensureLocality('riverside', exampletown.path)).path, riverside.path);
  assert.ok(f.vault.getAbstractFileByPath('Reseller sourcing/Places/Exampletown/Riverside/Area.md'));
  const shop = await f.store.saveCapture({ ...newDraft(), sourceType: 'Rag house', brandTag: 'fixture-exampletown-riverside' }, riverside.path, 'Warehouse');
  const note = readNote(await f.vault.read(shop));
  assert.equal(shop.path, 'Reseller sourcing/Places/Exampletown/Riverside/Warehouse.md');
  assert.equal(note.properties.source_type, 'Rag house');
  assert.ok((note.properties.tags as string[]).includes('sourcing-source'));
  assert.ok((note.properties.tags as string[]).includes('source/fixture'));
  await assert.rejects(f.store.previewLocalityMove(exampletown.path, 'Exampletown', riverside.path), /descendants/);
  assert.deepEqual(resolveLocalities([
    { path: 'A.md', name: 'A', parentPath: 'B.md' }, { path: 'B.md', name: 'B', parentPath: 'A.md' },
  ]), []);
  assert.deepEqual(resolveLocalities([{ path: 'A.md', name: 'A', parentPath: 'Missing.md' }]), []);
});
test('notebook move rewrites inbound links, receipts and assets while preserving edited content and nested vault settings', async () => {
  const f = fixture(); await f.store.setup();
  const locality = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft('source'), locality.path, 'Branch');
  const parking = await f.store.saveCapture(newDraft('parking', 'parking'), locality.path, 'Parking');
  await f.store.linkParking(parking.path, source.path, true);
  await f.vault.create('Outside.md', '[[' + source.path.replace(/\.md$/, '') + '#Visit log|My branch]]\n[branch](' + encodeURI(source.path) + ')');
  await f.vault.createFolder('Reseller sourcing/.obsidian');
  await f.vault.create('Reseller sourcing/.obsidian/app.json', '{"setting":"keep"}');
  const home = f.vault.getAbstractFileByPath('Reseller sourcing/Home.md') as TFile;
  await f.vault.process(home, raw => '<!-- codex-generated: 2026-10-14 -->\n' + raw + '\n<!-- /codex-generated -->\nMy personal text');
  const preview = await f.store.previewNotebookMove('My sourcing');
  assert.deepEqual(preview.conflicts, []); assert.equal(preview.warnings.length, 1);
  const report = await f.store.moveNotebook('My sourcing', preview);
  assert.ok(report.moved.length > 10);
  assert.equal(f.settings.root, 'My sourcing');
  assert.equal(f.settings.captureReceipts.source, 'My sourcing/Places/Exampletown/Branch.md');
  assert.deepEqual(f.settings.previousRoots, ['Reseller sourcing']);
  const moved = readNote(await f.vault.read(f.vault.getAbstractFileByPath('My sourcing/Places/Exampletown/Branch.md') as TFile));
  assert.equal(moved.properties.parking_location, '[[My sourcing/Places/Exampletown/Parking]]');
  const outside = await f.vault.read(f.vault.getAbstractFileByPath('Outside.md') as TFile);
  assert.match(outside, /\[\[My sourcing\/Places\/Exampletown\/Branch#Visit log\|My branch\]\]/);
  assert.match(outside, /My%20sourcing\/Places\/Exampletown\/Branch\.md/);
  const editedHome = await f.vault.read(f.vault.getAbstractFileByPath('My sourcing/Home.md') as TFile);
  assert.match(editedHome, /My personal text/); assert.doesNotMatch(editedHome, /codex-generated/);
  assert.match(editedHome, /view: home/);
  const sourcesHub = await f.vault.read(f.vault.getAbstractFileByPath('My sourcing/System/Sources.base') as TFile);
  assert.match(sourcesHub, /My sourcing\/Places/);
  assert.doesNotMatch(sourcesHub, /Reseller sourcing\/Places/);
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath('Reseller sourcing/.obsidian/app.json') as TFile), '{"setting":"keep"}');
  assert.ok(f.vault.getAbstractFileByPath(report.backupRoot + '/manifest.json'));
  assert.equal(f.settings.migration, undefined);
});
test('legacy Shops and old capture template paths migrate without losing compatibility records', async () => {
  const f = fixture({ ...structuredClone(DEFAULT_SETTINGS), root: 'Charity Sourcing' }); await f.store.setup();
  const locality = await f.store.ensureLocality('Town');
  const source = await f.store.saveCapture(newDraft(), locality.path, 'Legacy');
  await f.vault.renameFile(source, 'Charity Sourcing/Shops/Town/Legacy.md');
  await f.vault.process(source, text => {
    const note = readNote(text); note.properties.tags = ['places', 'charity-shop']; delete note.properties.source_type;
    return writeNote(note.properties, note.body);
  });
  const oldTemplate = f.vault.getAbstractFileByPath('Charity Sourcing/System/Templates/Web Clipper/Capture source.json') as TFile;
  await f.vault.renameFile(oldTemplate, 'Charity Sourcing/System/Templates/Web Clipper/Capture shop.json');
  f.settings.assets[oldTemplate.path] = f.settings.assets['Charity Sourcing/System/Templates/Web Clipper/Capture source.json']!;
  delete f.settings.assets['Charity Sourcing/System/Templates/Web Clipper/Capture source.json'];
  await f.store.moveNotebook('Reseller sourcing');
  assert.equal((await f.store.listPlaces())[0]!.path, 'Reseller sourcing/Sources/Town/Legacy.md');
  assert.ok(f.vault.getAbstractFileByPath('Reseller sourcing/System/Templates/Web Clipper/Capture source.json'));
  assert.ok(f.settings.assets['Reseller sourcing/System/Templates/Web Clipper/Capture source.json']);
});
test('an interrupted capture keeps identity across notebook move and retries without duplicate source', async () => {
  const f = fixture(); await f.store.setup(); const locality = await f.store.ensureLocality('Town');
  const raw = rawCapture(), capture = await f.vault.create('Reseller sourcing/Capture inbox/A.md', raw);
  const draft = await f.store.draft(capture);
  f.vault.failRename = true;
  await assert.rejects(f.store.saveCapture(draft, locality.path, 'A'), /archive error/);
  delete f.settings.captureReceipts[draft.captureId];
  await f.store.moveNotebook('Moved sourcing');
  const movedRaw = f.vault.getAbstractFileByPath('Moved sourcing/Capture inbox/A.md') as TFile;
  assert.equal(await f.vault.read(movedRaw), raw);
  const reopened = await f.store.draft(movedRaw);
  assert.equal(reopened.captureId, draft.captureId);
  await f.store.saveCapture(reopened, 'Moved sourcing/Places/Town/Area.md', 'A duplicate');
  assert.equal((await f.store.listPlaces()).length, 1);
  assert.ok(f.vault.getAbstractFileByPath('Moved sourcing/System/Capture archive/' + draft.captureId + '.md'));
});
test('unreviewed capture retains legacy identity and immutable raw text through a move', async () => {
  const f = fixture(); await f.store.setup();
  const locality = await f.store.ensureLocality('Town');
  const oldPath = 'Reseller sourcing/Capture inbox/Fresh.md';
  const raw = rawCapture() + '[[' + locality.path + ']]\n<!-- codex-generated: source text -->\n';
  await f.vault.create(oldPath, raw);
  const expectedId = await hashText(oldPath + '\n' + raw);
  await f.store.moveNotebook('Moved');
  const capture = f.vault.getAbstractFileByPath('Moved/Capture inbox/Fresh.md') as TFile;
  assert.equal(await f.vault.read(capture), raw);
  assert.equal((await f.store.draft(capture)).captureId, expectedId);
  await f.vault.create('Reseller sourcing/Capture inbox/Old template.md', rawCapture('Another'));
  assert.equal((await f.store.captures()).length, 2);
});
test('changed capture is rejected before receipt and prior-source shortcuts', async () => {
  const f = fixture(); await f.store.setup(); const locality = await f.store.ensureLocality('Town');
  const capture = await f.vault.create('Reseller sourcing/Capture inbox/A.md', rawCapture());
  const draft = await f.store.draft(capture);
  f.vault.failRename = true;
  await assert.rejects(f.store.saveCapture(draft, locality.path, 'A'), /archive error/);
  await f.vault.process(capture, text => text + '\nChanged raw evidence');
  await assert.rejects(f.store.saveCapture(draft, locality.path, 'A'), /capture changed/);
  delete f.settings.captureReceipts[draft.captureId];
  await assert.rejects(f.store.saveCapture(draft, locality.path, 'A'), /capture changed/);
  assert.equal((await f.store.listPlaces()).length, 1);
  assert.ok(f.vault.getAbstractFileByPath(capture.path));
});
test('moves refuse occupied destinations and stale previews before making changes', async () => {
  const f = fixture(); await f.store.setup();
  await f.vault.create('Taken/My note.md', 'Unrelated');
  const collision = await f.store.previewNotebookMove('Taken');
  assert.ok(collision.conflicts.length);
  const before = contents(f);
  await assert.rejects(f.store.moveNotebook('Taken', collision), /conflicts/);
  assert.deepEqual(contents(f), before);
  await f.vault.create('Other.md', 'Text');
  const stale = await f.store.previewNotebookMove('Moved');
  await f.vault.process(f.vault.getAbstractFileByPath('Other.md') as TFile, () => 'Changed after preview');
  await assert.rejects(f.store.moveNotebook('Moved', stale), /changed since the preview/);
  assert.equal(f.settings.migration, undefined);
  assert.equal(f.settings.root, 'Reseller sourcing');
});
test('interrupted moves block new writes and explicit rollback verifies every original byte', async () => {
  const f = fixture(); await f.store.setup(); await f.store.ensureLocality('Town');
  await f.vault.create('Outside.md', '[[Reseller sourcing/Home]]');
  const before = contents(f), rename = f.vault.renameFile.bind(f.vault);
  let moves = 0;
  f.app.vault.rename = async (file, target) => { if (++moves === 3) throw new Error('Injected interruption'); await rename(file as TFile, target); };
  const preview = await f.store.previewNotebookMove('Moved');
  await assert.rejects(f.store.moveNotebook('Moved', preview), /Move stopped safely/);
  assert.equal(f.settings.migration?.status, 'failed');
  await assert.rejects(f.store.ensureLocality('New'), /interrupted move/);
  f.app.vault.rename = rename;
  await f.store.rollbackMove();
  for (const [path, text] of Object.entries(before)) assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(path) as TFile), text, path);
  assert.equal(f.settings.root, 'Reseller sourcing');
  assert.equal(f.settings.migration, undefined);
});
test('recovery refuses to overwrite edits made after an interrupted move', async () => {
  const f = fixture(); await f.store.setup();
  const rename = f.vault.renameFile.bind(f.vault); let calls = 0;
  f.app.vault.rename = async (file, target) => { if (++calls === 2) throw new Error('Interrupted'); await rename(file as TFile, target); };
  await assert.rejects(f.store.moveNotebook('Moved'), /Move stopped safely/);
  const changed = f.vault.getFiles().find(file => file.path.startsWith('Moved/'))!;
  await f.vault.process(changed, text => text + '\nNew user edits');
  f.app.vault.rename = rename;
  await assert.rejects(f.store.rollbackMove(), /new edits/);
  assert.match(await f.vault.read(changed), /New user edits/);
  assert.equal(f.settings.migration?.status, 'failed');
});
test('area reparenting moves descendants and preserves shared parking links and custom note content', async () => {
  const f = fixture(); await f.store.setup();
  const riverside = await f.store.ensureLocality('Riverside'), exampletown = await f.store.ensureLocality('Exampletown');
  const precinct = await f.store.ensureLocality('Centre', riverside.path);
  const source = await f.store.saveCapture(newDraft('shop'), precinct.path, 'Branch');
  const other = await f.store.saveCapture(newDraft('other'), exampletown.path, 'Other');
  const parking = await f.store.saveCapture(newDraft('park', 'parking'), riverside.path, 'Parking');
  await f.store.linkParking(parking.path, source.path, true); await f.store.linkParking(parking.path, other.path);
  const areaFile = f.vault.getAbstractFileByPath(riverside.path) as TFile;
  await f.vault.process(areaFile, text => text + '\nA personal observation');
  await f.store.moveLocality(riverside.path, 'Riverside', exampletown.path);
  const records = await f.store.listLocalities();
  const movedArea = records.find(record => record.name === 'Riverside')!;
  assert.equal(movedArea.path, 'Reseller sourcing/Places/Exampletown/Riverside/Area.md');
  assert.equal(movedArea.parentPath, exampletown.path);
  assert.equal(records.find(record => record.name === 'Centre')!.label, 'Exampletown → Riverside → Centre');
  assert.match(await f.vault.read(f.vault.getAbstractFileByPath(movedArea.path) as TFile), /A personal observation/);
  const places = await f.store.listPlaces(), movedSource = places.find(place => place.properties.source_capture_id === 'shop')!;
  assert.equal(movedSource.path, 'Reseller sourcing/Places/Exampletown/Riverside/Centre/Branch.md');
  const movedParking = places.find(place => place.kind === 'parking')!;
  assert.deepEqual(movedParking.properties.parking_for, ['[[' + movedSource.path.replace(/\.md$/, '') + ']]', '[[' + other.path.replace(/\.md$/, '') + ']]']);
  assert.equal(movedSource.properties.parking_location, '[[' + movedParking.path.replace(/\.md$/, '') + ']]');
  assert.ok(f.vault.getAbstractFileByPath('Reseller sourcing/Places/Exampletown/Riverside/Area.md'));
});
test('unlinking shared parking removes only one association and its preference', async () => {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Town');
  const one = await f.store.saveCapture(newDraft('one'), area.path, 'One'), two = await f.store.saveCapture(newDraft('two'), area.path, 'Two');
  const parking = await f.store.saveCapture(newDraft('park', 'parking'), area.path, 'Parking');
  await f.store.linkParking(parking.path, one.path, true); await f.store.linkParking(parking.path, two.path, true);
  await f.store.unlinkParking(parking.path, one.path);
  assert.deepEqual(readNote(await f.vault.read(parking)).properties.parking_for, ['[[' + two.path.replace(/\.md$/, '') + ']]']);
  assert.equal(readNote(await f.vault.read(one)).properties.parking_location, '');
  assert.equal(readNote(await f.vault.read(two)).properties.parking_location, '[[' + parking.path.replace(/\.md$/, '') + ']]');
});
test('moving a note preserves relative wikilinks to unmoved targets', async () => {
  const f = fixture(); await f.store.setup();
  const area = await f.store.ensureLocality('Old'), parent = await f.store.ensureLocality('New');
  const source = await f.store.saveCapture(newDraft(), area.path, 'Branch');
  await f.vault.create('Elsewhere/Unique.md', 'Original target');
  await f.vault.process(source, text => text + '\n[[Unique#Notes|My target]]');
  await f.store.moveLocality(area.path, 'Old', parent.path);
  const moved = (await f.store.listPlaces())[0]!;
  assert.match(await f.vault.read(f.vault.getAbstractFileByPath(moved.path) as TFile), /\[\[Elsewhere\/Unique#Notes\|My target\]\]/);
});

test('receipt paths cannot archive a capture when the saved source was replaced by an unrelated note', async () => {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Town');
  const capture = await f.vault.create('Reseller sourcing/Capture inbox/A.md', rawCapture());
  const draft = await f.store.draft(capture);
  f.vault.failRename = true;
  await assert.rejects(f.store.saveCapture(draft, area.path, 'A'), /archive error/);
  const saved = f.vault.getAbstractFileByPath(f.settings.captureReceipts[draft.captureId]!) as TFile;
  await f.vault.process(saved, () => 'Personal note replacing the previous source');
  await assert.rejects(f.store.saveCapture(draft, area.path, 'A'), /saved capture receipt/);
  assert.equal(await f.vault.read(saved), 'Personal note replacing the previous source');
  assert.equal((await f.store.captures()).length, 1);
});

test('Base path rewrites preserve similarly named siblings and do not recursively replace the destination', async () => {
  const f = fixture(); await f.store.setup();
  const exampletown = await f.store.ensureLocality('Exampletown');
  await f.store.ensureLocality('Exampletownford');
  const custom = await f.vault.create('Reseller sourcing/System/Custom.base',
    'filters:\n  and:\n    - file.inFolder("Reseller sourcing/Places/Exampletownford")\n    - file.inFolder("Reseller sourcing/Places/Exampletown")\n    - note.locality == link("Reseller sourcing/Places/Exampletown/Area")\n');
  await f.store.moveLocality(exampletown.path, 'Otherford');
  const text = await f.vault.read(custom);
  assert.match(text, /Places\/Exampletownford/); assert.doesNotMatch(text, /Otherfordford/);
  assert.match(text, /Places\/Otherford/); assert.match(text, /Places\/Otherford\/Area/);
  await f.store.moveNotebook('My Reseller sourcing');
  const moved = await f.vault.read(f.vault.getAbstractFileByPath('My Reseller sourcing/System/Custom.base') as TFile);
  assert.match(moved, /My Reseller sourcing\/Places\/Otherford/);
  assert.doesNotMatch(moved, /My My Reseller sourcing/);
});
test('native link resolution takes priority over coincidentally matching root basenames', async () => {
  const f = fixture(); await f.store.setup();
  const nearby = await f.vault.create('Reseller sourcing/Helper.md', 'Correct target');
  await f.vault.create('Helper.md', 'Different root target');
  const source = await f.vault.create('Reseller sourcing/Example.md', '[[Helper|Chosen]]');
  Object.assign(f.app, { metadataCache: { getFirstLinkpathDest: (target: string, from: string) => target === 'Helper' && from === source.path ? nearby : null } });
  await f.store.moveNotebook('Moved');
  const result = await f.vault.read(f.vault.getAbstractFileByPath('Moved/Example.md') as TFile);
  assert.equal(result, '[[Moved/Helper|Chosen]]');
});

test('Base path prefixes escape punctuation in folder names literally', async () => {
  const f = fixture(); await f.store.setup();
  const area = await f.store.ensureLocality("St. John's (West)");
  const custom = await f.vault.create('Reseller sourcing/System/Punctuation.base',
    "filters:\n  and:\n    - file.inFolder(\"Reseller sourcing/Places/St. John's (West)\")\n");
  await f.store.moveLocality(area.path, 'Otherford');
  assert.match(await f.vault.read(custom), /Places\/Otherford/);
  await f.store.moveNotebook('Reseller sourcing (test)');
  await f.store.moveNotebook('Another notebook');
  const moved = await f.vault.read(f.vault.getAbstractFileByPath('Another notebook/System/Punctuation.base') as TFile);
  assert.match(moved, /Another notebook\/Places\/Otherford/);
  assert.doesNotMatch(moved, /Reseller sourcing/);
});
