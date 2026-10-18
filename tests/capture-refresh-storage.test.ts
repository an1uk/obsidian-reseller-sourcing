import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { SourcingStore } from '../src/storage/store';
import { captureRefreshReceipts } from '../src/capture/refresh';
import { readNote, updateNoteProperty, writeNote } from '../src/storage/markdown';
import { fixture, newDraft } from './storage-fixtures';

const url = 'https://www.google.com/maps/place/Shop/@1,2,9z/data=!4m6!3m5!1s0xa:0xb!8m2!3d12.3!4d45.6!16sabc';
const hours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => day + ', 09:00 to 17:00');
async function ready() {
  const f = fixture(); f.app.vault.rename = f.vault.renameFile.bind(f.vault); await f.store.setup();
  const area = await f.store.ensureLocality('Exampletown');
  const source = await f.store.saveCapture({ ...newDraft('original'), url, name: 'Original', googleReviewCount: 2 }, area.path, 'Original');
  const p = readNote(await f.vault.read(source));
  p.properties.rating = 4.5; p.properties.shortlist = true; p.properties.comments = 'Personal sourcing judgement'; p.properties.last_visited = '2026-10-01';
  p.properties.parking_location = '[[Shared parking]]'; p.properties.custom_fact = 'retain'; p.properties.shop_closed = true;
  const body = p.body + '\r\nPersonal body **exact bytes**\r\n## Visit log\r\n### A previous visit\r\nKeep me\r\n';
  await f.vault.process(source, () => writeNote(p.properties, body));
  const capture = await f.vault.create('Reseller sourcing/Capture inbox/Refresh.md', writeNote({
    sourcing_capture: 1, template_version: 2, capture_kind: 'shop', google_name: 'New Google name', google_maps_url: url.replace('@1,2,9z', '@20,30,7z'),
    address: '22 Main Street, Exampletown AB1 2CD', website: 'https://example.org/', telephone: '01632 960456',
    google_rating_raw: '4.7', google_review_count_raw: '0', google_hours_raw: hours, google_review_topics_raw: ['helpful staff, mentioned in 4 reviews'],
    captured_at: '2026-10-17T12:00:00Z',
  }, 'Raw capture text is preserved\n'));
  const rawCapture = await f.vault.read(capture), draft = await f.store.draft(capture);
  return { ...f, source, capture, rawCapture, draft, body };
}
test('refresh reads are nonmutating, match before area creation and show source filenames', async () => {
  const f = await ready(), before = new Map([...f.vault.entries].map(([path, entry]) => [path, entry.text]));
  const settings = structuredClone(f.settings);
  assert.deepEqual((await f.store.captureRefreshMatches(f.draft)).map(place => place.path), [f.source.path]);
  const p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  assert.equal(p.targetName, 'Original'); assert.equal(p.completed, false);
  assert.equal(p.fields.find(row => row.key === 'google_reviews')?.selected, true);
  assert.equal(p.fields.find(row => row.key === 'coordinates')?.selected, false);
  assert.deepEqual(new Map([...f.vault.entries].map(([path, entry]) => [path, entry.text])), before); assert.deepEqual(f.settings, settings);
});
test('selected updates and receipt save together while body, personal properties and unchecked coordinates survive', async () => {
  const f = await ready();
  await f.vault.process(f.source, text => updateNoteProperty(text, 'coordinates', [54, -2]));
  const p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  const before = readNote(await f.vault.read(f.source)).properties;
  const saved = await f.store.applyCaptureRefresh(f.draft, p, ['google_name', 'website', 'telephone', 'google_reviews', 'google_hours', 'google_review_topics']);
  assert.equal(saved.path, f.source.path);
  const n = readNote(await f.vault.read(saved));
  assert.equal(n.body, f.body); assert.equal(n.properties.google_name, 'New Google name'); assert.equal(n.properties.google_review_count, 0);
  assert.equal(n.properties.google_checked, '2026-10-17'); assert.equal(n.properties.google_hours_checked, '2026-10-17');
  assert.equal(n.properties.google_review_topics_checked, '2026-10-17'); assert.deepEqual(n.properties.google_hours, hours);
  for (const key of ['tags', 'source_type', 'rating', 'shortlist', 'comments', 'last_visited', 'shop_closed', 'parking_location', 'custom_fact', 'coordinates', 'source_capture_id', 'locality', 'address'])
    assert.deepEqual(n.properties[key], before[key], key);
  assert.equal(captureRefreshReceipts(n.properties).length, 1);
  const archived = f.vault.getAbstractFileByPath('Reseller sourcing/System/Capture archive/' + f.draft.captureId + '.md') as TFile;
  assert.equal(await f.vault.read(archived), f.rawCapture);
  assert.equal(f.settings.captureReceipts[f.draft.captureId], f.source.path);
});
test('empty selection records explicit keep/archive and cancellation leaves raw capture pending', async () => {
  const f = await ready(), before = readNote(await f.vault.read(f.source));
  await f.store.previewCaptureRefresh(f.draft, f.source.path);
  assert.ok(f.vault.getAbstractFileByPath(f.capture.path));
  const p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  await f.store.applyCaptureRefresh(f.draft, p, []);
  const after = readNote(await f.vault.read(f.source)); assert.equal(after.body, before.body);
  const { source_refresh_receipts, ...properties } = after.properties; assert.deepEqual(properties, before.properties);
  assert.deepEqual(captureRefreshReceipts(after.properties)[0]?.fields, []);
});
test('changed compared properties reject stale apply; concurrent personal prose survives atomic save', async () => {
  const f = await ready(), p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  await f.vault.process(f.source, text => updateNoteProperty(text, 'website', 'https://other.example/'));
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name']), /source changed/);
  assert.ok(f.vault.getAbstractFileByPath(f.capture.path));
  const fresh = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  f.vault.beforeProcess = (path, text) => path === f.source.path ? text + '\nConcurrent prose\n' : text;
  await f.store.applyCaptureRefresh(f.draft, fresh, ['google_name']);
  assert.equal(readNote(await f.vault.read(f.source)).body, f.body + '\nConcurrent prose\n');
});
test('atomic comparison catches updates made after preview validation and never writes partial fields', async () => {
  const f = await ready(), p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  f.vault.beforeProcess = (_path, text) => updateNoteProperty(text, 'google_name', 'Concurrent Google edit');
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name', 'website']), /source changed/);
  const properties = readNote(await f.vault.read(f.source)).properties;
  assert.equal(properties.google_name, 'Concurrent Google edit'); assert.equal(properties.website, '');
  assert.equal(properties.source_refresh_receipts, undefined); assert.ok(f.vault.getAbstractFileByPath(f.capture.path));
});
test('raw capture revision is revalidated, and edited UI draft fields cannot alter raw incoming facts', async () => {
  const f = await ready(), p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  await f.vault.process(f.capture, text => text + '\nRaw changed');
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name']), /capture changed/);
  const freshDraft = await f.store.draft(f.capture), fresh = await f.store.previewCaptureRefresh(freshDraft, f.source.path);
  await f.store.applyCaptureRefresh({ ...freshDraft, name: 'Tampered draft' }, fresh, ['google_name']);
  assert.equal(readNote(await f.vault.read(f.source)).properties.google_name, 'New Google name');
});
test('settings failure retries finish archival without reapplying updates after later source changes', async () => {
  const f = await ready(), p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  let fail = true;
  const store = new SourcingStore(f.app, f.settings, async () => { if (fail) { fail = false; throw Error('Simulated settings failure'); } await f.save(); });
  await assert.rejects(store.applyCaptureRefresh(f.draft, p, ['google_name']), /decision is saved.*not be applied again/);
  await f.vault.process(f.source, text => updateNoteProperty(updateNoteProperty(text, 'google_name', 'Later manual name'), 'google_maps_url', 'https://www.google.com/maps/place/ManuallyCorrected'));
  const matched = await store.captureRefreshMatches(f.draft); assert.equal(matched[0]?.path, f.source.path);
  const completed = await store.previewCaptureRefresh(f.draft, f.source.path); assert.equal(completed.completed, true);
  await store.applyCaptureRefresh(f.draft, p, ['google_name']);
  assert.equal(readNote(await f.vault.read(f.source)).properties.google_name, 'Later manual name');
  assert.equal(captureRefreshReceipts(readNote(await f.vault.read(f.source)).properties).length, 1);
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath('Reseller sourcing/System/Capture archive/' + f.draft.captureId + '.md') as TFile), f.rawCapture);
});
test('archive failure recovers from portable receipt after settings are lost and never reapplies selected fields', async () => {
  const f = await ready(), p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  f.vault.failRename = true;
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name']), /decision is saved/);
  delete f.settings.captureReceipts[f.draft.captureId];
  await f.vault.process(f.source, text => updateNoteProperty(text, 'google_name', 'Later name'));
  const restarted = new SourcingStore(f.app, f.settings, f.save);
  await restarted.applyCaptureRefresh(f.draft, p, ['google_name']);
  assert.equal(readNote(await f.vault.read(f.source)).properties.google_name, 'Later name');
  assert.equal(captureRefreshReceipts(readNote(await f.vault.read(f.source)).properties).length, 1);
});
test('multiple exact matches require explicit target and unmatched or parking targets cannot refresh', async () => {
  const f = await ready(), secondPath = f.source.path.replace('Original.md', 'Duplicate.md');
  await f.vault.create(secondPath, await f.vault.read(f.source));
  assert.equal((await f.store.captureRefreshMatches(f.draft)).length, 2);
  const p = await f.store.previewCaptureRefresh(f.draft, secondPath); await f.store.applyCaptureRefresh(f.draft, p, ['google_name']);
  assert.equal(readNote(await f.vault.read(f.source)).properties.google_name, 'Original');
  const other = await ready();
  await other.vault.process(other.source, text => updateNoteProperty(text, 'google_maps_url', 'https://www.google.com/maps/place/Another'));
  assert.equal((await other.store.captureRefreshMatches(other.draft)).length, 0);
  const mismatch = await other.store.previewCaptureRefresh(other.draft, other.source.path);
  await assert.rejects(other.store.applyCaptureRefresh(other.draft, mismatch, []), /no longer matches/);
  assert.deepEqual(await other.store.captureRefreshMatches({ ...other.draft, kind: 'parking' }), []);
});
test('unfinished outing operation blocks new updates to that source only', async () => {
  const f = await ready();
  f.store.outings.list = async () => [{ operation: { sourcePath: f.source.path } }] as never;
  const p = await f.store.previewCaptureRefresh(f.draft, f.source.path); assert.ok(p.blockers.some(value => /unfinished/.test(value)));
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name']), /unfinished/);
  f.store.outings.list = async () => [{ operation: { sourcePath: 'Other source.md' } }] as never;
  assert.equal((await f.store.previewCaptureRefresh(f.draft, f.source.path)).blockers.length, 0);
});

test('known receipt collisions reject before updating any source property or portable receipt', async () => {
  const f = await ready(), p = await f.store.previewCaptureRefresh(f.draft, f.source.path), before = await f.vault.read(f.source);
  f.settings.captureReceipts[f.draft.captureId] = 'Reseller sourcing/Places/Other.md';
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name']), /receipt points to another/);
  assert.equal(await f.vault.read(f.source), before); assert.ok(f.vault.getAbstractFileByPath(f.capture.path));
});
test('review-only refresh does not falsely redates legacy topics or untouched body hours', async () => {
  const f = await ready();
  const legacy = readNote(await f.vault.read(f.source));
  delete legacy.properties.google_review_topics_checked; delete legacy.properties.google_hours_checked; delete legacy.properties.google_hours;
  legacy.properties.google_checked = '2026-10-14';
  const body = legacy.body + '\n> [!info]- Opening hours and Google details\n> Google: 4.3 / 5; checked 2026-10-14\n> **Opening hours**\n' + hours.map(row => '> - ' + row).join('\n') + '\n';
  await f.vault.process(f.source, () => writeNote(legacy.properties, body));
  const p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  await f.store.applyCaptureRefresh(f.draft, p, ['google_reviews']);
  const n = readNote(await f.vault.read(f.source)); assert.equal(n.body, body); assert.equal(n.properties.google_checked, '2026-10-17');
  const completed = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  assert.equal((completed.fields.find(row => row.key === 'google_hours')!.current as { checked: string }).checked, '2026-10-14');
  assert.equal((completed.fields.find(row => row.key === 'google_review_topics')!.current as { checked: string }).checked, '2026-10-14');
});

test('refresh archival preserves raw relative links and markers while updating ordinary inbound links', async () => {
  const f = await ready();
  const relativeRaw = f.rawCapture + '\n[[./Sibling]]\n[relative](Sibling.md)\n<!-- codex-generated: 2026-10-01 -->\nOriginal raw text\n<!-- /codex-generated -->\n';
  await f.vault.process(f.capture, () => relativeRaw);
  await f.vault.create('Reseller sourcing/Capture inbox/Sibling.md', 'Original sibling\n');
  const otherRaw = await f.vault.create('Reseller sourcing/Capture inbox/Other.md', writeNote({ sourcing_capture: 1 }, '[[./Refresh]]\n[raw](Refresh.md)\n'));
  const otherRawBefore = await f.vault.read(otherRaw);
  const inbound = await f.vault.create('Outside.md', '<!-- codex-generated: 2026-10-01 -->\nPersonal provenance\n<!-- /codex-generated -->\n[[Reseller sourcing/Capture inbox/Refresh|Capture]]\n[capture](Reseller%20sourcing/Capture%20inbox/Refresh.md#snapshot)\n');
  const draft = await f.store.draft(f.capture), p = await f.store.previewCaptureRefresh(draft, f.source.path);
  f.app.fileManager.renameFile = async () => { throw new Error('FileManager archival must never run for a refresh'); };
  await f.store.applyCaptureRefresh(draft, p, ['google_name']);
  const archivePath = 'Reseller sourcing/System/Capture archive/' + draft.captureId + '.md';
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(archivePath) as TFile), relativeRaw);
  assert.equal(await f.vault.read(otherRaw), otherRawBefore);
  const links = await f.vault.read(inbound);
  assert.ok(links.includes('[[' + archivePath.replace(/\.md$/, '') + '|Capture]]'));
  assert.ok(links.includes(encodeURI(archivePath) + '#snapshot'));
  assert.match(links, /codex-generated: 2026-10-01/);
  assert.equal(readNote(await f.vault.read(f.source)).body, f.body);
  assert.equal(f.settings.migration, undefined);
  assert.ok(f.vault.getFiles().some(file => /Migration backups\/.*\/complete\.json$/.test(file.path)));
});

test('failed inbound-link write rolls only archive work back, preserving applied source decision for retry', async () => {
  const f = await ready(), raw = f.rawCapture + '\n[[./Sibling]]\n[relative](Sibling.md)\n';
  await f.vault.process(f.capture, () => raw); await f.vault.create('Reseller sourcing/Capture inbox/Sibling.md', 'Sibling');
  const inbound = await f.vault.create('Outside.md', '[[Reseller sourcing/Capture inbox/Refresh]]\n');
  const before = await f.vault.read(inbound), draft = await f.store.draft(f.capture), p = await f.store.previewCaptureRefresh(draft, f.source.path);
  const process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (file, callback) => {
    if (file.path === inbound.path && fail) { fail = false; throw new Error('Simulated backlink write interruption'); }
    return process(file, callback);
  };
  await assert.rejects(f.store.applyCaptureRefresh(draft, p, ['google_name']), /rolled back to the inbox/);
  assert.equal(await f.vault.read(f.capture), raw); assert.equal(await f.vault.read(inbound), before);
  const saved = readNote(await f.vault.read(f.source)); assert.equal(saved.properties.google_name, 'New Google name');
  assert.equal(saved.body, f.body); assert.equal(captureRefreshReceipts(saved.properties).length, 1); assert.equal(f.settings.migration, undefined);
  await f.vault.process(f.source, text => updateNoteProperty(text, 'google_name', 'Later correction'));
  await f.store.applyCaptureRefresh(draft, p, ['google_name']);
  assert.equal(readNote(await f.vault.read(f.source)).properties.google_name, 'Later correction');
  assert.equal(captureRefreshReceipts(readNote(await f.vault.read(f.source)).properties).length, 1);
  assert.ok((await f.vault.read(inbound)).includes('/System/Capture archive/' + draft.captureId));
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath('Reseller sourcing/System/Capture archive/' + draft.captureId + '.md') as TFile), raw);
});

test('concurrent inbound edits prevent unsafe archive rollback and retain the verified recovery journal', async () => {
  const f = await ready(), inbound = await f.vault.create('Outside.md', '[[Reseller sourcing/Capture inbox/Refresh]]\n');
  const original = await f.vault.read(inbound), p = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  const process = f.vault.process.bind(f.vault); let fail = true;
  f.vault.process = async (file, callback) => {
    if (file.path === inbound.path && fail) {
      fail = false; f.vault.entries.get(file.path)!.text = original + 'Concurrent personal edit\n';
      throw new Error('Link update interrupted after a concurrent edit');
    }
    return process(file, callback);
  };
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name']), /needs move recovery/);
  assert.equal(f.settings.migration?.kind, 'capture-archive');
  assert.equal(f.settings.migration?.status, 'failed');
  const blocked = await f.store.previewCaptureRefresh(f.draft, f.source.path);
  assert.ok(blocked.blockers.some(value => /Setup.*recovery/.test(value)));
  assert.equal(await f.vault.read(inbound), original + 'Concurrent personal edit\n');
  assert.equal(readNote(await f.vault.read(f.source)).properties.google_name, 'New Google name');
  assert.equal(captureRefreshReceipts(readNote(await f.vault.read(f.source)).properties).length, 1);
  await assert.rejects(f.store.applyCaptureRefresh(f.draft, p, ['google_name']), /interrupted move needs recovery/);
  // Explicitly restore the fixture's concurrent edit, then use the existing guarded recovery operation.
  f.vault.entries.get(inbound.path)!.text = original;
  await f.store.rollbackMove();
  assert.equal(await f.vault.read(f.capture), f.rawCapture);
  assert.equal(readNote(await f.vault.read(f.source)).properties.google_name, 'New Google name');
  await f.store.applyCaptureRefresh(f.draft, p, ['google_name']);
  assert.equal(f.settings.migration, undefined);
});
