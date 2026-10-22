import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { readNote, writeNote } from '../src/storage/markdown';
import type { AreaSelection, MovePreview } from '../src/types';

const townOnly: AreaSelection = { town: 'Exampletown', locality: '' };
const child: AreaSelection = { town: 'Exampletown', locality: 'Riverside' };
const files = (f: ReturnType<typeof fixture>) => f.vault.getFiles().map(file => file.path).sort();
const sourceFor = async (f: ReturnType<typeof fixture>, id: string) => (await f.store.listPlaces()).find(place => place.properties.source_capture_id === id)!;

test('capture creates a required town with optional child only on save, including parking', async () => {
  const f = fixture(); await f.store.setup();
  assert.equal((await f.store.listLocalities()).length, 0);
  const source = await f.store.saveCapture(newDraft('source'), townOnly, 'Source');
  assert.equal(source.path, 'Reseller sourcing/Places/Exampletown/Source.md');
  assert.equal(readNote(await f.vault.read(source)).properties.locality, '[[Reseller sourcing/Places/Exampletown/Area]]');
  const parking = await f.store.saveCapture(newDraft('parking', 'parking'), child, 'Parking');
  assert.equal(parking.path, 'Reseller sourcing/Places/Exampletown/Riverside/Parking.md');
  assert.equal((await f.store.listLocalities()).length, 2);
  assert.ok(f.vault.getAbstractFileByPath('Reseller sourcing/Places/Exampletown/Riverside/Area.md'));
  const again = await f.store.saveCapture(newDraft('another'), { town: 'exampletown', locality: 'riverside' }, 'Another source');
  assert.equal(again.path, 'Reseller sourcing/Places/Exampletown/Riverside/Another source.md');
  assert.equal((await f.store.listLocalities()).length, 2);
});
test('all invalid capture fields and path collisions are rejected before any staged area is created', async () => {
  for (const [draft, selection, filename] of [
    [newDraft(), { town: '', locality: 'District' }, 'Source'],
    [newDraft(), child, 'invalid/name'],
    [{ ...newDraft(), coordinates: [99, 10] }, child, 'Source'],
    [{ ...newDraft(), sourceType: '' }, child, 'Source'],
    [{ ...newDraft(), googleReviewCount: -1 }, child, 'Source'],
    [{ ...newDraft(), url: 'https://example.org/unrelated' }, child, 'Source'],
  ] as const) {
    const f = fixture(); await f.store.setup(); const before = files(f);
    await assert.rejects(f.store.saveCapture(draft as ReturnType<typeof newDraft>, selection, filename));
    assert.deepEqual(files(f), before); assert.equal((await f.store.listLocalities()).length, 0);
  }
  const f = fixture(); await f.store.setup();
  await f.vault.create('Reseller sourcing/Places/Exampletown/Riverside/Source.md', 'Unrelated existing note');
  await assert.rejects(f.store.saveCapture(newDraft(), child, 'Source'), /already exists/);
  assert.equal((await f.store.listLocalities()).length, 0);
});
test('stale capture and duplicate Google identity do not create proposed areas', async () => {
  const f = fixture(); await f.store.setup();
  const raw = await f.vault.create('Reseller sourcing/Capture inbox/Raw.md', writeNote({
    sourcing_capture: 1, template_version: 2, capture_kind: 'shop', google_name: 'Source',
  }, ''));
  const reviewed = await f.store.draft(raw);
  await f.vault.process(raw, text => text + '\nChanged');
  await assert.rejects(f.store.saveCapture(reviewed, child, 'Source'), /capture changed/);
  assert.equal((await f.store.listLocalities()).length, 0);
  const url = 'https://www.google.com/maps/place/Source/data=!4m6!3m5!1s0xa:0xb!8m2!3d12.3!4d45.6!16sabc';
  await f.store.saveCapture({ ...newDraft('first'), url }, townOnly, 'First');
  await assert.rejects(f.store.saveCapture({ ...newDraft('duplicate'), url }, { town: 'Another town', locality: 'District' }, 'Duplicate'), /already has a note/);
  assert.deepEqual((await f.store.listLocalities()).map(area => area.name), ['Exampletown']);
});
test('partial area creation retries idempotently, and receipt retries never create a newly selected hierarchy', async () => {
  const f = fixture(); await f.store.setup();
  const create = f.vault.create.bind(f.vault); let fail = true;
  f.vault.create = async (path, text) => {
    if (fail && path === 'Reseller sourcing/Places/Exampletown/Riverside/Area.md') { fail = false; throw new Error('Interrupted creation'); }
    return create(path, text);
  };
  await assert.rejects(f.store.saveCapture(newDraft('one'), child, 'Source'), /Interrupted creation/);
  assert.deepEqual((await f.store.listLocalities()).map(area => area.name), ['Exampletown']);
  const saved = await f.store.saveCapture(newDraft('one'), child, 'Source');
  assert.equal((await f.store.listLocalities()).length, 2);
  const retry = await f.store.saveCapture(newDraft('one'), { town: 'Unneeded town', locality: 'Unneeded child' }, 'Ignored new filename');
  assert.equal(retry.path, saved.path);
  assert.equal((await f.store.listLocalities()).length, 2);
});
test('configured defaults and remembered address choices apply only to successfully saved notes', async () => {
  const f = fixture(); await f.store.setup(); f.settings.defaultSourceType = 'Wholesaler';
  const source = await f.store.saveCapture(newDraft('default'), townOnly, 'Default');
  assert.equal(readNote(await f.vault.read(source)).properties.source_type, 'Wholesaler');
  const options = { makeDefaultSourceType: true, rememberHint: { phrase: ' Riverside Centre ' } };
  await assert.rejects(f.store.saveCapture({ ...newDraft('invalid'), sourceType: 'Rag house' }, child, 'invalid/name', options));
  assert.equal(f.settings.defaultSourceType, 'Wholesaler'); assert.equal(f.settings.areaHints.length, 0);
  const chosen = await f.store.saveCapture({ ...newDraft('chosen'), sourceType: 'Rag house' }, child, 'Chosen', options);
  assert.equal(f.settings.defaultSourceType, 'Rag house');
  assert.deepEqual(f.settings.areaHints.map(hint => [hint.phrase, hint.townPath, hint.localityPath, hint.enabled]), [
    ['Riverside Centre', 'Reseller sourcing/Places/Exampletown/Area.md', 'Reseller sourcing/Places/Exampletown/Riverside/Area.md', true],
  ]);
  await f.store.saveCapture({ ...newDraft('chosen'), sourceType: 'Market' }, { town: 'Unneeded', locality: '' }, 'Retry', options);
  assert.equal(f.settings.defaultSourceType, 'Rag house'); assert.equal(f.settings.areaHints.length, 1);
  assert.equal((await sourceFor(f, 'chosen')).path, chosen.path);
  await assert.rejects(f.store.saveCapture(newDraft('conflicting-hint'), { town: 'Exampletown', locality: 'Elsewhere' }, 'Elsewhere', { rememberHint: { phrase: 'riverside-centre' } }), /another area mapping/);
  assert.equal((await f.store.listLocalities()).some(area => area.name === 'Elsewhere'), false);
});
test('existing deep locality paths remain selectable and cannot cross their selected town', async () => {
  const f = fixture(); await f.store.setup();
  const town = await f.store.ensureLocality('Exampletown'), district = await f.store.ensureLocality('District', town.path), precinct = await f.store.ensureLocality('Centre', district.path);
  const source = await f.store.saveCapture(newDraft('deep'), { town: town.name, townPath: town.path, locality: precinct.name, localityPath: precinct.path }, 'Deep');
  assert.equal(source.path, 'Reseller sourcing/Places/Exampletown/District/Centre/Deep.md');
  await assert.rejects(f.store.saveCapture(newDraft('wrong'), { town: 'Other town', locality: precinct.name, localityPath: precinct.path }, 'Wrong'), /selected town/);
  assert.equal((await f.store.listLocalities()).some(area => area.name === 'Other town'), false);
});
test('single-place area change previews missing areas without writes and preserves shared parking and visits', async () => {
  const f = fixture(); await f.store.setup();
  const one = await f.store.saveCapture(newDraft('one'), townOnly, 'One');
  const two = await f.store.saveCapture(newDraft('two'), townOnly, 'Two');
  const parking = await f.store.saveCapture(newDraft('parking', 'parking'), townOnly, 'Parking');
  await f.store.linkParking(parking.path, one.path, true); await f.store.linkParking(parking.path, two.path, true);
  await f.store.addVisit(one.path, { observations: 'Retain this visit', finds: '', nextTime: '', visitDate: '2026-10-14', updateLastVisited: true });
  const outside = await f.vault.create('Outside.md', '[[' + one.path.replace(/\.md$/, '') + '|Source link]]');
  const before = files(f), preview = await f.store.previewPlaceAreaChange(one.path, child);
  assert.deepEqual(files(f), before); assert.equal((await f.store.listLocalities()).length, 1);
  assert.equal(preview.files.length, 1); assert.ok(preview.creations!.includes('Reseller sourcing/Places/Exampletown/Riverside/Area.md'));
  const report = await f.store.changePlaceArea(one.path, child, preview);
  const moved = await sourceFor(f, 'one');
  assert.equal(moved.path, 'Reseller sourcing/Places/Exampletown/Riverside/One.md');
  assert.equal(report.moved.length, 1); assert.equal((await sourceFor(f, 'two')).path, two.path);
  assert.equal((await sourceFor(f, 'parking')).path, parking.path);
  const visitRecords = await f.store.visits.list(moved.path);
  assert.equal(visitRecords.length, 1); assert.equal(visitRecords[0]!.observations, 'Retain this visit');
  assert.ok(visitRecords[0]!.sourcePath.includes('/Exampletown/Riverside/'));
  assert.doesNotMatch(await f.vault.read(f.vault.getAbstractFileByPath(moved.path) as TFile), /Retain this visit/);
  assert.equal(moved.properties.parking_location, '[[' + parking.path.replace(/\.md$/, '') + ']]');
  assert.deepEqual(readNote(await f.vault.read(parking)).properties.parking_for, ['[[' + moved.path.replace(/\.md$/, '') + ']]', '[[' + two.path.replace(/\.md$/, '') + ']]']);
  assert.match(await f.vault.read(outside), /Places\/Exampletown\/Riverside\/One/);
  assert.equal(f.settings.captureReceipts.one, moved.path);
  await f.store.changePlaceArea(moved.path, townOnly);
  assert.equal((await sourceFor(f, 'one')).path, 'Reseller sourcing/Places/Exampletown/One.md');
});
test('single-place area change rejects stale previews and collisions before creating areas', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft('one'), townOnly, 'One');
  const preview = await f.store.previewPlaceAreaChange(source.path, child);
  await f.vault.process(source, text => text + '\nNew edit');
  await assert.rejects(f.store.changePlaceArea(source.path, child, preview), /changed since the preview/);
  assert.equal((await f.store.listLocalities()).length, 1);
  await f.vault.create('Reseller sourcing/Places/Exampletown/Riverside/One.md', 'Conflict');
  await assert.rejects(f.store.previewPlaceAreaChange(source.path, child), /already exists/);
  assert.equal((await f.store.listLocalities()).length, 1);
});
test('address hint editing validates targets and hints follow area/root moves and explicit rollback', async () => {
  const f = fixture(); await f.store.setup();
  await f.store.saveCapture(newDraft('one'), child, 'One', { rememberHint: { phrase: 'Riverside Centre' } });
  const original = structuredClone(f.settings.areaHints[0]!);
  await f.store.saveAreaHint({ ...original, enabled: false });
  assert.equal(f.settings.areaHints[0]!.enabled, false);
  await f.store.saveAreaHint({ ...original, enabled: true });
  await assert.rejects(f.store.saveAreaHint({ ...original, id: 'duplicate' }), /already has a mapping/);
  const area = (await f.store.listLocalities()).find(value => value.name === 'Riverside')!;
  await f.store.moveLocality(area.path, 'Waterside', area.parentPath);
  assert.equal(f.settings.areaHints[0]!.localityPath, 'Reseller sourcing/Places/Exampletown/Waterside/Area.md');
  await f.store.moveNotebook('Moved notebook');
  assert.equal(f.settings.areaHints[0]!.townPath, 'Moved notebook/Places/Exampletown/Area.md');
  assert.equal(f.settings.areaHints[0]!.localityPath, 'Moved notebook/Places/Exampletown/Waterside/Area.md');
  const before = structuredClone(f.settings.areaHints), rename = f.vault.renameFile.bind(f.vault); let count = 0;
  f.app.vault.rename = async (file, path) => { if (++count === 2) throw new Error('Interrupted'); await rename(file as TFile, path); };
  await assert.rejects(f.store.moveNotebook('Failed notebook'), /Move stopped safely/);
  await assert.rejects(f.store.removeAreaHint(original.id), /interrupted move/);
  f.app.vault.rename = rename; await f.store.rollbackMove();
  assert.deepEqual(f.settings.areaHints, before);
  await f.store.removeAreaHint(original.id); assert.equal(f.settings.areaHints.length, 0);
});
test('single-place move interruption rolls back its note without deleting newly created areas', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft('one'), townOnly, 'One');
  const before = await f.vault.read(source);
  f.vault.failRename = true;
  await assert.rejects(f.store.changePlaceArea(source.path, child), /Move stopped safely/);
  assert.ok(f.vault.getAbstractFileByPath('Reseller sourcing/Places/Exampletown/Riverside/Area.md'));
  assert.equal(f.settings.migration?.kind, 'place-area');
  await f.store.rollbackMove();
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath('Reseller sourcing/Places/Exampletown/One.md') as TFile), before);
  assert.ok(f.vault.getAbstractFileByPath('Reseller sourcing/Places/Exampletown/Riverside/Area.md'));
  assert.equal(f.settings.captureReceipts.one, 'Reseller sourcing/Places/Exampletown/One.md');
});

test('town-only remembered mappings use the full town target and blank targets are rejected', async () => {
  const f = fixture(); await f.store.setup();
  await f.store.saveCapture(newDraft('town-hint'), townOnly, 'Town source', { rememberHint: { phrase: 'Town centre' } });
  const hint = f.settings.areaHints[0]!;
  assert.equal(hint.localityPath, 'Reseller sourcing/Places/Exampletown/Area.md');
  assert.equal(hint.townPath, hint.localityPath);
  await assert.rejects(f.store.saveAreaHint({ ...hint, localityPath: '' }), /Choose this town/);
});
test('changing one place area preserves frontmatter comments, scalar styles and the exact body', async () => {
  const f = fixture(); await f.store.setup();
  const source = await f.store.saveCapture(newDraft('yaml'), townOnly, 'Commented');
  const original = await f.vault.read(source);
  const rewritten = original.replace('rating: 0', 'rating: 0 # my personal scale')
    .replace('comments: ""', "comments: 'My wording' # keep this comment")
    .replace('shortlist: false', "shortlist: false\ncustom_field: 'quoted value' # custom meaning");
  await f.vault.process(source, () => rewritten);
  const body = readNote(rewritten).body + '\nA personal paragraph with exact spacing.  \n';
  await f.vault.process(source, current => current.slice(0, current.length - readNote(current).body.length) + body);
  await f.store.changePlaceArea(source.path, child);
  const moved = await sourceFor(f, 'yaml'), text = await f.vault.read(f.vault.getAbstractFileByPath(moved.path) as TFile);
  assert.match(text, /rating: 0 # my personal scale/);
  assert.match(text, /custom_field: 'quoted value' # custom meaning/);
  assert.equal(readNote(text).body, body);
});
test('address mapping town context follows child reparenting and survives rollback of a later move', async () => {
  const f = fixture(); await f.store.setup();
  await f.store.saveCapture(newDraft('hint'), child, 'Source', { rememberHint: { phrase: 'Riverside centre' } });
  const other = await f.store.ensureLocality('Other town');
  const area = (await f.store.listLocalities()).find(value => value.name === 'Riverside')!;
  await f.store.moveLocality(area.path, area.name, other.path);
  const hint = f.settings.areaHints[0]!;
  assert.equal(hint.townPath, other.path);
  assert.equal(hint.localityPath, 'Reseller sourcing/Places/Other town/Riverside/Area.md');
  const oldHint = structuredClone(hint), rename = f.vault.renameFile.bind(f.vault);
  f.app.vault.rename = async () => { throw new Error('Interrupt'); };
  await assert.rejects(f.store.moveLocality(hint.localityPath, 'River district', other.path), /Move stopped safely/);
  f.app.vault.rename = rename;
  await f.store.rollbackMove();
  assert.deepEqual(f.settings.areaHints[0], oldHint);
});
