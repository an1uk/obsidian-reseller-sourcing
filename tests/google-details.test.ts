import test from 'node:test';
import assert from 'node:assert/strict';
import { readGoogleHours, readGoogleTopics, validGoogleHours, validSnapshotDate } from '../src/domain/google-details';
import { writeNote } from '../src/storage/markdown';
import { extractSourceContext } from '../src/outings/domain';
import { bodyForPlace, bundledAssets } from '../src/storage/assets';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hours = days.map(day => day + ', 09:00 to 17:00');
const legacy = '> [!info]- Opening hours and Google details\n> Google: 4.2 · 12 reviews · checked 2026-10-01\n>\n> **Opening hours**\n>\n' + hours.map(row => '> - ' + row).join('\n') + '\n>\n> **Review topics**\n';

test('hours accept only complete unique weekdays and checked dates reject invalid calendar days', () => {
  assert.deepEqual(validGoogleHours(hours), hours);
  assert.deepEqual(validGoogleHours(hours.slice(1)), []);
  assert.deepEqual(validGoogleHours([...hours.slice(0, 6), hours[0]]), []);
  assert.deepEqual(validGoogleHours([...hours.slice(0, 6), 3]), []);
  assert.equal(validSnapshotDate('2026-02-30'), '');
  assert.equal(validSnapshotDate('2026-10-17'), '2026-10-17');
});

test('structured hours and their own date take priority without changing visit context', () => {
  const next = days.map(day => day + ', Closed');
  const text = writeNote({ google_hours: next, google_hours_checked: '2026-10-17', google_checked: '2026-10-18' },
    legacy + '\n## Visit log\n\n### 2026-10-17 12:00\nVisit date: 2026-10-16\n\n**Next time**\nCheck coats\n');
  assert.deepEqual(readGoogleHours(text), { hours: next, checked: '2026-10-17', legacy: false });
  const context = extractSourceContext(text);
  assert.deepEqual(context.hours, next); assert.equal(context.hoursChecked, '2026-10-17');
  assert.equal(context.reminder, 'Check coats'); assert.equal(context.reminderDate, '2026-10-16');
});

test('legacy hours keep the original body date after a review refresh', () => {
  const text = writeNote({ google_checked: '2026-10-17', source_refresh_receipts: [{}] }, legacy);
  assert.deepEqual(readGoogleHours(text), { hours, checked: '2026-10-01', legacy: true });
  assert.equal(extractSourceContext(text).hoursChecked, '2026-10-01');
});

test('partial structured hours never borrow a legacy checked date', () => {
  const undated = legacy.replace('> Google: 4.2 · 12 reviews · checked 2026-10-01\n', '');
  assert.equal(readGoogleHours(writeNote({ google_hours: ['Monday, Closed'], google_checked: '2026-10-17', source_refresh_receipts: [{}] }, undated)).checked, '');
  assert.equal(readGoogleHours(writeNote({ google_checked: '2026-10-01' }, undated)).checked, '2026-10-01');
  assert.equal(readGoogleHours(writeNote({ google_hours: hours }, legacy)).checked, '');
});

test('new source scaffolding uses current controls without duplicated body snapshots while parking stays compatible', () => {
  assert.equal(bodyForPlace().includes('Opening hours and Google details'), false);
  assert.ok(bodyForPlace(undefined, 'parking').includes('Opening hours and Google details'));
  const assets = bundledAssets('Notebook');
  assert.equal(assets['Notebook/System/Templates/Source.md']!.includes('Opening hours and Google details'), false);
  assert.ok(assets['Notebook/System/Templates/Parking.md']!.includes('Opening hours and Google details'));
});

test('unselected legacy topics keep their original date after only the review pair changes', () => {
  const text = writeNote({ google_review_topics: ['staff (2)'], google_checked: '2026-10-17', source_refresh_receipts: [{}] }, legacy);
  assert.deepEqual(readGoogleTopics(text), { topics: ['staff (2)'], checked: '2026-10-01', legacy: true });
  assert.equal(readGoogleTopics(writeNote({ google_review_topics: ['stock (3)'], google_checked: '2026-10-17', google_review_topics_checked: '2026-10-16' }, legacy)).checked, '2026-10-16');
  assert.equal(readGoogleTopics(writeNote({ google_review_topics: ['staff (2)'], google_checked: '2026-10-17', source_refresh_receipts: [{}] }, '')).checked, '');
});

test('manual freeform hours remain visible without inferring a complete weekly schedule', () => {
  const text = writeNote({ google_hours: ['Usually open afternoons', 'Call before travelling'], google_hours_checked: '2026-10-17' }, legacy);
  assert.deepEqual(readGoogleHours(text), { hours: ['Usually open afternoons', 'Call before travelling'], checked: '2026-10-17', legacy: false });
  assert.deepEqual(extractSourceContext(text).hours, []);
  assert.equal(extractSourceContext(text).hoursChecked, '');
  assert.deepEqual(readGoogleHours(writeNote({ google_hours: [] }, legacy)).hours, []);
});
