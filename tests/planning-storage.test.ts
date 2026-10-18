import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { defaultPlanningOptions } from '../src/outings/planning';
import type { OutingPlanningOptions } from '../src/outings/types';
import { readNote, updateNoteProperty, wiki } from '../src/storage/markdown';

async function ready() {
  const f=fixture(); await f.store.setup();const town=await f.store.ensureLocality('Exampletown');
  const one=await f.store.saveCapture({...newDraft('planning-one'),name:'One',coordinates:[52.5,-2.4]},town.path,'One');
  const two=await f.store.saveCapture({...newDraft('planning-two'),name:'Two',coordinates:[52.51,-2.41]},town.path,'Two');
  const park=await f.store.saveCapture({...newDraft('planning-parking','parking'),name:'Parking',coordinates:[52.505,-2.405]},town.path,'Parking');
  const hours=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>day+', 09:00 to 17:00');
  for(const file of [one,two])await f.vault.process(file,raw=>updateNoteProperty(updateNoteProperty(raw,'google_hours',hours),'google_hours_checked','2026-10-16'));
  const groups=[{id:'group',parkingPath:park.path,stops:[{id:'one',sourcePath:one.path,status:'pending' as const},{id:'two',sourcePath:two.path,status:'pending' as const}]}];
  const outing=await f.store.outings.create({name:'Planning fixture',groups});
  const options:OutingPlanningOptions={...defaultPlanningOptions(),date:'2026-10-17',departureTime:'09:00',timeZone:'Europe/London',start:{kind:'record',path:park.path}};
  return{...f,town,one,two,park,groups,outing,options};
}
const file=(f:Awaited<ReturnType<typeof ready>>,path:string)=>f.vault.getAbstractFileByPath(path) as TFile;
test('legacy outing reads do not rewrite notes and planning endpoints round-trip as linked records',async()=>{
  const f=await ready(),before=await f.vault.read(file(f,f.outing.path));
  await f.store.outings.get(f.outing.path);assert.equal(await f.vault.read(file(f,f.outing.path)),before);
  const created=await f.store.outings.create({name:'With planning',groups:f.groups,planning:f.options});
  assert.equal(created.planning?.defaultVisitMinutes,20);
  assert.equal(created.planning?.start?.kind,'record');
  const raw=await f.vault.read(file(f,created.path));assert.ok(raw.includes(wiki(f.park.path)));
  const reopened=new SourcingStore(f.app,f.settings,f.save);assert.deepEqual((await reopened.outings.get(created.path)).planning,created.planning);
});
test('reviewed planning saves order and options atomically, preserving source facts and personal outing body',async()=>{
  const f=await ready(),outingFile=file(f,f.outing.path);
  await f.vault.process(outingFile,raw=>raw+'Personal trip prose, preserved.\n');
  const sources=await Promise.all([f.vault.read(f.one),f.vault.read(f.two),f.vault.read(f.park)]);
  const preview=await f.store.outings.previewPlanning(f.outing.path,f.options);assert.deepEqual(preview.blockers,[]);
  const saved=await f.store.outings.applyPlanning(f.outing.path,f.options,preview.fingerprint);
  assert.deepEqual(saved.groups,preview.groups);assert.deepEqual(saved.planning,f.options);
  assert.ok((await f.vault.read(outingFile)).endsWith('Personal trip prose, preserved.\n'));
  assert.deepEqual(await Promise.all([f.vault.read(f.one),f.vault.read(f.two),f.vault.read(f.park)]),sources);
  assert.equal(readNote(await f.vault.read(outingFile)).properties.outing!==undefined,true);
});
test('changed pins, hours and outing prose require another reviewed comparison without overwriting',async()=>{
  for(const kind of ['pin','hours','prose'] as const){
    const f=await ready(),preview=await f.store.outings.previewPlanning(f.outing.path,f.options);
    if(kind==='pin')await f.store.updateCoordinates(f.two.path,[52.55,-2.44]);
    if(kind==='hours')await f.vault.process(f.one,raw=>updateNoteProperty(raw,'google_hours_checked','2026-10-17'));
    if(kind==='prose')await f.vault.process(file(f,f.outing.path),raw=>raw+'Concurrent personal paragraph\n');
    const before=await f.vault.read(file(f,f.outing.path));
    await assert.rejects(f.store.outings.applyPlanning(f.outing.path,f.options,preview.fingerprint),/changed|Preview/i);
    assert.equal(await f.vault.read(file(f,f.outing.path)),before);
    assert.equal((await f.store.outings.get(f.outing.path)).planning,undefined);
  }
});
test('unfinished visits block planning application and cross-context anchors never save',async()=>{
  const f=await ready(),preview=await f.store.outings.previewPlanning(f.outing.path,f.options);
  await f.store.outings.start(f.outing.path);
  await f.store.outings.saveDraft(f.outing.path,'one',{observations:'Keep draft',finds:'',nextTime:'',visitDate:'2026-10-17',updateLastVisited:false});
  await assert.rejects(f.store.outings.applyPlanning(f.outing.path,f.options,preview.fingerprint),/draft|visit/i);
  assert.equal((await f.store.outings.get(f.outing.path)).draft?.input.observations,'Keep draft');
  const outside={...f.options,start:{kind:'record' as const,path:'Other notebook/Parking/Outside.md'}};
  await assert.rejects(f.store.outings.previewPlanning(f.outing.path,outside),/endpoint.*notebook/i);
  await f.vault.process(f.park,raw=>updateNoteProperty(raw,'sourcing_example',true));
  await assert.rejects(f.store.outings.create({name:'Flagged endpoint',groups:[{...f.groups[0]!,parkingPath:''}],planning:f.options}),/endpoint.*notebook/i);
});
test('removed stops prune their own overrides and unchanged planning survives ordinary editing',async()=>{
  const f=await ready();f.options.stopOverrides={one:{visitMinutes:35},two:{visitMinutes:10,hours:{closed:true,intervals:[]}}};
  const planned=await f.store.outings.create({name:'Override fixture',groups:f.groups,planning:f.options});
  const renamed=await f.store.outings.updatePlan(planned.path,{name:'Personal title',groups:planned.groups},planned.revision);
  assert.deepEqual(renamed.planning,f.options);
  const removed=await f.store.outings.remove(renamed.path,'two',renamed.revision);
  assert.deepEqual(removed.planning?.stopOverrides,{one:{visitMinutes:35}});
});
test('notebook moves carry planning endpoint links without changing source identity',async()=>{
  const f=await ready(),planned=await f.store.outings.create({name:'Linked plan',groups:f.groups,planning:{...f.options,end:{kind:'record',path:f.one.path}}});
  const raw=await f.vault.read(file(f,planned.path));
  const preview=await f.store.previewNotebookMove('Moved notebook');assert.deepEqual(preview.conflicts,[]);
  await f.store.moveNotebook('Moved notebook',preview);
  const nextPath=planned.path.replace('Reseller sourcing/','Moved notebook/');
  const moved=await f.store.outings.get(nextPath);assert.equal(moved.planning?.start?.kind,'record');
  if(moved.planning?.start?.kind==='record')assert.equal(moved.planning.start.path,f.park.path.replace('Reseller sourcing/','Moved notebook/'));
  if(moved.planning?.end.kind==='record')assert.equal(moved.planning.end.path,f.one.path.replace('Reseller sourcing/','Moved notebook/'));
  assert.ok((await f.vault.read(file(f,nextPath))).includes('Moved notebook'));
  assert.ok(raw.includes('Reseller sourcing'));
});

test('an interrupted endpoint move restores exact original outing bytes on guarded rollback',async()=>{
  const f=await ready(),planned=await f.store.outings.create({name:'Rollback plan',groups:f.groups,planning:f.options});
  const originalPath=planned.path,raw=await f.vault.read(file(f,originalPath)),process=f.vault.process.bind(f.vault);let moved=false,fail=true;
  f.vault.process=async(current,transform)=>{
    const result=await process(current,transform);
    if(fail&&current.path===originalPath.replace('Reseller sourcing/','Relocated notebook/')){fail=false;moved=true;throw Error('Planner move interruption');}
    return result;
  };
  const preview=await f.store.previewNotebookMove('Relocated notebook');
  await assert.rejects(f.store.moveNotebook('Relocated notebook',preview),/Planner move interruption/);
  assert.equal(moved,true);assert.ok(f.settings.migration);
  const changed=file(f,originalPath.replace('Reseller sourcing/','Relocated notebook/'));
  assert.ok((await f.vault.read(changed)).includes('Relocated notebook'));
  await f.store.rollbackMove();assert.equal(await f.vault.read(file(f,originalPath)),raw);
  assert.equal((await f.store.outings.get(originalPath)).planning?.start?.kind,'record');
});

test('a parent area move updates planning endpoints and keeps personal outing prose',async()=>{
  const f=await ready(),planned=await f.store.outings.create({name:'Area linked plan',groups:f.groups,planning:f.options});
  const outingFile=file(f,planned.path);await f.vault.process(outingFile,raw=>raw+'Personal area plans\n');
  const preview=await f.store.previewLocalityMove(f.town.path,'Newtown');
  assert.deepEqual(preview.conflicts,[]);await f.store.moveLocality(f.town.path,'Newtown','',preview);
  const changed=await f.store.outings.get(planned.path);
  if(changed.planning?.start?.kind!=='record')assert.fail('Missing saved endpoint');
  assert.ok(changed.planning.start.path.includes('/Newtown/'));
  assert.ok((await f.vault.read(outingFile)).endsWith('Personal area plans\n'));
  assert.equal(changed.groups.flatMap(group=>group.stops).length,2);
});
