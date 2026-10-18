import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { parse } from 'yaml';
import { ExamplesManager, examplesStatePath, parseExamplesState, encodeExamplesState } from '../src/examples/state';
import { buildExamplePack } from '../src/examples/pack';
import { MutationCoordinator } from '../src/storage/coordinator';
import { SourcingStore } from '../src/storage/store';
import { hashText, readNote, updateNoteProperty } from '../src/storage/markdown';
import { fixture } from './storage-fixtures';

async function ready() {
  const f = fixture(), coordinator = new MutationCoordinator();
  f.app.vault.rename = f.vault.renameFile.bind(f.vault);
  const live = new SourcingStore(f.app, f.settings, f.save, { coordinator });
  await live.setup();
  const manager = new ExamplesManager(f.app, () => live.root, coordinator, () => f.settings);
  return { ...f, coordinator, live, manager };
}
const inventory = (f: Awaited<ReturnType<typeof ready>>) => new Map([...f.vault.entries].map(([path, file]) => [path, file.text]));
async function capture(session: NonNullable<Awaited<ReturnType<ExamplesManager['open']>>>, matching: boolean) {
  for (const file of await session.store.captures()) {
    const draft = await session.store.draft(file);
    const matches = await session.store.captureRefreshMatches(draft);
    if (!!matches.length === matching) return { draft, matches, raw: await session.store.app.vault.read(file) };
  }
  throw new Error('The practice pack needs creation and refresh captures.');
}
test('Examples are explicit, isolated and never repaired or recreated by ordinary setup', async () => {
  const f = await ready(), before = inventory(f);
  assert.equal((await f.manager.inspect()).state, 'missing');
  assert.equal(await f.manager.open(), null); assert.deepEqual(inventory(f), before);
  await f.manager.add(); const session = (await f.manager.open())!;
  assert.equal((await f.manager.inspect()).state, 'ready');
  assert.equal(session, await f.manager.open());
  assert.ok((await session.store.listPlaces()).length >= 20);
  assert.ok((await session.store.listLocalities()).length >= 3);
  assert.ok((await session.store.outings.list()).length >= 1);
  assert.ok((await session.store.captures()).length >= 2);
  assert.equal((await f.live.listPlaces()).length, 0); assert.equal((await f.live.captures()).length, 0);
  assert.equal((await f.live.listLocalities()).length, 0); assert.equal((await f.live.outings.list()).length, 0);
  assert.equal(f.settings.root, 'Reseller sourcing'); assert.deepEqual(f.settings.captureReceipts, {});
  const source = (await session.store.listPlaces()).find(place => place.kind === 'shop')!;
  const file = f.vault.getAbstractFileByPath(source.path) as TFile;
  await f.vault.process(file, text => text + '\nMy edited fictional source\n');
  const edited = await f.vault.read(file);
  await f.manager.add(); await f.live.setup(); assert.equal(await f.vault.read(file), edited);
  for (const path of [...f.vault.entries.keys()]) if (path === session.root || path.startsWith(session.root + '/')) f.vault.entries.delete(path);
  await assert.rejects(session.store.ensureLocality('Stale town'), /deleted|changed/);
  await f.live.setup(); assert.equal(await f.manager.open(), null); assert.equal((await f.manager.inspect()).state, 'missing');
  assert.equal(f.vault.getFiles().some(file => file.path.includes('/Examples/')), false);
});
test('practice assessment, contacts, visits, parking and outings affect only the example notebook', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!, places = await session.store.listPlaces();
  const sources = places.filter(place => place.kind === 'shop'), parking = places.find(place => place.kind === 'parking')!;
  const a = sources[0]!, b = sources[1]!, sourceFile = f.vault.getAbstractFileByPath(a.path) as TFile;
  const outside = new Map([...inventory(f)].filter(([path]) => !path.startsWith(session.root + '/')));
  await session.store.updateAssessment(a.path, { rating: 3.5, shortlist: true, comments: 'Practice judgement' });
  await session.store.updateContact(a.path, { website: 'https://example.org/', telephone: '01632 960456' });
  await session.store.addVisit(a.path, { observations: 'Fictional visit', finds: 'Imaginary cardigan', nextTime: 'Bring a larger imaginary bag', visitDate: '2026-10-01', updateLastVisited: false });
  await session.store.linkParking(parking.path, a.path, true); await session.store.linkParking(parking.path, b.path);
  const properties = readNote(await f.vault.read(sourceFile)).properties;
  assert.equal(properties.rating, 3.5); assert.equal(properties.shortlist, true); assert.equal(properties.comments, 'Practice judgement');
  assert.equal(properties.sourcing_example, true); assert.ok(String(properties.parking_location).includes(parking.path.replace(/\.md$/, '')));
  const outing = await session.store.outings.create({ name: 'Practice outing from controls', groups: [{ id: 'practice-group', parkingPath: parking.path, stops: [{ id: 'practice-stop', sourcePath: a.path, status: 'pending' }] }] });
  assert.equal(readNote(await f.vault.read(f.vault.getAbstractFileByPath(outing.path) as TFile)).properties.sourcing_example, true);
  assert.equal((await f.live.outings.list()).length, 0);
  assert.deepEqual(new Map([...inventory(f)].filter(([path]) => !path.startsWith(session.root + '/'))), outside);
});
test('new practice areas and map camera changes retain their practice-only Base context', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const area = await session.store.ensureLocality('Fictional Umbrella District');
  const file = f.vault.getAbstractFileByPath(area.path) as TFile;
  assert.equal(readNote(await f.vault.read(file)).properties.sourcing_example, true);
  assert.equal(f.vault.getAbstractFileByPath(session.root + '/Places/Fictional Umbrella District/Area map.base'), null);
  const path = session.root + '/System/Sources.base', base = f.vault.getAbstractFileByPath(path) as TFile;
  let document = parse(await f.vault.read(base));
  assert.ok(document.filters.and.includes('note.sourcing_example == true')); assert.ok(!document.filters.and.includes('note.sourcing_example != true'));
  assert.equal(document.views[0].notebookRoot, session.root); assert.equal(document.views[0].notebookBasePath, path);
  await session.store.updateMapView(path, 'Map', 'center', '[51.5,-0.1]');
  await session.store.updateMapView(path, 'Map', 'defaultZoom', 17.5);
  document = parse(await f.vault.read(base)); assert.equal(document.views[0].center, '[51.5,-0.1]'); assert.equal(document.views[0].defaultZoom, 17.5);
  await assert.rejects(session.store.updateMapView(path, 'Map', 'center', '[100,0]'), /valid map centre/);
  await assert.rejects(session.store.updateMapView('Reseller sourcing/System/Sources.base', 'Map', 'defaultZoom', 12), /outside/);
  await assert.rejects(session.store.setup(), /explicitly/); await assert.rejects(session.store.previewNotebookMove('Another root'), /worked examples/);
});
test('prepared creation and refresh captures preserve raw bytes and separate receipts from live settings', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const creation = await capture(session, false);
  const saved = await session.store.saveCapture(creation.draft, { town: 'Practiceville', locality: '' }, 'Brand new fictional source');
  assert.equal(readNote(await f.vault.read(saved)).properties.sourcing_example, true);
  const archive = f.vault.getAbstractFileByPath(session.root + '/System/Capture archive/' + creation.draft.captureId + '.md') as TFile;
  assert.equal(await f.vault.read(archive), creation.raw);
  const refresh = await capture(session, true), target = refresh.matches[0]!;
  const preview = await session.store.previewCaptureRefresh(refresh.draft, target.path);
  await session.store.applyCaptureRefresh(refresh.draft, preview, []);
  assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(session.root + '/System/Capture archive/' + refresh.draft.captureId + '.md') as TFile), refresh.raw);
  assert.equal(session.settings.captureReceipts[creation.draft.captureId], saved.path);
  assert.deepEqual(f.settings.captureReceipts, {}); assert.deepEqual(f.settings.captureSnapshots, {});
  const nextDevice = new ExamplesManager(f.app, () => f.live.root, new MutationCoordinator(), () => f.settings);
  const reopened = (await nextDevice.open())!;
  assert.equal(reopened.contextId, session.contextId); assert.equal(reopened.settings.captureReceipts[creation.draft.captureId], saved.path);
});
test('practice state CAS rejects external changes and fresh open replaces the stale session without data loss', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!, place = (await session.store.listPlaces())[0]!;
  const file = f.vault.getAbstractFileByPath(place.path) as TFile, before = await f.vault.read(file);
  const stateFile = f.vault.getAbstractFileByPath(examplesStatePath(session.root)) as TFile;
  await f.vault.process(stateFile, raw => { const state = parseExamplesState(raw, session.root); state.settings.defaultSourceType = 'Imaginary rag house'; return encodeExamplesState(state); });
  await assert.rejects(session.store.updateCoordinates(place.path, [1, 2]), /changed.*elsewhere|changed on another/);
  assert.equal(await f.vault.read(file), before);
  const fresh = (await f.manager.open())!; assert.notEqual(fresh.id, session.id);
  assert.equal(fresh.settings.defaultSourceType, 'Imaginary rag house');
  await assert.rejects(session.store.ensureLocality('Old context'), /changed|deleted/);
  const area = await fresh.store.ensureLocality('New context town'); assert.ok(area.path.startsWith(fresh.root + '/'));
  assert.equal(fresh, await f.manager.open());
});
test('partial installation resumes only on explicit Add and refuses to overwrite edited partial components', async () => {
  const f = await ready(), create = f.vault.create.bind(f.vault); let written = 0, fail = true;
  f.vault.create = async (path, text) => {
    if (path.includes('/Examples/') && !path.endsWith('/Practice state.json') && ++written === 3 && fail) { fail = false; throw new Error('Install interrupted'); }
    return create(path, text);
  };
  await assert.rejects(f.manager.add(), /Install interrupted/);
  assert.equal((await f.manager.inspect()).state, 'partial'); assert.equal(await f.manager.open(), null);
  const before = inventory(f); await f.live.setup(); assert.deepEqual(inventory(f), before);
  await f.manager.add(); assert.equal((await f.manager.inspect()).state, 'ready');
  const g = await ready(), gcreate = g.vault.create.bind(g.vault); let once = true, count = 0;
  g.vault.create = async (path, text) => { if (path.includes('/Examples/') && !path.endsWith('/Practice state.json') && ++count === 3 && once) { once = false; throw new Error('Interrupt'); } return gcreate(path, text); };
  await assert.rejects(g.manager.add(), /Interrupt/);
  const edited = g.vault.getFiles().find(file => file.path.startsWith(g.manager.root + '/') && file.extension === 'md')!;
  await g.vault.process(edited, raw => raw + '\nPersonal practice edit\n');
  const snapshot = inventory(g); await assert.rejects(g.manager.add(), /edited or occupied/); assert.deepEqual(inventory(g), snapshot);
});
test('fictional records copied into live folders remain excluded from live queries and attachment', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const source = (await session.store.listPlaces()).find(place => place.kind === 'shop')!;
  const path = f.live.root + '/Places/Copy of fictional source.md';
  const copy = await f.vault.create(path, await f.vault.read(f.vault.getAbstractFileByPath(source.path) as TFile));
  assert.equal((await f.live.listPlaces()).length, 0);
  await assert.rejects(f.live.updateAssessment(path, { rating: 5 }), /Choose/);
  await assert.rejects(f.live.addVisit(path, { observations: 'No', finds: '', nextTime: '', visitDate: '2026-10-01', updateLastVisited: false }), /Choose a source in this notebook/);
  await assert.rejects(f.live.updateContact(path, { website: '', telephone: '' }), /Choose/);
  const pending = (await session.store.captures())[0]!, copied = await f.vault.create(f.live.root + '/Capture inbox/Fictional.md', await f.vault.read(pending));
  assert.equal((await f.live.captures()).length, 0); await assert.rejects(f.live.draft(copied), /Fictional/);
  const attached = await f.live.inspectExistingNotebook(f.live.root); assert.equal(attached.counts.sources, 0); assert.equal(attached.counts.pendingCaptures, 0);
  const rejected = await f.live.inspectExistingNotebook(session.root); assert.ok(rejected.blockers.some(value => /fictional practice/.test(value)));
  assert.equal(readNote(await f.vault.read(copy)).properties.sourcing_example, true);
  const visit=(await session.store.visits.list())[0]!;await f.vault.create(f.live.root+'/Visits/Copy of fictional visit.md',await f.vault.read(f.vault.getAbstractFileByPath(visit.path) as TFile));assert.equal((await f.live.visits.list()).length,0);
});
test('practice area moves reject external backlinks before writing any real note', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const source = (await session.store.listPlaces()).find(place => place.kind === 'shop')!;
  const external = await f.vault.create('Real personal note.md', '[[' + source.path.replace(/\.md$/, '') + ']]\n');
  const before = inventory(f);
  const preview = await session.store.previewPlaceAreaChange(source.path, { town: 'Other fictional town', locality: '' });
  assert.ok(preview.conflicts.some(value => /outside Examples/.test(value)));
  await assert.rejects(session.store.changePlaceArea(source.path, { town: 'Other fictional town', locality: '' }, preview), /conflicts/);
  assert.deepEqual(inventory(f), before); assert.match(await f.vault.read(external), /Examples/);
});
test('shared coordinator serialises practice and live operations, including failures', async () => {
  const coordinator = new MutationCoordinator(), events: string[] = []; let finish!: () => void;
  const first = coordinator.run(async () => { events.push('first'); await new Promise<void>(resolve => finish = resolve); throw new Error('Expected'); });
  const second = coordinator.run(async () => { events.push('second'); return 2; });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.deepEqual(events, ['first']);
  finish(); await assert.rejects(first, /Expected/); assert.equal(await second, 2); assert.deepEqual(events, ['first', 'second']);
});
test('parent root moves carry practice state, raw captures and opaque migration backups without reseeding', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const refresh = await capture(session, true);
  await session.store.applyCaptureRefresh(refresh.draft, await session.store.previewCaptureRefresh(refresh.draft, refresh.matches[0]!.path), []);
  const remaining = (await session.store.captures())[0]!, raw = await f.vault.read(remaining), originalPath = remaining.path;
  const body = raw + '\n[[./Sibling]]\n[relative](Sibling.md)\n';
  await f.vault.process(remaining, () => body); await session.store.draft(remaining);
  await f.vault.create(session.root + '/Capture inbox/Sibling.md', 'Sibling raw reference');
  const opaque = f.vault.getFiles().filter(file => file.path.startsWith(session.root + '/System/Migration backups/'));
  assert.ok(opaque.length > 0);
  const opaqueBefore = new Map(await Promise.all(opaque.map(async file => [file.path, await f.vault.read(file)] as const)));
  const previousRoot = f.live.root, preview = await f.live.previewNotebookMove('Moved reseller notebook');
  assert.deepEqual(preview.conflicts, []);
  assert.ok(opaque.every(file => preview.entries.some(entry => entry.from === file.path && entry.beforeHash === entry.afterHash && entry.text === undefined)));
  await f.live.moveNotebook('Moved reseller notebook', preview);
  const movedRoot = f.live.root + '/Examples', state = parseExamplesState(await f.vault.read(f.vault.getAbstractFileByPath(examplesStatePath(movedRoot)) as TFile), movedRoot);
  assert.equal(state.settings.root, movedRoot);
  for (const [path, asset] of Object.entries(state.settings.assets)) assert.equal(await hashText(await f.vault.read(f.vault.getAbstractFileByPath(path) as TFile)), asset.hash);
  const movedCapture = f.vault.getAbstractFileByPath(f.live.root + originalPath.slice(previousRoot.length)) as TFile;
  assert.equal(await f.vault.read(movedCapture), body);
  assert.equal(state.settings.captureSnapshots[movedCapture.path]?.revision, await hashText(body));
  for (const [path, text] of opaqueBefore) assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(f.live.root + path.slice(previousRoot.length)) as TFile), text);
  const reopened = (await f.manager.open())!; assert.equal(reopened.contextId, session.contextId);
  await assert.rejects(session.store.ensureLocality('Stale moved context'), /changed|deleted/);
  const count = f.vault.getFiles().length; await f.manager.add(); assert.equal(f.vault.getFiles().length, count);
});

test('practice area changes really move one record and persist local recovery state without touching real notes', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const source = (await session.store.listPlaces()).find(place => place.kind === 'shop')!, originalName = source.path.split('/').at(-1);
  const raw = await f.vault.read(f.vault.getAbstractFileByPath(source.path) as TFile), outside = new Map([...inventory(f)].filter(([path]) => !path.startsWith(session.root + '/')));
  const area = { town: 'Patchworkford', locality: 'Button Quarter' }, preview = await session.store.previewPlaceAreaChange(source.path, area);
  assert.deepEqual(preview.conflicts, []);
  await session.store.changePlaceArea(source.path, area, preview);
  const moved = (await session.store.listPlaces()).find(place => place.properties.source_capture_id === source.properties.source_capture_id)!;
  assert.equal(moved.path.split('/').at(-1), originalName); assert.ok(moved.path.includes('/Patchworkford/Button Quarter/'));
  assert.equal(readNote(await f.vault.read(f.vault.getAbstractFileByPath(moved.path) as TFile)).body, readNote(raw).body);
  assert.equal(session.settings.migration, undefined); assert.equal(session, await f.manager.open());
  assert.deepEqual(new Map([...inventory(f)].filter(([path]) => !path.startsWith(session.root + '/'))), outside);
});
test('a parent move interrupted after moving practice state restores exact practice bytes on guarded rollback', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const before = new Map([...inventory(f)].filter(([path]) => path.startsWith(session.root + '/')));
  const rename = f.vault.renameFile.bind(f.vault); let fail = true;
  f.app.vault.rename = async (file, path) => {
    if (fail && file.path.startsWith(session.root + '/Places/')) { fail = false; throw new Error('Parent move interruption'); }
    return rename(file as TFile, path);
  };
  const preview = await f.live.previewNotebookMove('Relocated sourcing');
  await assert.rejects(f.live.moveNotebook('Relocated sourcing', preview), /Parent move interruption/);
  assert.equal(f.settings.migration?.kind, 'notebook');
  await f.live.rollbackMove();
  assert.equal(f.live.root, 'Reseller sourcing');
  assert.deepEqual(new Map([...inventory(f)].filter(([path]) => path.startsWith(session.root + '/'))), before);
  const reopened = (await f.manager.open())!; assert.equal(reopened.contextId, session.contextId);
});
test('Examples cannot create a missing real notebook or continue after their installation anchor is removed', async () => {
  const f = await ready();
  for (const path of [...f.vault.entries.keys()]) if (path === f.live.root || path.startsWith(f.live.root + '/')) f.vault.entries.delete(path);
  const before = inventory(f); await assert.rejects(f.manager.add(), /real notebook/); assert.deepEqual(inventory(f), before);
  const g = await ready(), create = g.vault.create.bind(g.vault); let remove = true;
  g.vault.create = async (path, text) => {
    const result = await create(path, text);
    if (remove && path.startsWith(g.manager.root + '/') && !path.endsWith('/Practice state.json')) {
      remove = false;
      for (const key of [...g.vault.entries.keys()]) if (key === g.manager.root || key.startsWith(g.manager.root + '/')) g.vault.entries.delete(key);
    }
    return result;
  };
  await assert.rejects(g.manager.add(), /removed|moved/);
  assert.equal(g.vault.getFiles().some(file => file.path.startsWith(g.manager.root + '/')), false);
  assert.equal(await g.manager.open(), null);
});
test('parent moves refuse unfinished practice visit recovery or invalid practice settings before writing', async () => {
  const f = await ready(); await f.manager.add(); const session = (await f.manager.open())!;
  const file = f.vault.getAbstractFileByPath(examplesStatePath(session.root)) as TFile;
  const original = await f.vault.read(file);
  await f.vault.process(file, raw => { const state = JSON.parse(raw); state.settings.root = f.live.root; return JSON.stringify(state); });
  const before = inventory(f), blocked = await f.live.previewNotebookMove('Other sourcing');
  assert.ok(blocked.conflicts.some(value => /Examples cannot be moved safely/.test(value)));
  await assert.rejects(f.live.moveNotebook('Other sourcing', blocked), /conflicts/); assert.deepEqual(inventory(f), before);
  await f.vault.process(file, () => original);
  assert.deepEqual((await f.live.previewNotebookMove('Other sourcing')).conflicts, []);
  const outing = (await session.store.outings.list()).find(record => record.groups.some(group => group.stops.some(stop => stop.status === 'pending')))!;
  const outingFile = f.vault.getAbstractFileByPath(outing.path) as TFile, outingRaw = await f.vault.read(outingFile);
  const stop = outing.groups.flatMap(group => group.stops).find(stop => stop.status === 'pending')!;
  const sourceFile = f.vault.getAbstractFileByPath(stop.sourcePath) as TFile, sourceRaw = await f.vault.read(sourceFile);
  await f.vault.process(outingFile, raw => {
    const data = readNote(raw).properties.outing as Record<string, unknown>;
    data.operation = { id: 'unfinished-practice-visit', stopId: stop.id, sourcePath: '[[' + stop.sourcePath.replace(/\.md$/, '') + ']]',
      input: { observations: 'Pending fictional visit', finds: '', nextTime: '', visitDate: '2026-10-01', updateLastVisited: false },
      recordedAt: '2026-10-17T12:00:00.000Z', sourceBeforeHash: 'a'.repeat(64), sourceIdentity: readNote(sourceRaw).properties.source_capture_id };
    return updateNoteProperty(raw, 'outing', data);
  });
  const unfinished = await f.live.previewNotebookMove('Other sourcing');
  assert.ok(unfinished.conflicts.some(value => /unfinished practice outing visit/.test(value)));
  await f.vault.process(outingFile, () => outingRaw);

});

test('an older interrupted examples pack explicitly resumes its original payload without adding new planner scaffolding',async()=>{
 const f=await ready(),root=f.manager.root,pack=await buildExamplePack(root,f.vault.getName(),1);
 pack.settings.setupVersion=10;for(const asset of Object.values(pack.settings.assets))asset.version=10;
 const files=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
 const state={format:'reseller-sourcing-examples' as const,schema:1 as const,instanceId:'legacy-pack-one',packVersion:1,phase:'installing' as const,settings:pack.settings,files};
 await f.vault.createFolder(root);await f.vault.createFolder(root+'/System');
 await f.vault.create(examplesStatePath(root),encodeExamplesState(state));
 for(const[path,text]of Object.entries(pack.files).slice(0,12))await f.vault.create(path,text);
 assert.equal((await f.manager.inspect()).state,'partial');await f.manager.add();
 assert.equal((await f.manager.inspect()).packVersion,1);
 for(const[path,text]of Object.entries(pack.files))assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(path) as TFile),text);
 assert.equal(f.vault.getAbstractFileByPath(root+'/Reference/Journey planning.md'),null);
 const before=inventory(f);await f.manager.add();assert.deepEqual(inventory(f),before);
});

test('version-two interrupted installation resumes its frozen payload without adding separate visits',async()=>{
 const f=await ready(),root=f.manager.root,pack=await buildExamplePack(root,f.vault.getName(),2);
 const files=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
 const state={format:'reseller-sourcing-examples' as const,schema:1 as const,instanceId:'legacy-pack-two',packVersion:2,phase:'installing' as const,settings:pack.settings,files};
 await f.vault.createFolder(root);await f.vault.createFolder(root+'/System');await f.vault.create(examplesStatePath(root),encodeExamplesState(state));
 for(const[path,text]of Object.entries(pack.files).slice(0,15))await f.vault.create(path,text);
 assert.equal((await f.manager.inspect()).state,'partial');await f.manager.add();
 assert.equal((await f.manager.inspect()).packVersion,2);assert.equal(Object.keys(pack.files).length,114);
 for(const[path,text]of Object.entries(pack.files))assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(path) as TFile),text);
 assert.ok(!f.vault.getFiles().some(file=>file.path.startsWith(root+'/Visits/')));assert.equal(f.vault.getAbstractFileByPath(root+'/Visits.md'),null);
 const before=inventory(f);await f.manager.add();assert.deepEqual(inventory(f),before);
});

test('ready version-one and version-two packs remain exact and unaugmented on open, add and repair',async()=>{
 for(const version of[1,2]){
  const f=await ready(),root=f.manager.root,pack=await buildExamplePack(root,f.vault.getName(),version);
  const files=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
  const state={format:'reseller-sourcing-examples' as const,schema:1 as const,instanceId:'ready-legacy-'+version,packVersion:version,phase:'ready' as const,settings:pack.settings,files};
  await f.vault.createFolder(root);await f.vault.createFolder(root+'/System');for(const[path,text]of Object.entries(pack.files))await f.vault.create(path,text);
  await f.vault.create(examplesStatePath(root),encodeExamplesState(state));
  const before=inventory(f),session=(await f.manager.open())!;assert.ok(session);assert.equal((await f.manager.inspect()).packVersion,version);
  await f.manager.add();await f.live.setup();f.manager.invalidate();assert.ok(await f.manager.open());assert.deepEqual(inventory(f),before);
  const removed=Object.keys(pack.files).find(path=>path.startsWith(root+'/Places/')&&path.endsWith('.md'))!;f.vault.entries.delete(removed);
  await f.manager.add();f.manager.invalidate();assert.ok(await f.manager.open());assert.equal(f.vault.getAbstractFileByPath(removed),null);
  assert.equal(f.vault.getAbstractFileByPath(root+'/Visits.md'),null);assert.ok(!f.vault.getFiles().some(file=>file.path.startsWith(root+'/Visits/')));
 }
});

test('deleting a nested v4 visit or its optional visit guide is permanent across reopen and repair',async()=>{
 const f=await ready();await f.manager.add();const session=(await f.manager.open())!,root=session.root;
 const visit=f.vault.getFiles().find(file=>file.path.startsWith(root+'/Visits/')&&file.extension==='md')!;
 assert.ok(visit);const guide=root+'/Guided tour/Visit comparisons.md';assert.ok(f.vault.getAbstractFileByPath(guide));
 f.vault.entries.delete(visit.path);f.vault.entries.delete(guide);const state=await f.vault.read(f.vault.getAbstractFileByPath(examplesStatePath(root)) as TFile);
 f.manager.invalidate();assert.ok(await f.manager.open());await f.live.setup();await f.manager.add();
 assert.equal(f.vault.getAbstractFileByPath(visit.path),null);assert.equal(f.vault.getAbstractFileByPath(guide),null);
 assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(examplesStatePath(root)) as TFile),state);
 assert.equal(f.vault.getFiles().filter(file=>file.path.startsWith(root+'/Visits/')).length,39);
});

test('version-three interrupted installation finishes its 158 original files without reorganising visits',async()=>{
 const f=await ready(),root=f.manager.root,pack=await buildExamplePack(root,f.vault.getName(),3);
 const files=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
 const state={format:'reseller-sourcing-examples' as const,schema:1 as const,instanceId:'legacy-pack-three',packVersion:3,phase:'installing' as const,settings:pack.settings,files};
 await f.vault.createFolder(root);await f.vault.createFolder(root+'/System');await f.vault.create(examplesStatePath(root),encodeExamplesState(state));
 for(const[path,text]of Object.entries(pack.files).slice(0,21))await f.vault.create(path,text);
 assert.equal((await f.manager.inspect()).state,'partial');await f.manager.add();
 assert.equal((await f.manager.inspect()).packVersion,3);assert.equal(Object.keys(pack.files).length,158);
 for(const[path,text]of Object.entries(pack.files))assert.equal(await f.vault.read(f.vault.getAbstractFileByPath(path) as TFile),text);
 const visits=f.vault.getFiles().filter(file=>file.path.startsWith(root+'/Visits/'));assert.equal(visits.length,40);
 assert.ok(visits.every(file=>!file.path.startsWith(root+'/Visits/2026/')));
 assert.equal(f.vault.getAbstractFileByPath(root+'/Reference/Everyday workflows.md'),null);
 const before=inventory(f);await f.manager.add();await f.live.setup();assert.deepEqual(inventory(f),before);
});
test('a ready v3 pack keeps personal edits and deleted records through open add and real repair',async()=>{
 const f=await ready(),root=f.manager.root,pack=await buildExamplePack(root,f.vault.getName(),3);
 const files=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
 const state={format:'reseller-sourcing-examples' as const,schema:1 as const,instanceId:'ready-legacy-three',packVersion:3,phase:'ready' as const,settings:pack.settings,files};
 await f.vault.createFolder(root);await f.vault.createFolder(root+'/System');for(const[path,text]of Object.entries(pack.files))await f.vault.create(path,text);
 await f.vault.create(examplesStatePath(root),encodeExamplesState(state));
 const home=f.vault.getAbstractFileByPath(root+'/Home.md') as TFile;await f.vault.process(home,raw=>raw+'\nMy preferred practice starting point.\n');
 const removed=Object.keys(pack.files).find(path=>path.startsWith(root+'/Visits/'))!;f.vault.entries.delete(removed);
 for(const path of [...f.vault.entries.keys()])if(path.startsWith(root+'/Guided tour/'))f.vault.entries.delete(path);
 const before=inventory(f);assert.ok(await f.manager.open());await f.manager.add();await f.live.setup();f.manager.invalidate();assert.ok(await f.manager.open());
 assert.deepEqual(inventory(f),before);assert.equal(f.vault.getAbstractFileByPath(removed),null);
 assert.ok(!f.vault.getFiles().some(file=>file.path.startsWith(root+'/Visits/2026/')));
 assert.equal(f.vault.getAbstractFileByPath(root+'/Reference/Everyday workflows.md'),null);
});
