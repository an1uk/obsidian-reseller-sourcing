import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { ASSET_VERSION } from '../src/storage/assets';
import { hashText, readNote, writeNote } from '../src/storage/markdown';
import { canonicalPlaceIdentity } from '../src/domain';
import { DEFAULT_SETTINGS, type Settings } from '../src/types';

const fileAt = (f: ReturnType<typeof fixture>, path: string) => f.vault.getAbstractFileByPath(path) as TFile;
const contents = (f: ReturnType<typeof fixture>) => [...f.vault.entries].map(([path, value]) => [path, value.text ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
function freshDevice(f: ReturnType<typeof fixture>, beforeSave?: () => void) {
  const settings = structuredClone(DEFAULT_SETTINGS); let saves = 0;
  const save = async () => { beforeSave?.(); saves++; };
  return { settings, store: new SourcingStore(f.app, settings, save), saves: () => saves };
}
async function capture(f: ReturnType<typeof fixture>, suffix = 'pending') {
  return f.vault.create(f.settings.root + '/Capture inbox/' + suffix + '.md', writeNote({
    sourcing_capture: 1, template_version: 2, capture_kind: 'shop', google_name: 'Captured source', google_maps_url: '', address: '',
  }, 'Original raw capture'));
}

test('existing notebook inspection and cancelled preview are read-only on a fresh device', async () => {
  const f = fixture({ ...structuredClone(DEFAULT_SETTINGS), root: 'My shared notebook' }); await f.store.setup();
  const town = await f.store.ensureLocality('Exampletown');
  await f.store.saveCapture(newDraft('source'), town.path, 'Source');
  await f.store.saveCapture(newDraft('park', 'parking'), town.path, 'Parking');
  const device = freshDevice(f), before = contents(f), settingsBefore = structuredClone(device.settings);
  const preview = await device.store.inspectExistingNotebook(f.settings.root);
  assert.equal(preview.recognized, true); assert.deepEqual(preview.counts, { sources: 1, parking: 1, areas: 1, pendingCaptures: 0 });
  assert.equal(preview.blockers.length, 0); assert.equal(preview.identical.length, 8);
  assert.deepEqual(contents(f), before); assert.deepEqual(device.settings, settingsBefore); assert.equal(device.saves(), 0);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.equal(device.saves(), 1); assert.equal(device.settings.root, f.settings.root); assert.equal(device.settings.setupVersion, ASSET_VERSION);
  assert.equal(device.settings.captureReceipts.source, 'My shared notebook/Places/Exampletown/Source.md');
  assert.deepEqual(contents(f), before);
});

test('attachment preserves modified and older components and claims only exact canonical bytes', async () => {
  const f = fixture(); await f.store.setup(); const area = await f.store.ensureLocality('Exampletown');
  const modified = ['Reseller sourcing/Home.md', 'Reseller sourcing/System/Templates/Web Clipper/Capture source.json', 'Reseller sourcing/System/Sources.base'];
  for (const path of modified) await f.vault.process(fileAt(f, path), text => text + '\nPersonal component edit');
  f.vault.entries.delete('Reseller sourcing/System/Templates/Parking.md');
  const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook(f.settings.root);
  assert.deepEqual(preview.blockers, []); assert.ok(modified.every(path => preview.modified.includes(path)));
  assert.ok(preview.missing.includes('Reseller sourcing/System/Templates/Parking.md'));
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.ok(modified.every(path => !device.settings.assets[path]));
  assert.ok(device.settings.assets['Reseller sourcing/System/Parking.base']);
  assert.deepEqual(contents(f), before); assert.ok(area.path);
});

test('recognition permits zero canonical owned files and Clipper refresh uses attachment state', async () => {
  const f = fixture(); await f.store.setup();
  for (const file of f.vault.getFiles()) {
    if (file.extension === 'json') await f.vault.process(file, raw => JSON.stringify({ ...JSON.parse(raw), name: 'Personal template' }, null, 2));
    else await f.vault.process(file, raw => raw + '\n# Personal change\n');
  }
  const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook(f.settings.root);
  assert.deepEqual(preview.blockers, []); assert.equal(preview.identical.length, 0);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.deepEqual(device.settings.assets, {}); assert.deepEqual(contents(f), before);
  const refreshed = await device.store.refreshClipperTemplates();
  assert.equal(refreshed.conflicts.length, 2); assert.deepEqual(contents(f), before);
});

test('unrelated folder and stale attachment preview never mutate notebook or settings', async () => {
  const f = fixture(); await f.vault.createFolder('Personal'); await f.vault.create('Personal/Home.md', 'Personal notebook');
  const device = freshDevice(f), bad = await device.store.inspectExistingNotebook('Personal');
  assert.equal(bad.recognized, false); await assert.rejects(device.store.attachExistingNotebook('Personal', bad.fingerprint), /not a recognized/);
  await f.store.setup(); const preview = await device.store.inspectExistingNotebook(f.settings.root);
  await f.vault.create(f.settings.root + '/Notes.md', 'Written after confirmation');
  const before = contents(f); await assert.rejects(device.store.attachExistingNotebook(preview.root, preview.fingerprint), /changed since the preview/);
  assert.equal(device.saves(), 0); assert.deepEqual(contents(f), before); assert.equal(device.settings.setupVersion, 0);
});

test('attachment settings save failure restores all local settings without touching vault files', async () => {
  const f = fixture(); await f.store.setup();
  const device = freshDevice(f, () => { throw new Error('Disk settings failure'); }), beforeSettings = structuredClone(device.settings), before = contents(f);
  const preview = await device.store.inspectExistingNotebook(f.settings.root);
  await assert.rejects(device.store.attachExistingNotebook(preview.root, preview.fingerprint), /Disk settings failure/);
  assert.deepEqual(device.settings, beforeSettings); assert.deepEqual(contents(f), before);
});

test('duplicate saved capture identities block attachment instead of choosing a record', async () => {
  const f = fixture(); await f.store.setup();
  const place = await f.store.saveCapture(newDraft('identity'), { town: 'Exampletown', locality: '' }, 'One');
  await f.vault.create(place.path.replace('/One.md', '/Two.md'), await f.vault.read(place));
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook(f.settings.root), before = contents(f);
  assert.ok(preview.blockers.some(value => /more than one saved record/.test(value)));
  await assert.rejects(device.store.attachExistingNotebook(preview.root, preview.fingerprint), /more than one/);
  assert.deepEqual(contents(f), before); assert.equal(device.saves(), 0);
});

test('unknown pre-existing captures retain raw bytes and require originating desktop identity review', async () => {
  const f = fixture(); await f.store.setup(); const raw = await capture(f);
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook(f.settings.root), before = contents(f);
  assert.deepEqual(preview.reviewRequiredCaptures, [raw.path]); assert.equal(preview.blockers.length, 0);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.deepEqual(contents(f), before);
  await assert.rejects(device.store.draft(raw), /originating desktop/);
  await assert.rejects(device.store.saveCapture({ ...newDraft('attempt'), sourcePath: raw.path }, { town: 'Exampletown', locality: '' }, 'No'), /originating desktop/);
  const newlyClipped = await capture(f, 'new-after-attachment');
  const draft = await device.store.draft(newlyClipped); assert.ok(draft.captureId);
});

test('verified existing snapshots are recovered but do not survive changed raw capture bytes', async () => {
  const f = fixture(); await f.store.setup(); const raw = await capture(f); const draft = await f.store.draft(raw);
  const settings: Settings = structuredClone(DEFAULT_SETTINGS); settings.captureSnapshots = structuredClone(f.settings.captureSnapshots);
  const device = new SourcingStore(f.app, settings, async () => {});
  let preview = await device.inspectExistingNotebook(f.settings.root); assert.deepEqual(preview.reviewRequiredCaptures, []);
  await device.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.equal((await device.draft(raw)).captureId, draft.captureId);
  await f.vault.process(raw, text => text + '\nEdited');
  preview = await device.inspectExistingNotebook(f.settings.root); assert.deepEqual(preview.reviewRequiredCaptures, [raw.path]);
});

test('completed move receipt permits later personal edits and recovers moved pending capture identity', async () => {
  const f = fixture(); await f.store.setup(); const raw = await capture(f); const draft = await f.store.draft(raw);
  await f.store.saveCapture(newDraft('one'), { town: 'Exampletown', locality: '' }, 'Source');
  const report = await f.store.moveNotebook('Shared sourcing');
  assert.ok(f.vault.getAbstractFileByPath(report.backupRoot + '/complete.json'));
  const source = fileAt(f, 'Shared sourcing/Places/Exampletown/Source.md');
  await f.vault.process(source, text => text + '\nPersonal notes after the move');
  const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook('Shared sourcing');
  assert.deepEqual(preview.blockers, []); assert.deepEqual(preview.reviewRequiredCaptures, []);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.equal((await device.store.draft(fileAt(f, 'Shared sourcing/Capture inbox/pending.md'))).captureId, draft.captureId);
  assert.deepEqual(contents(f), before);
});

test('legacy preparing manifests reconcile completed hashes rather than treating status as interruption', async () => {
  const f = fixture(); await f.store.setup(); const report = await f.store.moveNotebook('Shared sourcing');
  f.vault.entries.delete(report.backupRoot + '/complete.json');
  const manifest = JSON.parse(await f.vault.read(fileAt(f, report.backupRoot + '/manifest.json')));
  assert.equal(manifest.status, 'preparing');
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook('Shared sourcing');
  assert.deepEqual(preview.blockers, []);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
});

test('partial migration on another device is blocked until explicit rollback verifies original files', async () => {
  const f = fixture(); await f.store.setup(); const rename = f.vault.renameFile.bind(f.vault); let count = 0;
  f.app.vault.rename = async (file, path) => { if (++count === 3) throw new Error('Interrupted'); await rename(file as TFile, path); };
  await assert.rejects(f.store.moveNotebook('Shared sourcing'), /Move stopped safely/);
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook('Reseller sourcing');
  assert.ok(preview.blockers.some(value => /mixed or unverifiable/.test(value)));
  await assert.rejects(device.store.attachExistingNotebook(preview.root, preview.fingerprint), /mixed or unverifiable/);
  f.app.vault.rename = rename; await f.store.rollbackMove();
  const restored = await device.store.inspectExistingNotebook('Reseller sourcing'); assert.deepEqual(restored.blockers, []);
  await device.store.attachExistingNotebook(restored.root, restored.fingerprint);
});

test('tampered completion evidence and capture identity conflicts are never silently trusted', async () => {
  const f = fixture(); await f.store.setup(); const report = await f.store.moveNotebook('Shared sourcing');
  await f.vault.process(fileAt(f, report.backupRoot + '/complete.json'), text => text.replace(/"manifestHash": "[a-f0-9]+"/, '"manifestHash": "wrong"'));
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook('Shared sourcing');
  assert.ok(preview.blockers.some(value => /completion record cannot be verified/.test(value)));
  assert.ok(await hashText('a'));
});

test('review-required captures cannot acquire a guessed identity by moving and reattaching', async () => {
  const f = fixture(); await f.store.setup(); const raw = await capture(f);
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook(f.settings.root);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  await device.store.moveNotebook('Another notebook');
  const moved = fileAt(f, 'Another notebook/Capture inbox/pending.md');
  assert.equal(device.settings.captureSnapshots[moved.path]?.reviewRequired, true);
  await assert.rejects(device.store.draft(moved), /originating desktop/);
  const second = freshDevice(f), secondPreview = await second.store.inspectExistingNotebook('Another notebook');
  assert.deepEqual(secondPreview.blockers, []); assert.deepEqual(secondPreview.reviewRequiredCaptures, [moved.path]);
  await second.store.attachExistingNotebook(secondPreview.root, secondPreview.fingerprint);
  await assert.rejects(second.store.draft(moved), /originating desktop/);
  assert.ok(raw.path);
});

test('a modified pending capture cannot be recovered from completed migration evidence', async () => {
  const f = fixture(); await f.store.setup(); const raw = await capture(f); await f.store.draft(raw);
  await f.store.moveNotebook('Shared sourcing');
  const moved = fileAt(f, 'Shared sourcing/Capture inbox/pending.md');
  await f.vault.process(moved, text => text + '\nChanged raw capture');
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook('Shared sourcing');
  assert.deepEqual(preview.blockers, []); assert.deepEqual(preview.reviewRequiredCaptures, [moved.path]);
});


const refreshUrl = 'https://www.google.com/maps/place/Example/data=!4m2!3m1!1s0x123:0x456';
async function sourceWithRefresh(f: ReturnType<typeof fixture>, suffix = 'refresh') {
  const original = await f.store.saveCapture({ ...newDraft('original-' + suffix), url: refreshUrl }, { town: 'Exampletown', locality: '' }, 'Source ' + suffix);
  const raw = await f.vault.create(f.settings.root + '/Capture inbox/' + suffix + '.md', writeNote({
    sourcing_capture: 1, template_version: 2, capture_kind: 'shop', google_name: 'Updated public name',
    google_maps_url: refreshUrl, address: '2 Main Street, Exampletown', captured_at: '2026-10-17T10:00:00Z',
  }, 'Exact original capture bytes.  \n'));
  const draft = await f.store.draft(raw);
  const receipt = {
    captureId: draft.captureId, captureRevision: draft.sourceRevision!, appliedAt: '2026-10-17T11:00:00.000Z',
    fields: ['address'], captureUrl: refreshUrl, captureIdentity: canonicalPlaceIdentity(refreshUrl),
    targetSourceCaptureId: 'original-' + suffix,
  };
  await f.vault.process(original, current => {
    const note = readNote(current); note.properties.source_refresh_receipts = [receipt];
    return writeNote(note.properties, note.body);
  });
  return { original, raw, draft, receipt };
}

test('verified portable refresh receipts recover pending identity and preserve original creation identity without writes', async () => {
  const f = fixture(); await f.store.setup(); const saved = await sourceWithRefresh(f);
  const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook(f.settings.root);
  assert.deepEqual(preview.blockers, []); assert.deepEqual(preview.reviewRequiredCaptures, []);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.equal(device.settings.captureReceipts[saved.draft.captureId], saved.original.path);
  assert.equal(device.settings.captureReceipts['original-refresh'], saved.original.path);
  assert.equal((await device.store.draft(saved.raw)).captureId, saved.draft.captureId);
  assert.equal(readNote(await f.vault.read(saved.original)).properties.source_capture_id, 'original-refresh');
  assert.deepEqual(contents(f), before);
});

test('archived raw bytes verify portable refresh receipts on a fresh device', async () => {
  const f = fixture(); await f.store.setup(); const saved = await sourceWithRefresh(f);
  await f.vault.renameFile(saved.raw, f.settings.root + '/System/Capture archive/' + saved.draft.captureId + '.md');
  const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook(f.settings.root);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.equal(device.settings.captureReceipts[saved.draft.captureId], saved.original.path);
  assert.equal(preview.counts.pendingCaptures, 0); assert.deepEqual(contents(f), before);
});

test('stale hashes, forged identities, malformed fields and changed raw URLs cannot bless a legacy capture', async () => {
  for (const invalid of ['hash', 'identity', 'fields', 'url', 'source-identity']) {
    const f = fixture(); await f.store.setup(); const saved = await sourceWithRefresh(f);
    const changed = { ...saved.receipt };
    if (invalid === 'hash') changed.captureRevision = '0'.repeat(64);
    if (invalid === 'identity') changed.captureId = '0'.repeat(64);
    if (invalid === 'fields') changed.fields = ['rating'];
    if (invalid === 'url') changed.captureUrl = 'https://www.google.com/maps/place/Different/data=!4m2!3m1!1s0x999:0x888';
    if (invalid === 'source-identity') changed.targetSourceCaptureId = 'different-creation';
    await f.vault.process(saved.original, current => {
      const note = readNote(current); note.properties.source_refresh_receipts = [changed]; return writeNote(note.properties, note.body);
    });
    const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook(f.settings.root);
    assert.deepEqual(preview.reviewRequiredCaptures, [saved.raw.path], invalid);
    await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
    assert.equal(device.settings.captureReceipts[saved.draft.captureId], undefined, invalid);
    await assert.rejects(device.store.draft(saved.raw), /originating desktop/, invalid);
    assert.deepEqual(contents(f), before, invalid);
  }
});

test('a verified refresh capture claimed by multiple sources blocks attachment', async () => {
  const f = fixture(); await f.store.setup(); const saved = await sourceWithRefresh(f);
  const other = await f.store.saveCapture({ ...newDraft('other-original'), url: '' }, { town: 'Exampletown', locality: '' }, 'Other source');
  await f.vault.process(other, current => {
    const note = readNote(current);
    note.properties.source_refresh_receipts = [{ ...saved.receipt, targetSourceCaptureId: 'other-original' }];
    return writeNote(note.properties, note.body);
  });
  const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook(f.settings.root);
  assert.ok(preview.blockers.some(value => /more than one saved record/.test(value)));
  await assert.rejects(device.store.attachExistingNotebook(preview.root, preview.fingerprint), /more than one saved record/);
  assert.deepEqual(contents(f), before);
});

test('refresh receipts and moved pending identities survive completed notebook and area moves', async () => {
  const f = fixture(); await f.store.setup(); const saved = await sourceWithRefresh(f);
  f.settings.captureReceipts[saved.draft.captureId] = saved.original.path;
  const receiptBefore = saved.receipt;
  await f.store.changePlaceArea(saved.original.path, { town: 'Exampletown', locality: 'Riverside' });
  const areaPath = 'Reseller sourcing/Places/Exampletown/Riverside/Source refresh.md';
  assert.equal(f.settings.captureReceipts[saved.draft.captureId], areaPath);
  const areaDevice = freshDevice(f), areaPreview = await areaDevice.store.inspectExistingNotebook(f.settings.root);
  await areaDevice.store.attachExistingNotebook(areaPreview.root, areaPreview.fingerprint);
  assert.equal(areaDevice.settings.captureReceipts[saved.draft.captureId], areaPath);
  await f.store.moveNotebook('Shared sourcing');
  const sourcePath = areaPath.replace('Reseller sourcing/', 'Shared sourcing/');
  assert.deepEqual(readNote(await f.vault.read(fileAt(f, sourcePath))).properties.source_refresh_receipts, [receiptBefore]);
  const device = freshDevice(f), before = contents(f), preview = await device.store.inspectExistingNotebook('Shared sourcing');
  assert.deepEqual(preview.blockers, []); assert.deepEqual(preview.reviewRequiredCaptures, []);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.equal(device.settings.captureReceipts[saved.draft.captureId], sourcePath);
  assert.equal((await device.store.draft(fileAt(f, 'Shared sourcing/Capture inbox/refresh.md'))).captureId, saved.draft.captureId);
  assert.deepEqual(contents(f), before);
});

test('interrupted area change rollback restores refresh settings and keeps portable receipts recoverable', async () => {
  const f = fixture(); await f.store.setup(); const saved = await sourceWithRefresh(f);
  f.settings.captureReceipts[saved.draft.captureId] = saved.original.path;
  const originalText = await f.vault.read(saved.original);
  f.vault.failRename = true;
  await assert.rejects(f.store.changePlaceArea(saved.original.path, { town: 'Exampletown', locality: 'Riverside' }), /Move stopped safely/);
  await f.store.rollbackMove();
  const originalPath = 'Reseller sourcing/Places/Exampletown/Source refresh.md';
  assert.equal(await f.vault.read(fileAt(f, originalPath)), originalText);
  assert.equal(f.settings.captureReceipts[saved.draft.captureId], originalPath);
  const device = freshDevice(f), preview = await device.store.inspectExistingNotebook(f.settings.root), before = contents(f);
  assert.deepEqual(preview.blockers, []); assert.deepEqual(preview.reviewRequiredCaptures, []);
  await device.store.attachExistingNotebook(preview.root, preview.fingerprint);
  assert.equal(device.settings.captureReceipts[saved.draft.captureId], originalPath);
  assert.deepEqual(contents(f), before);
});


test('fresh attachment verifies an actual completed refresh archive and retries without replaying source edits', async () => {
  const f = fixture(); Object.assign(f.app.vault, { rename: f.vault.renameFile.bind(f.vault) }); await f.store.setup();
  const source = await f.store.saveCapture({ ...newDraft('actual-original'), url: refreshUrl }, { town: 'Exampletown', locality: '' }, 'Actual refresh');
  const raw = await f.vault.create(f.settings.root + '/Capture inbox/actual-refresh.md', writeNote({
    sourcing_capture: 1, template_version: 2, capture_kind: 'shop', google_name: 'Captured updated source',
    google_maps_url: refreshUrl, address: '22 Main Street, Exampletown', captured_at: '2026-10-17T10:00:00Z',
  }, 'Untouched capture body.  \n[[./sibling|Original relative reference]]\n'));
  const rawText = await f.vault.read(raw), draft = await f.store.draft(raw);
  const preview = await f.store.previewCaptureRefresh(draft, source.path);
  await f.store.applyCaptureRefresh(draft, preview, ['address']);
  const sourceText = await f.vault.read(source);
  assert.equal(readNote(sourceText).properties.address, '22 Main Street, Exampletown');
  assert.equal(readNote(sourceText).properties.source_capture_id, 'actual-original');
  assert.equal(await f.vault.read(fileAt(f, f.settings.root + '/System/Capture archive/' + draft.captureId + '.md')), rawText);
  const device = freshDevice(f), before = contents(f), attachment = await device.store.inspectExistingNotebook(f.settings.root);
  assert.deepEqual(attachment.blockers, []);
  await device.store.attachExistingNotebook(attachment.root, attachment.fingerprint);
  assert.equal(device.settings.captureReceipts[draft.captureId], source.path);
  const retry = await device.store.previewCaptureRefresh(draft, source.path);
  assert.equal(retry.completed, true);
  await device.store.applyCaptureRefresh(draft, retry, []);
  assert.equal(await f.vault.read(source), sourceText);
  assert.deepEqual(contents(f), before);
});
