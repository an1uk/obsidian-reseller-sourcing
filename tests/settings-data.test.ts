import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings } from '../src/platform/settings-data';
import { DEFAULT_SETTINGS, type Settings } from '../src/types';

test('partial legacy settings receive defaults without mutating their loaded data', () => {
  const input = { root: 'Notebook', setupVersion: 5 };
  const settings = parseSettings(input); assert.equal(settings.root, 'Notebook'); assert.equal(settings.distanceUnit, 'miles'); assert.equal(settings.defaultSourceType, 'Charity shop');
  assert.deepEqual(input, { root: 'Notebook', setupVersion: 5 }); assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
});

test('typed settings retain import confirmations, receipts, hints and interrupted recovery', () => {
  const input: Settings = structuredClone(DEFAULT_SETTINGS);
  input.captureReceipts = { capture: 'Notebook/Places/Unassigned/Source.md' };
  input.captureSnapshots = { 'Notebook/Capture inbox/pending.md': { captureId: 'capture', revision: 'digest', reviewRequired: true } };
  input.areaHints = [{ id: 'hint', phrase: 'Fictional precinct', townPath: 'Notebook/Places/Exampletown/Exampletown.md', localityPath: 'Notebook/Places/Exampletown/Riverside/Riverside.md', enabled: false }];
  input.clipperImports = { shop: { fingerprint: 'fingerprint', release: '0.4.2', confirmedAt: '2026-10-18T10:00:00Z' } };
  input.migration = { id: 'move', kind: 'notebook', status: 'failed', backupRoot: 'Notebook/System/Backups/move', fromRoot: 'Notebook', toRoot: 'Moved', entries: [{ from: 'Notebook/Home.md', to: 'Moved/Home.md', beforeHash: 'before', afterHash: 'after', phase: 'updated' }], settingsBefore: { root: 'Notebook', assets: {}, captureReceipts: input.captureReceipts, captureSnapshots: input.captureSnapshots, previousRoots: [], recentLocalities: [], areaHints: input.areaHints }, error: 'Interrupted' };
  assert.deepEqual(parseSettings(input), input);
  const copy = parseSettings(input); copy.captureReceipts.capture = 'changed'; assert.equal(input.captureReceipts.capture, 'Notebook/Places/Unassigned/Source.md');
});

test('malformed JSON structures cannot silently discard capture or recovery safeguards', () => {
  for (const value of [[], 'settings', { captureReceipts: { capture: 7 } }, { captureSnapshots: { capture: { captureId: 'id', revision: [] } } }, { migration: { id: 'move', entries: [] } }, { tileSets: [{ id: 'bad' }] }, { areaHints: [null] }, { clipperImports: { shop: { release: '0.4.2' } } }]) assert.throws(() => parseSettings(value), /invalid/);
});
