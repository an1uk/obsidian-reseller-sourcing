import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { confirmOutingParked, leaveOutingParking, outingFocusFingerprint, outingFocusView } from '../src/outings/focus';
import { readNote, updateNoteProperty } from '../src/storage/markdown';

async function ready() {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture(newDraft(), area.path, 'Source');
  const parking = await f.store.saveCapture(newDraft('parking-one', 'parking'), area.path, 'Parking');
  let outing = await f.store.outings.create({ name: 'Focus test', groups: [{ id: 'group-one', parkingPath: parking.path, stops: [{ id: 'stop-one', sourcePath: source.path, status: 'pending' }] }] });
  outing = await f.store.outings.start(outing.path); return { ...f, source, parking, outing };
}
const snapshot = (f: Awaited<ReturnType<typeof ready>>) => [...f.vault.entries].map(([path, value]) => [path, value.text ?? '']).sort(([a], [b]) => a.localeCompare(b));
test('enabling and changing focus preserves source bytes, outing prose and all visit/progress identities', async () => {
  const f = await ready(), places = await f.store.listPlaces(), file = f.vault.getAbstractFileByPath(f.outing.path) as TFile;
  await f.vault.process(file, raw => raw + 'Personal outing text.\n'); f.outing = await f.store.outings.get(f.outing.path);
  const raw = await f.vault.read(f.vault.getAbstractFileByPath(f.source.path) as TFile), body = readNote(await f.vault.read(file)).body;
  let saved = await f.store.outings.setFocus(f.outing.path, { ...outingFocusView(f.outing, places).state, enabled: true }, f.outing.revision, outingFocusFingerprint(f.outing, places));
  saved = await f.store.outings.setFocus(saved.path, confirmOutingParked(saved, places), saved.revision, outingFocusFingerprint(saved, places));
  assert.equal(saved.focus?.phase, 'walk'); assert.equal(saved.focus?.parkedParkingPath, f.parking.path);
  const encoded = readNote(await f.vault.read(file)).properties.outing as { focus: { parkedParkingPath: string } };
  assert.equal(encoded.focus.parkedParkingPath, '[[' + f.parking.path.replace(/\.md$/, '') + ']]');
  assert.deepEqual(saved.groups, f.outing.groups); assert.equal(saved.status, 'active'); assert.equal(saved.draft, undefined); assert.equal(saved.operation, undefined);
  assert.equal(readNote(await f.vault.read(file)).body, body); assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(f.source.path) as TFile), raw);
});
test('focus rejects stale outing revisions and changed destination pins without partial writes', async () => {
  const f = await ready(), places = await f.store.listPlaces(), candidate = { ...outingFocusView(f.outing, places).state, enabled: true }, fingerprint = outingFocusFingerprint(f.outing, places);
  await f.vault.process(f.vault.getAbstractFileByPath(f.parking.path) as TFile, raw => updateNoteProperty(raw, 'coordinates', [51, 2]));
  const before = snapshot(f); await assert.rejects(f.store.outings.setFocus(f.outing.path, candidate, f.outing.revision, fingerprint), /location or outing changed/); assert.deepEqual(snapshot(f), before);
  const latest = await f.store.listPlaces();
  const changed = await f.store.outings.completeStop(f.outing.path, 'stop-one', 'visited');
  await assert.rejects(f.store.outings.setFocus(f.outing.path, candidate, f.outing.revision, outingFocusFingerprint(f.outing, latest)), /outing changed/);
  assert.equal((await f.store.outings.get(changed.path)).focus, undefined);
});
test('full-view toggling retains phase and anchor while drafts block stage mutations', async () => {
  const f = await ready(), places = await f.store.listPlaces();
  let saved = await f.store.outings.setFocus(f.outing.path, { ...confirmOutingParked(f.outing, places), enabled: true }, f.outing.revision, outingFocusFingerprint(f.outing, places));
  saved = await f.store.outings.saveDraft(saved.path, 'stop-one', { observations: 'Not finished', finds: '', nextTime: '', visitDate: '2026-10-21', updateLastVisited: false }, saved.revision);
  const draft = structuredClone(saved.draft), before = snapshot(f);
  await assert.rejects(f.store.outings.setFocus(saved.path, { ...saved.focus!, phase: 'visit' }, saved.revision, outingFocusFingerprint(saved, places)), /saved visit draft/); assert.deepEqual(snapshot(f), before);
  saved = await f.store.outings.setFocus(saved.path, { ...saved.focus!, enabled: false }, saved.revision, outingFocusFingerprint(saved, places));
  assert.equal(saved.focus?.phase, 'walk'); assert.equal(saved.focus?.parkedParkingPath, f.parking.path); assert.deepEqual(saved.draft, draft);
  saved = await f.store.outings.setFocus(saved.path, { ...saved.focus!, enabled: true }, saved.revision, outingFocusFingerprint(saved, places)); assert.deepEqual(saved.draft, draft);
});
test('missing pins allow a focus placeholder without permitting a false parked anchor or another destination', async () => {
  const f = await ready(); await f.vault.process(f.vault.getAbstractFileByPath(f.parking.path) as TFile, raw => updateNoteProperty(raw, 'coordinates', []));
  const places = await f.store.listPlaces();
  const saved = await f.store.outings.setFocus(f.outing.path, { ...outingFocusView(f.outing, places).state, enabled: true }, f.outing.revision, outingFocusFingerprint(f.outing, places));
  const before = snapshot(f);
  await assert.rejects(f.store.outings.setFocus(saved.path, { ...saved.focus!, phase: 'walk', parkedGroupId: 'group-one', parkedParkingPath: f.parking.path, parkedCoordinates: [12.3, 45.6] }, saved.revision, outingFocusFingerprint(saved, places)), /parking location is unavailable/);
  assert.deepEqual(snapshot(f), before);
});
test('cross-context parking anchors and foreign outing paths cannot mutate a real context', async () => {
  const f = await ready(), places = await f.store.listPlaces(), before = snapshot(f);
  const foreign = f.settings.root + '/Examples/Places/Parking.md';
  await assert.rejects(f.store.outings.setFocus(f.outing.path, { enabled: true, phase: 'walk', stopId: 'stop-one', parkedGroupId: 'group-one', parkedParkingPath: foreign, parkedCoordinates: [12.3, 45.6] }, f.outing.revision, outingFocusFingerprint(f.outing, places)), /parking location is unavailable/);
  await assert.rejects(f.store.outings.setFocus(f.settings.root + '/Examples/Outings/Fake.md', { enabled: true, phase: 'walk', stopId: '' }, '', ''), /Choose an outing/);
  assert.deepEqual(snapshot(f), before);
});
test('old outings stay byte-identical after read and malformed optional focus cannot be trusted', async () => {
  const f = await ready(), before = snapshot(f); await f.store.outings.get(f.outing.path); await f.store.outings.list(); assert.deepEqual(snapshot(f), before);
  const file = f.vault.getAbstractFileByPath(f.outing.path) as TFile;
  await f.vault.process(file, raw => { const outing = readNote(raw).properties.outing as Record<string, unknown>; return updateNoteProperty(raw, 'outing', { ...outing, focus: { enabled: true, phase: 'fly', stopId: 'stop-one' } }); });
  await assert.rejects(f.store.outings.get(f.outing.path), /invalid saved fields/);
});

test('recorded final stops keep the car return and allow explicit arrival before finishing', async () => {
  const f = await ready(), places = await f.store.listPlaces();
  let saved = await f.store.outings.setFocus(f.outing.path, { ...confirmOutingParked(f.outing, places), enabled: true }, f.outing.revision, outingFocusFingerprint(f.outing, places));
  saved = await f.store.outings.completeStop(saved.path, 'stop-one', 'visited', saved.revision);
  assert.equal(outingFocusView(saved, places).state.phase, 'return');
  saved = await f.store.outings.setFocus(saved.path, leaveOutingParking(saved, places), saved.revision, outingFocusFingerprint(saved, places));
  assert.equal(outingFocusView(saved, places).readyToFinish, true); assert.equal(saved.status, 'active');
  saved = await f.store.outings.finish(saved.path, saved.revision); assert.equal(saved.status, 'finished');
});

test('manual parked pins survive reviewed note/root moves but pin changes cannot silently relocate the car', async () => {
  const f = await ready(), places = await f.store.listPlaces();
  let saved = await f.store.outings.setFocus(f.outing.path, { ...confirmOutingParked(f.outing, places), enabled: true }, f.outing.revision, outingFocusFingerprint(f.outing, places));
  const oldRoot = f.settings.root; await f.store.moveNotebook('Moved notebook'); saved = await f.store.outings.get(saved.path.replace(oldRoot, 'Moved notebook'));
  assert.match(saved.focus!.parkedParkingPath!, /^Moved notebook\/Places\//);
  assert.equal(outingFocusView(saved, await f.store.listPlaces()).parked?.path, saved.focus!.parkedParkingPath);
  const parkingFile = f.vault.getAbstractFileByPath(saved.focus!.parkedParkingPath!) as TFile;
  await f.vault.process(parkingFile, raw => updateNoteProperty(raw, 'coordinates', [51, 2]));
  const after = outingFocusView(saved, await f.store.listPlaces()); assert.equal(after.parked, undefined); assert.match(after.warning, /anchor is unavailable/);
  assert.deepEqual(saved.focus!.parkedCoordinates, [12.3, 45.6]);
});

test('an unfinished visit operation keeps focus recovery available while only display toggles can change', async () => {
  const f = await ready(), places = await f.store.listPlaces();
  let saved = await f.store.outings.setFocus(f.outing.path, { ...confirmOutingParked(f.outing, places), enabled: true }, f.outing.revision, outingFocusFingerprint(f.outing, places));
  const file = f.vault.getAbstractFileByPath(saved.path) as TFile;
  await f.vault.process(file, raw => {
    const outing = readNote(raw).properties.outing as Record<string, unknown>;
    return updateNoteProperty(raw, 'outing', { ...outing, operation: { id: 'operation-one', stopId: 'stop-one', sourcePath: '[[' + f.source.path.replace(/\.md$/, '') + ']]', input: { observations: 'Keep this', finds: '', nextTime: '', visitDate: '2026-10-21', updateLastVisited: false }, recordedAt: '2026-10-21T12:00:00Z', sourceBeforeHash: 'before', sourceIdentity: 'identity' } });
  });
  saved = await f.store.outings.get(saved.path); const operation = structuredClone(saved.operation), before = snapshot(f);
  await assert.rejects(f.store.outings.setFocus(saved.path, { ...saved.focus!, phase: 'visit' }, saved.revision, outingFocusFingerprint(saved, places)), /unfinished visit save/); assert.deepEqual(snapshot(f), before);
  saved = await f.store.outings.setFocus(saved.path, { ...saved.focus!, enabled: false }, saved.revision, outingFocusFingerprint(saved, places));
  assert.deepEqual(saved.operation, operation); assert.equal(saved.focus?.phase, 'walk'); assert.equal(saved.groups[0].stops[0].status, 'pending');
});
test('a concurrent personal prose edit is retained and makes a focus choice fail without overwriting it', async () => {
  const f = await ready(), places = await f.store.listPlaces();
  f.vault.beforeProcess = (_path, raw) => raw + 'Concurrent personal text.\n';
  await assert.rejects(f.store.outings.setFocus(f.outing.path, { ...outingFocusView(f.outing, places).state, enabled: true }, f.outing.revision, outingFocusFingerprint(f.outing, places)), /outing changed/);
  const raw = await f.vault.read(f.vault.getAbstractFileByPath(f.outing.path) as TFile);
  assert.match(raw, /Concurrent personal text/); assert.equal((await f.store.outings.get(f.outing.path)).focus, undefined);
});
