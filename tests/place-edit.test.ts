import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, newDraft } from './storage-fixtures';
import { readNote, updateNoteProperty } from '../src/storage/markdown';
import { placeEditPatch, placeEditReceipts, rebasePlaceEdit, reviewPlaceEdit, type PlaceEditPreparation } from '../src/place-edit/model';
import type { PreparationDraft } from '../src/workspace/types';
import type { TFile } from 'obsidian';

async function setup(kind: 'shop' | 'parking' = 'shop') {
  const f = fixture(); await f.store.setup();
  const file = await f.store.saveCapture(newDraft('original-capture', kind), { town: 'Exampletown', locality: '' }, 'Source');
  return { ...f, file, snapshot: await f.store.placeEditSnapshot(file.path) };
}
test('personal place edits preserve source capture, Google snapshots, exact body and unrelated YAML comments', async () => {
  const f = await setup();
  await f.vault.process(f.file, raw => raw.replace('rating: 0', 'rating: 0 # Personal comment') + 'Do not sell the shopping bag. Again.\n');
  const snapshot = await f.store.placeEditSnapshot(f.file.path), original = readNote(await f.vault.read(f.file));
  const values = { ...snapshot.values, displayName: 'Personal name', sourceType: 'Rag house', brandTag: 'Second Chance', address: '2 Fictional Lane', coordinatesText: '51.5, -0.1', website: 'stock.example', telephone: '01632 960123', mapsUrl: 'https://www.google.com/maps/place/Fictional/@1,2,14z/data=!3d51.5!4d-0.1', openingNotes: 'Phone first on Tuesdays', rating: 3.5, comments: 'A label safari', shortlist: true, closed: true, parkingOnSite: 'no', onSiteCost: 'Free', onSiteAvailability: 'Unreliable' };
  await f.store.savePlaceEdit(snapshot, values, 'edit-personal-001');
  const raw = await f.vault.read(f.file), note = readNote(raw), p = note.properties;
  assert.equal(note.body, original.body); assert.match(raw, /# Personal comment/);
  assert.equal(p.display_name, 'Personal name'); assert.equal(p.source_type, 'Rag house'); assert.equal(p.opening_notes, 'Phone first on Tuesdays');
  assert.equal(p.website, 'https://stock.example/'); assert.equal(p.telephone, '01632 960123'); assert.deepEqual(p.coordinates, [51.5, -.1]);
  assert.equal(p.rating, 3.5); assert.equal(p.shortlist, true); assert.equal(p.shop_closed, true); assert.equal(p.parking_on_site, 'no');
  assert.ok(!(p.tags as string[]).includes('charity-shop')); assert.ok((p.tags as string[]).includes('sourcing-source'));
  assert.equal(p.source_capture_id, original.properties.source_capture_id); assert.equal(p.google_rating, original.properties.google_rating); assert.deepEqual(p.google_hours, original.properties.google_hours);
  assert.equal((await f.store.listPlaces())[0].name, 'Personal name'); assert.equal(f.file.path, snapshot.path);
  assert.deepEqual(placeEditReceipts(p.place_edit_receipts)[0].fields.sort(), Object.keys(placeEditPatch(snapshot, values)).sort());
});
test('changed-field comparison preserves concurrent prose, other fields and nonbrand tags', async () => {
  const f = await setup();
  const beforeBody = readNote(await f.vault.read(f.file)).body;
  f.vault.beforeProcess = (_path, raw) => {
    const p = readNote(raw).properties;
    return updateNoteProperty(updateNoteProperty(raw, 'tags', [...p.tags as string[], 'my-tag']), 'comments', 'Newer judgement') + 'Concurrent prose\n';
  };
  await f.store.savePlaceEdit(f.snapshot, { ...f.snapshot.values, website: 'new.example', brandTag: 'New Brand' }, 'edit-concurrent-001');
  const after = readNote(await f.vault.read(f.file));
  assert.equal(after.properties.comments, 'Newer judgement'); assert.ok((after.properties.tags as string[]).includes('my-tag'));
  assert.ok((after.properties.tags as string[]).includes('source/new-brand')); assert.ok(!(after.properties.tags as string[]).includes('source/fixture-charity'));
  assert.equal(after.body, beforeBody + 'Concurrent prose\n');
});
test('competing edited property fails atomically without losing new values in another pane', async () => {
  const f = await setup();
  f.vault.beforeProcess = (_path, raw) => updateNoteProperty(raw, 'telephone', 'A newer number');
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, { ...f.snapshot.values, telephone: 'An old number', address: 'Not saved' }, 'edit-conflict-001'), /telephone changed.*kept/);
  const p = readNote(await f.vault.read(f.file)).properties;
  assert.equal(p.telephone, 'A newer number'); assert.equal(p.address, f.snapshot.values.address); assert.equal(p.place_edit_receipts, undefined);
});
test('brand conflict rejects a changed brand but unrelated new tags are allowed', async () => {
  const f = await setup();
  f.vault.beforeProcess = (_path, raw) => updateNoteProperty(raw, 'tags', ['places', 'sourcing-source', 'source/other']);
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, { ...f.snapshot.values, brandTag: 'Mine' }, 'edit-brand-001'), /tags changed/);
});
test('legacy brand editing keeps personal tags and source-type changes preserve concurrent brand updates', async () => {
  const f = await setup();
  await f.vault.process(f.file, raw => updateNoteProperty(raw, 'tags', ['places', 'charity-shop', 'charity-shop/legacy-brand', 'personal']));
  let snapshot = await f.store.placeEditSnapshot(f.file.path); assert.equal(snapshot.values.brandTag, 'legacy-brand');
  await f.store.savePlaceEdit(snapshot, { ...snapshot.values, brandTag: 'Another brand' }, 'edit-legacy-001');
  let p = readNote(await f.vault.read(f.file)).properties;
  assert.deepEqual(p.tags, ['places', 'charity-shop', 'personal', 'source/another-brand']);
  snapshot = await f.store.placeEditSnapshot(f.file.path);
  f.vault.beforeProcess = (_path, raw) => updateNoteProperty(raw, 'tags', ['places', 'charity-shop', 'personal', 'source/newer-brand']);
  await f.store.savePlaceEdit(snapshot, { ...snapshot.values, sourceType: 'Market' }, 'edit-legacy-002');
  p = readNote(await f.vault.read(f.file)).properties;
  assert.deepEqual(p.tags, ['places', 'personal', 'source/newer-brand', 'sourcing-source']);
  snapshot = await f.store.placeEditSnapshot(f.file.path);
  f.vault.beforeProcess = (_path, raw) => updateNoteProperty(raw, 'tags', ['places', 'sourcing-source', 'charity-shop', 'personal', 'source/newer-brand']);
  await assert.rejects(f.store.savePlaceEdit(snapshot, { ...snapshot.values, sourceType: 'Wholesaler' }, 'edit-legacy-003'), /source type tags changed/);
});
test('invalid details and duplicate exact Google identity leave record unchanged', async () => {
  const f = await setup(), before = await f.vault.read(f.file);
  for (const patch of [{ coordinatesText: '12,' }, { coordinatesText: '91,2' }, { website: 'javascript:alert(1)' }, { mapsUrl: 'https://example.org/maps' }, { mapsUrl: 'https://www.google.com/maps/place/Fictional', rating: 3.2 }, { sourceType: '' }]) {
    await assert.rejects(f.store.savePlaceEdit(f.snapshot, { ...f.snapshot.values, ...patch }, 'edit-invalid-001'));
    assert.equal(await f.vault.read(f.file), before);
  }
  const listing = 'https://www.google.com/maps/place/Another?query_place_id=FictionalPlaceIdentity';
  await f.store.saveCapture({ ...newDraft('different'), url: listing }, { town: 'Exampletown', locality: '' }, 'Other');
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, { ...f.snapshot.values, mapsUrl: listing.replace('Another', 'Renamed') }, 'edit-duplicate-001'), /already belongs/);
  assert.equal(await f.vault.read(f.file), before);
});
test('receipt retry preserves later personal corrections instead of replaying the patch', async () => {
  const f = await setup(), values = { ...f.snapshot.values, telephone: 'First saved' };
  await f.store.savePlaceEdit(f.snapshot, values, 'edit-retry-001');
  await f.vault.process(f.file, raw => updateNoteProperty(raw, 'telephone', 'Later correction') + 'New prose\n');
  const latest = await f.vault.read(f.file);
  await f.store.savePlaceEdit(f.snapshot, values, 'edit-retry-001'); assert.equal(await f.vault.read(f.file), latest);
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, { ...values, telephone: 'Different replay' }, 'edit-retry-001'), /already finished/);
});
test('clearing personal name reveals Google fallback and parking edits do not create source assessment', async () => {
  const f = await setup('parking');
  await f.store.savePlaceEdit(f.snapshot, { ...f.snapshot.values, displayName: 'Preferred car park', parkingCost: 'Free for one hour', parkingAvailability: 'Often full', rating: 4 }, 'edit-parking-001');
  let p = readNote(await f.vault.read(f.file)).properties;
  assert.equal(p.parking_cost, 'Free for one hour'); assert.equal(p.rating, undefined); assert.equal(p.source_type, undefined); assert.equal((await f.store.listPlaces())[0].name, 'Preferred car park');
  const snapshot = await f.store.placeEditSnapshot(f.file.path);
  await f.store.savePlaceEdit(snapshot, { ...snapshot.values, displayName: '', coordinatesText: '' }, 'edit-parking-002');
  p = readNote(await f.vault.read(f.file)).properties; assert.deepEqual(p.coordinates, []); assert.equal((await f.store.listPlaces())[0].name, 'Fixture Charity');
});
test('durable place edit draft preserves invalid input, comparison snapshot and revision guards', async () => {
  const f = await setup();
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit', root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '', data: { snapshot: f.snapshot, values: { ...f.snapshot.values, coordinatesText: 'unfinished coordinate', website: 'unfinished website' }, section: 'location' } };
  const saved = await f.store.preparations.save(draft, ''), reopened = await f.store.preparations.get(saved.id);
  assert.equal(reopened?.kind, 'place-edit'); if (!reopened || reopened.kind !== 'place-edit') throw Error('Missing edit draft');
  assert.deepEqual(reopened.data, draft.data);
  const raw = await f.vault.read(f.vault.getAbstractFileByPath(f.store.paths.drafts + '/' + saved.id + '.json') as TFile); assert.match(raw, /\[\[Reseller sourcing\/Places\/Exampletown\/Source\]\]/);
  await f.store.preparations.save({ ...saved, data: { ...saved.data, values: { ...saved.data.values, telephone: 'Latest' } } }, saved.revision);
  await assert.rejects(f.store.preparations.save(saved, saved.revision), /changed in another view/);
  await assert.rejects(f.store.savePlaceEdit(saved.data.snapshot, saved.data.values, saved.id), /latitude|website/);
  assert.equal(readNote(await f.vault.read(f.file)).properties.place_edit_receipts, undefined);
});
test('edit draft retains personal wikilink text literally while its target remains a portable link', async () => {
  const f = await setup();
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit', root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '', data: { snapshot: f.snapshot, values: { ...f.snapshot.values, displayName: '[[Personal label]]', openingNotes: '[[My opening note]]' }, section: 'opening' } };
  const saved = await f.store.preparations.save(draft, ''), reopened = await f.store.preparations.get(saved.id);
  if (!reopened || reopened.kind !== 'place-edit') throw Error('Missing edit draft');
  assert.equal(reopened.data.values.displayName, '[[Personal label]]'); assert.equal(reopened.data.values.openingNotes, '[[My opening note]]'); assert.equal(reopened.data.snapshot.path, f.file.path);
});
test('cross-context edits, replaced capture identity, malformed receipt and deleted target are blocked', async () => {
  const f = await setup();
  await assert.rejects(f.store.savePlaceEdit({ ...f.snapshot, path: f.store.root + '/Examples/Places/Test.md' }, { ...f.snapshot.values, displayName: 'No' }, 'edit-boundary-001'), /another notebook/);
  await f.vault.process(f.file, raw => updateNoteProperty(raw, 'source_capture_id', 'replacement'));
  await assert.rejects(f.store.savePlaceEdit(f.snapshot, { ...f.snapshot.values, displayName: 'No' }, 'edit-identity-001'), /identity changed/);
  const snapshot = await f.store.placeEditSnapshot(f.file.path);
  await f.vault.process(f.file, raw => updateNoteProperty(raw, 'place_edit_receipts', 'broken'));
  await assert.rejects(f.store.savePlaceEdit(snapshot, { ...snapshot.values, displayName: 'No' }, 'edit-malformed-001'), /receipts need review/);
  f.vault.entries.delete(f.file.path);
  await assert.rejects(f.store.savePlaceEdit(snapshot, { ...snapshot.values, displayName: 'No' }, 'edit-deleted-001'), /no longer exists/);
});
test('drafts retain edits across a reviewed area move without changing shared parking', async () => {
  const f = await setup(), area = await f.store.ensureLocality('Riverside');
  const parking = await f.store.saveCapture(newDraft('shared-parking', 'parking'), { town: 'Exampletown', locality: '' }, 'Parking');
  await f.store.linkParking(parking.path, f.file.path);
  const snapshot = await f.store.placeEditSnapshot(f.file.path);
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit', root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '', data: { snapshot, values: { ...snapshot.values, openingNotes: 'An editable draft' }, section: 'opening' } };
  const saved = await f.store.preparations.save(draft, '');
  const beforeParking = parking.path;
  const preview = await f.store.previewPlaceAreaChange(f.file.path, { town: area.name, locality: '', townPath: area.path });
  await f.store.changePlaceArea(f.file.path, { town: area.name, locality: '', townPath: area.path }, preview);
  const reopened = await f.store.preparations.get(saved.id); if (!reopened || reopened.kind !== 'place-edit') throw Error('Missing draft');
  assert.equal(reopened.data.snapshot.path, f.store.root + '/Places/Riverside/Source.md'); assert.equal(parking.path, beforeParking);
  await f.store.savePlaceEdit(reopened.data.snapshot, reopened.data.values, reopened.id);
  assert.equal(readNote(await f.vault.read(f.vault.getAbstractFileByPath(reopened.data.snapshot.path) as TFile)).properties.opening_notes, 'An editable draft');
});
test('applied unfinished edits block affected moves while unrelated moves remain available', async () => {
  const f = await setup();
  const other = await f.store.saveCapture(newDraft('other-place'), { town: 'Other town', locality: '' }, 'Other');
  const target = await f.store.ensureLocality('Destination');
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit', root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '', data: { snapshot: f.snapshot, values: { ...f.snapshot.values, displayName: 'Saved before interruption' }, section: 'basics' } };
  const saved = await f.store.preparations.save(draft, ''), locked = await f.store.preparations.transition(saved.id, saved.revision, 'completing');
  await f.store.savePlaceEdit(saved.data.snapshot, saved.data.values, saved.id, locked.revision);
  const selection = { town: target.name, locality: '', townPath: target.path };
  await assert.rejects(f.store.previewPlaceAreaChange(f.file.path, selection), /Finish the saved place edit/);
  await assert.rejects(f.store.previewLocalityMove(f.store.root + '/Places/Exampletown/Area.md', 'Renamed'), /Finish the saved place edit/);
  await assert.rejects(f.store.previewNotebookMove('New notebook'), /Finish the saved place edit/);
  const unrelated = await f.store.previewPlaceAreaChange(other.path, selection); assert.equal(unrelated.conflicts.length, 0);
  await assert.rejects(f.store.preparations.reopenPlaceEdit(saved.id, locked.revision), /already saved/);
  await f.store.preparations.transition(saved.id, locked.revision, 'complete', f.file.path);
  const allowed = await f.store.previewPlaceAreaChange(f.file.path, selection); assert.equal(allowed.conflicts.length, 0);
});
test('a failed comparison can reopen its completing draft for review before any receipt exists', async () => {
  const f = await setup();
  const draft: PreparationDraft<PlaceEditPreparation> = { schema: 1, id: crypto.randomUUID(), kind: 'place-edit', root: f.store.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', revision: '', data: { snapshot: f.snapshot, values: { ...f.snapshot.values, displayName: 'Mine' }, section: 'basics' } };
  const saved = await f.store.preparations.save(draft, ''), locked = await f.store.preparations.transition(saved.id, saved.revision, 'completing');
  await f.vault.process(f.file, raw => updateNoteProperty(raw, 'display_name', 'Theirs'));
  await assert.rejects(f.store.savePlaceEdit(saved.data.snapshot, saved.data.values, saved.id, locked.revision), /changed in another view/);
  const reopened = await f.store.preparations.reopenPlaceEdit(saved.id, locked.revision);
  assert.equal(reopened.phase, 'editing'); assert.equal(reopened.data.values.displayName, 'Mine');
});
test('conflict review defaults to current conflicts, retains other edits and changes only the draft until Save place', async () => {
  const f = await setup(), values = { ...f.snapshot.values, displayName: 'My name', comments: 'My takeaway' };
  await f.vault.process(f.file, raw => updateNoteProperty(updateNoteProperty(raw, 'display_name', 'Current name'), 'telephone', 'New contact'));
  const current = await f.store.placeEditSnapshot(f.file.path), before = await f.vault.read(f.file), comparison = reviewPlaceEdit(f.snapshot, values, current);
  assert.deepEqual(comparison.rows.map(row => [row.field, row.conflict]), [['displayName', true], ['comments', false]]);
  const keepCurrent = rebasePlaceEdit(f.snapshot, values, current, []);
  assert.equal(keepCurrent.values.displayName, 'Current name'); assert.equal(keepCurrent.values.comments, 'My takeaway'); assert.equal(keepCurrent.values.telephone, 'New contact');
  assert.equal(await f.vault.read(f.file), before);
  const keepMine = rebasePlaceEdit(f.snapshot, values, current, ['displayName']);
  assert.equal(keepMine.values.displayName, 'My name');
  await f.store.savePlaceEdit(keepMine.snapshot, keepMine.values, 'edit-rebased-001');
  assert.equal((await f.store.listPlaces())[0].name, 'My name'); assert.equal(readNote(await f.vault.read(f.file)).properties.telephone, 'New contact');
  await assert.rejects(f.store.savePlaceEdit(keepCurrent.snapshot, { ...keepCurrent.values, displayName: 'Yet another' }, 'edit-rebased-002'), /changed in another view/);
  assert.throws(() => reviewPlaceEdit(f.snapshot, values, { ...current, properties: { ...current.properties, source_capture_id: 'replacement' } }), /identity changed/);
});
