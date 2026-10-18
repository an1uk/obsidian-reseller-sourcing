import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { NotebookPaths } from '../src/storage/paths';
import { routeForPath, checkedRoute } from '../src/workspace/routes';
import type { OutingPreparation, PlacePreparation, PreparationDraft } from '../src/workspace/types';
import { buildExamplePack } from '../src/examples/pack';
import { hashText, readNote } from '../src/storage/markdown';

const draft = <T>(data:T,kind:'outing'|'place'='outing'):PreparationDraft<T> => ({schema:1,id:crypto.randomUUID(),kind,root:'Reseller sourcing',updatedAt:new Date().toISOString(),deferred:false,phase:'editing',data,revision:''});
const preparation = (path:string):OutingPreparation => ({name:'Small browse',groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:path,status:'pending'}]}],step:2,unresolved:[],filter:{text:'',area:'',shortlist:false,type:'',view:'list'}});
async function ready(){const f=fixture();await f.store.setup();const area=await f.store.ensureLocality('Exampletown');const source=await f.store.saveCapture(newDraft(),area.path,'Source');return{...f,area,source};}
test('workspace paths share Places, keep locality optional and organise visits and outings by month',()=>{
  const p=new NotebookPaths('Notebook');assert.equal(p.place([], 'Source'),'Notebook/Places/Unassigned/Source.md');assert.equal(p.place(['Exampletown'],'Parking'),'Notebook/Places/Exampletown/Parking.md');assert.equal(p.area(['Exampletown','Riverside']),'Notebook/Places/Exampletown/Riverside/Area.md');assert.equal(p.outing('Browse','2026-12-31'),'Notebook/Outings/2026/12/Browse.md');assert.equal(p.inbox,'Notebook/Capture inbox');assert.equal(p.archives,'Notebook/System/Capture archive');
});
test('workspace routes reject cross-context and malformed stored routes',()=>{
  assert.deepEqual(routeForPath('Notebook','Notebook/Places/Unassigned/Source.md'),{screen:'place',path:'Notebook/Places/Unassigned/Source.md'});
  assert.equal(routeForPath('Notebook','Notebook/Examples/Places/Town/Source.md'),undefined);
  assert.equal(routeForPath('Notebook','Notebook/Places/../Outside.md'),undefined);
  assert.deepEqual(checkedRoute('Notebook',{screen:'place',path:'Other/Places/Source.md'}),{screen:'home'});
  assert.deepEqual(checkedRoute('Notebook',{screen:'visit',path:'Notebook/Places/Source.md'}),{screen:'home'});
  assert.deepEqual(checkedRoute('Notebook',{screen:'place',path:'Notebook/Places/Source.md',section:'map'}),{screen:'place',path:'Notebook/Places/Source.md',section:'map'});
});
test('name-only places remain editable without an area and ordinary captures still validate hierarchy',async()=>{
  const f=fixture();await f.store.setup();const d={...newDraft(),coordinates:null,address:'',googleRating:null,googleReviewCount:null};
  await f.store.validatePlacePreparation(d,{town:'',locality:''},'Just a name');
  const file=await f.store.saveCapture(d,{town:'',locality:''},'Just a name',{allowUnassigned:true});
  assert.equal(file.path,f.store.paths.place([],'Just a name'));assert.equal((await f.store.listLocalities()).length,0);assert.equal((await f.store.listPlaces()).length,1);
  await f.store.updateCoordinates(file.path,[51,-1]);assert.deepEqual((await f.store.listPlaces())[0]!.coordinates,[51,-1]);
  await assert.rejects(f.store.saveCapture(newDraft('other'),{town:'',locality:''},'Capture'),/town/i);
});
test('preflight failures create no areas or partial records and name collisions retain existing bytes',async()=>{
  const f=fixture();await f.store.setup();const before=JSON.stringify([...f.vault.entries]);
  await assert.rejects(f.store.validatePlacePreparation({...newDraft(),website:'javascript:alert(1)'},{town:'Exampletown',locality:'Riverside'},'Source'));
  assert.equal(JSON.stringify([...f.vault.entries]),before);
  const saved=await f.store.saveCapture(newDraft(),{town:'',locality:''},'Source',{allowUnassigned:true});
  await assert.rejects(f.store.validatePlacePreparation(newDraft('two'),{town:'',locality:''},'Source'),/exists/);assert.ok(await f.vault.read(saved));
});
test('preparation debounce storage preserves unknown count, stage and draft values across reopen',async()=>{
  const f=await ready(),d=draft(preparation(f.source.path));const saved=await f.store.preparations.save(d,'');
  assert.match(saved.revision,/^[a-f0-9]{64}$/);assert.equal((await f.store.preparations.get(d.id))?.data.step,2);
  const reloaded=await f.store.preparations.inspect();assert.equal(reloaded.drafts.length,1);assert.deepEqual(reloaded.warnings,[]);
  const raw=await f.vault.read(f.vault.getAbstractFileByPath(f.store.paths.drafts+'/'+d.id+'.json') as TFile);assert.match(raw,/\[\[Reseller sourcing\/Places/);
});
test('Not now changes prominence without deleting selections; stale panes cannot replace another draft',async()=>{
  const f=await ready(),saved=await f.store.preparations.save(draft(preparation(f.source.path)),'');
  await f.store.preparations.defer(saved.id,saved.revision);const current=await f.store.preparations.get(saved.id);assert.equal(current?.deferred,true);assert.deepEqual(current?.data,saved.data);
  await assert.rejects(f.store.preparations.save({...saved,data:{...saved.data,name:'Old pane'}},saved.revision),/changed/);assert.equal(((await f.store.preparations.get(saved.id))?.data as OutingPreparation).name,'Small browse');
});
test('discarded and deleted drafts stay closed and failed draft writes preserve previous saved details',async()=>{
  const f=await ready(),saved=await f.store.preparations.save(draft(preparation(f.source.path)),'');
  const process=f.vault.process.bind(f.vault);f.vault.process=async()=>{throw Error('Disk unavailable');};
  await assert.rejects(f.store.preparations.save({...saved,data:{...saved.data,name:'Unwritten'}},saved.revision),/unavailable/);f.vault.process=process;
  assert.equal(((await f.store.preparations.get(saved.id))?.data as OutingPreparation).name,'Small browse');
  const closed=await f.store.preparations.transition(saved.id,saved.revision,'discarded');assert.equal((await f.store.preparations.inspect()).drafts.length,0);
  await assert.rejects(f.store.preparations.save(saved,closed.revision),/closed/);
  f.vault.entries.delete(f.store.paths.drafts+'/'+saved.id+'.json');await assert.rejects(f.store.preparations.save(saved,saved.revision),/changed|removed/);
});
test('malformed preparations and cross-context references cannot take down other saved work',async()=>{
  const f=await ready(),saved=await f.store.preparations.save(draft(preparation(f.source.path)),'');
  await f.vault.create(f.store.paths.drafts+'/broken-record.json','invalid json');const list=await f.store.preparations.inspect();assert.equal(list.drafts[0]?.id,saved.id);assert.equal(list.warnings.length,1);
  await assert.rejects(f.store.preparations.save(draft(preparation('Reseller sourcing/Examples/Places/Source.md')),''),/another notebook/);
});
test('interrupted outing completion reuses a single record and never replays later edits',async()=>{
  const f=await ready(),d=await f.store.preparations.save(draft(preparation(f.source.path)),'');
  const locked=await f.store.preparations.transition(d.id,d.revision,'completing');
  const o=await f.store.outings.create(d.data,d.id);await f.store.outings.updatePlan(o.path,{...d.data,name:'Later deliberate title'},o.revision);
  const retry=await f.store.outings.create(d.data,d.id);assert.equal(retry.path,o.path);assert.equal(retry.name,'Later deliberate title');assert.equal((await f.store.outings.list()).length,1);
  await f.store.preparations.transition(d.id,locked.revision,'complete',o.path);assert.equal((await f.store.preparations.inspect()).drafts.length,0);
});
test('existing outing completion receipts tolerate receipt retry without overwriting concurrent prose',async()=>{
  const f=await ready(),o=await f.store.outings.create(preparation(f.source.path)),id=crypto.randomUUID();
  const input={...preparation(f.source.path),name:'Edited name'};const saved=await f.store.outings.updatePlan(o.path,input,o.revision,id);
  await f.vault.process(f.vault.getAbstractFileByPath(o.path) as TFile,raw=>raw+'Personal prose remains.\n');
  const retry=await f.store.outings.updatePlan(o.path,input,o.revision,id);assert.equal(retry.name,saved.name);assert.match(await f.vault.read(f.vault.getAbstractFileByPath(o.path) as TFile),/Personal prose remains/);
});
test('draft source and parking links follow single-place moves and root moves',async()=>{
  const f=await ready(),d=await f.store.preparations.save(draft(preparation(f.source.path)),'');
  const preview=await f.store.previewPlaceAreaChange(f.source.path,{town:'Exampletown',locality:'Riverside'});await f.store.changePlaceArea(f.source.path,{town:'Exampletown',locality:'Riverside'},preview);
  assert.match(((await f.store.preparations.get(d.id))!.data as OutingPreparation).groups[0]!.stops[0]!.sourcePath,/\/Riverside\//);
  await f.store.moveNotebook('Moved notebook');const moved=await f.store.preparations.get(d.id);assert.equal(moved?.root,'Moved notebook');assert.match((moved!.data as OutingPreparation).groups[0]!.stops[0]!.sourcePath,/^Moved notebook\/Places\//);
});
test('place preparation retains invalid raw coordinates for later correction',async()=>{
  const f=await ready();const d=draft<PlacePreparation>({capture:newDraft('manual-place'),area:{town:'',locality:''},step:2,filename:'',coordinatesText:'51, not a longitude'},'place');await f.store.preparations.save(d,'');
  assert.equal(((await f.store.preparations.get(d.id))!.data as PlacePreparation).coordinatesText,'51, not a longitude');
});
test('frozen v4 generator matches the independently installed 0.10.0 pack byte manifest',async()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('./fixtures/examples-v4-manifest.json',import.meta.url),'utf8'));const pack=await buildExamplePack(manifest.root,manifest.vault,4);
  assert.deepEqual(Object.keys(pack.files).sort(),Object.keys(manifest.files).sort());for(const [path,raw] of Object.entries(pack.files))assert.equal(await hashText(raw),manifest.files[path],path);
});
test('v5 starts with a small launcher and a background example outing, without repeated browsing notes',async()=>{
  const root='Notebook/Examples',pack=await buildExamplePack(root,'Fixture');
  assert.equal(pack.files[root+'/Visits.md'],undefined);assert.equal(pack.files[root+'/Sources.md'],undefined);assert.equal(Object.keys(pack.files).filter(p=>p.endsWith('/Area map.base')).length,0);
  const outings=Object.entries(pack.files).filter(([p])=>p.includes('/Outings/')&&p.endsWith('.md'));assert.equal(outings.length,4);assert.ok(outings.every(([p])=>/\/Outings\/2026\/10\//.test(p)));
  assert.ok(outings.some(([,raw])=>(readNote(raw).properties.outing as {exampleBackground?:boolean}).exampleBackground===true));
});
