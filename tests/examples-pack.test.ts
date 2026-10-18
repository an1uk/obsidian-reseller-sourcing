import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import type { TFile } from 'obsidian';
import { buildExamplePack, EXAMPLES_PACK_VERSION } from '../src/examples/pack';
import { hashText, linkPath, readNote } from '../src/storage/markdown';
import { resolveParking } from '../src/domain';
import { fixture } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { readVisitRecord } from '../src/visits/store';
import { weekdayInsights, colourInsights } from '../src/visits/insights';

const ROOT='Reseller sourcing/Examples';
const notes=(files:Record<string,string>)=>Object.entries(files).filter(([path])=>path.endsWith('.md')).map(([path,text])=>({path,text,...readNote(text)}));
async function loaded(){
 const pack=await buildExamplePack(ROOT,'Practice vault'),f=fixture(structuredClone(pack.settings));
 for(const[path,text]of Object.entries(pack.files))await f.vault.create(path,text);
 return{pack,...f,store:new SourcingStore(f.app,f.settings,f.save,{mode:'examples',writeBoundary:ROOT})};
}
test('Examples pack is deterministic, marked, self-contained and has no browser exports',async()=>{
 const first=await buildExamplePack(ROOT,'Practice vault'),second=await buildExamplePack(ROOT,'Practice vault');
 assert.equal(EXAMPLES_PACK_VERSION,5);assert.deepEqual(first,second);
 for(const[path,text]of Object.entries(first.files)){
  assert.ok(path.startsWith(ROOT+'/'));assert.doesNotMatch(path,/\/Web Clipper\//);
  assert.doesNotMatch(text,/codex-generated/i);
  if(path.endsWith('.md')){const note=readNote(text);assert.equal(note.properties.sourcing_example,true,path);if(path===ROOT+'/Home.md')assert.match(note.body,/view: home/);else assert.match(note.body,/Fictional practice data|fictional|Fictional/);}
 }
 assert.match(first.files[ROOT+'/Home.md']!,/view: home/);assert.match(first.files[ROOT+'/Settings.md']!,/view: settings/);
 assert.ok(first.files[ROOT+'/Reference/Overview.md']);assert.ok(first.files[ROOT+'/Guided tour/Start here.md']);
 for(const note of notes(first.files).filter(note=>!note.path.includes('/Guided tour/'))){
  assert.doesNotMatch(note.body,/\[\[[^\]]*\/Guided tour\//);
  for(const link of note.body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)){
   const target=link[1]!;assert.ok(first.files[target]||first.files[target+'.md'],'Missing link '+target+' in '+note.path);
  }
 }
 await assert.rejects(buildExamplePack('../Outside','Vault'),/folder|path|root|relative/i);
});
test('Examples inventory contains substantial varied sources, forty visits and genuine different record states',async()=>{
 const pack=await buildExamplePack(ROOT,'Practice vault'),all=notes(pack.files);
 const sources=all.filter(note=>note.path.startsWith(ROOT+'/Places/')&&Array.isArray(note.properties.tags)&&note.properties.tags.includes('sourcing-source'));
 const parking=all.filter(note=>note.path.startsWith(ROOT+'/Places/')&&Array.isArray(note.properties.tags)&&note.properties.tags.includes('parking'));
 const areas=all.filter(note=>Array.isArray(note.properties.tags)&&note.properties.tags.includes('sourcing-locality'));
 assert.equal(sources.length,24);assert.equal(parking.length,8);assert.equal(areas.length,9);
 assert.equal(areas.filter(note=>!note.properties.parent_locality).length,3);
 assert.equal(areas.filter(note=>note.properties.parent_locality).length,6);
 const counts=Object.fromEntries([...new Set(sources.map(note=>note.properties.source_type))].map(type=>[String(type),sources.filter(note=>note.properties.source_type===type).length]));
 assert.deepEqual(counts,{'Charity shop':16,'Rag house':3,Wholesaler:2,Market:2,'Community reuse depot':1});
 const visitNotes=all.filter(note=>note.path.startsWith(ROOT+'/Visits/'));
 const records=await Promise.all(visitNotes.map(note=>readVisitRecord(note.text,note.path)));
 const visits=sources.map(note=>records.filter(visit=>visit.sourcePath===note.path).length);
 assert.equal(records.length,40);assert.equal(visits.reduce((sum,n)=>sum+n,0),40);assert.equal(visits.filter(n=>n===10).length,1);assert.equal(visits.filter(n=>n===2).length,15);assert.equal(visits.filter(n=>n===0).length,8);
 assert.ok(sources.every(note=>!/^### \d{4}-\d{2}-\d{2}/m.test(note.body)));
 assert.ok(visitNotes.every(note=>note.body.includes('view: visit')&&note.body.includes('What this demonstrates')));
 assert.equal(sources.filter(note=>note.properties.last_visited===null).length,8);
 assert.equal(sources.filter(note=>note.properties.shop_closed===true).length,1);
 assert.equal(sources.filter(note=>Array.isArray(note.properties.coordinates)&&!note.properties.coordinates.length).length,2);
 assert.ok(sources.some(note=>note.properties.rating===0&&records.some(visit=>visit.sourcePath===note.path)));
 assert.ok(sources.some(note=>note.properties.rating===3.5));
 assert.equal(new Set(sources.map(note=>note.body)).size,24);
 assert.ok(sources.every(note=>note.body.length>700&&note.body.includes('### Stock and condition')&&note.body.includes('### Typical prices')));
 assert.ok(records.some(visit=>visit.visitDate==='2026-09-28'&&visit.recordedAt.startsWith('2026-10-17')&&sources.some(source=>source.path===visit.sourcePath&&source.properties.last_visited==='2026-10-02')));
 assert.equal(pack.files[ROOT+'/Visits.md'], undefined);
});
test('All practice Bases carry their stable context, own path and preview-only listing formula',async()=>{
 const pack=await buildExamplePack('Practice & Friends/Examples','My "vault" & testing');
 const bases=Object.entries(pack.files).filter(([path])=>path.endsWith('.base'));assert.equal(bases.length,2);
 for(const[path,text]of bases){
  const base=parse(text);assert.ok(base.filters.and.includes('note.sourcing_example == true'));
  assert.ok(!base.filters.and.includes('note.sourcing_example != true'));
  assert.ok(base.views.length>=2);
  for(const view of base.views){assert.equal(view.notebookRoot,'Practice & Friends/Examples');assert.equal(view.notebookBasePath,path);}
  assert.match(base.formulas.google_maps,/obsidian:\/\/charity-sourcing/);assert.match(base.formulas.google_maps,/action=listing/);assert.doesNotMatch(base.formulas.google_maps,/https:\/\/www\.google/);
 }
 for(const[path,asset]of Object.entries(pack.settings.assets))assert.equal(asset.hash,await hashText(pack.files[path]!));
});
test('Example associations and all four outings load through the actual scoped store',async()=>{
 const f=await loaded(),places=await f.store.listPlaces(),outings=await f.store.outings.list();
 assert.equal(places.length,32);assert.equal(outings.length,4);
 assert.equal(outings.filter(outing=>outing.status==='planned').length,2);
 const planned=outings.filter(outing=>outing.status==='planned');
 assert.ok(planned.every(outing=>outing.planning?.defaultVisitMinutes===20));assert.deepEqual(planned.map(outing=>outing.planning!.end.kind).sort(),['last','return']);
 assert.equal(outings.filter(outing=>outing.status==='active').length,1);
 assert.equal(outings.filter(outing=>outing.status==='finished').length,1);
 assert.equal(outings.filter(outing=>outing.draft).length,1);
 for(const place of places){
  if(place.locality)assert.ok(f.pack.files[place.locality]);
  if(place.kind==='parking')for(const path of place.properties.parking_for as string[])assert.ok(places.some(source=>source.path===linkPath(path)&&source.kind==='shop'));
 }
 const parkingStates=places.filter(place=>place.kind==='shop').map(place=>resolveParking(place,places));
 assert.ok(parkingStates.some(state=>state.status==='choice'));assert.ok(parkingStates.some(state=>state.status==='preferred'));
 assert.ok(places.some(place=>place.kind==='parking'&&(place.properties.parking_for as string[]).length>=3));
 for(const outing of outings)for(const group of outing.groups){
  if(group.parkingPath)assert.ok(places.some(place=>place.path===group.parkingPath&&place.kind==='parking'));
  for(const stop of group.stops)assert.ok(places.some(place=>place.path===stop.sourcePath&&place.kind==='shop'));
 }
});
test('Pending examples use normal v1/v2 creation and refresh review with verified archived identities',async()=>{
 const f=await loaded(),captures=await f.store.captures();assert.equal(captures.length,6);
 const versions=new Set<number>(),previews=[];
 for(const file of captures){
  const props=readNote(await f.vault.read(file)).properties;versions.add(props.template_version as number);
  const draft=await f.store.draft(file),matches=await f.store.captureRefreshMatches(draft);
  const snapshot=f.settings.captureSnapshots[file.path]!;
  assert.equal(snapshot.captureId,draft.captureId);assert.equal(snapshot.revision,await hashText(await f.vault.read(file)));
  if(file.basename.startsWith('01')||file.basename.startsWith('02'))assert.equal(matches.length,0,file.path);
  else{assert.equal(matches.length,1,file.path);previews.push({name:file.basename,preview:await f.store.previewCaptureRefresh(draft,matches[0]!.path)});}
 }
 assert.deepEqual([...versions].sort(),[1,2]);
 const complete=previews.find(row=>row.name.startsWith('03'))!.preview;
 assert.ok(complete.fields.some(field=>field.selected));assert.equal(complete.fields.find(field=>field.key==='coordinates')!.selected,false);
 const partial=previews.find(row=>row.name.startsWith('04'))!.preview;
 for(const key of['google_reviews','google_hours','website','telephone'])assert.equal(partial.fields.find(field=>field.key===key)!.available,false,key);
 assert.ok(previews.find(row=>row.name.startsWith('05'))!.preview.warnings.some(warning=>warning.includes('predates')));
 assert.equal(previews.find(row=>row.name.startsWith('06'))!.preview.fields.filter(field=>field.changed).length,0);
 const places=await f.store.listPlaces();
 for(const place of places.filter(place=>place.kind==='shop')){
  const id=String(place.properties.source_capture_id),raw=f.pack.files[ROOT+'/System/Capture archive/'+id+'.md'];assert.ok(raw);
  const p=readNote(raw).properties,index=Number(String(p.google_maps_url).match(/EXAMPLE-BRANCH-(\d+)/)?.[1]);
  const brand=(place.properties.tags as string[]).find(tag=>tag.startsWith('source/'))!.slice(7);
  assert.equal(id,await hashText(ROOT+'/Capture inbox/Original '+String(index).padStart(2,'0')+' - '+brand+'.md\n'+raw));
  assert.equal(f.settings.captureReceipts[id],place.path);
  assert.equal(p.google_maps_url,place.properties.google_maps_url);
 }
});

test('legacy pack payload still matches every byte hash from the verified 0.7.0 bundle',async()=>{
 const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/examples-v1-hashes.json',import.meta.url),'utf8'));
 const pack=await buildExamplePack('Legacy notebook/Examples','Legacy vault',1);
 const hashes=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
 assert.equal(frozen.oldMainSha256,'5fe978511d5957b12baed055f481abc9b3c343163ba4838a9743d4c70ddb0e1d');
 assert.deepEqual(hashes,frozen.files);
});

test('version-two example payload remains byte-identical despite changed user defaults',async()=>{
 const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/examples-v2-hashes.json',import.meta.url),'utf8'));
 const pack=await buildExamplePack('Legacy notebook/Examples','Legacy vault',2);
 const hashes=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
 assert.equal(frozen.oldMainSha256,'ea55a51003c04b59899306c50f45dd644542afc4e5838c5cd5297011314b9de7');
 assert.deepEqual(hashes,frozen.files);
});

test('five weeks of focal visits produce the advertised weekday comparison without using recording dates',async()=>{
 const pack=await buildExamplePack(ROOT,'Practice vault');
 const records=await Promise.all(Object.entries(pack.files).filter(([path])=>path.startsWith(ROOT+'/Visits/')).map(([path,raw])=>readVisitRecord(raw,path)));
 const focal=records.filter(visit=>visit.id.startsWith('example-visit-00-')),byDay=weekdayInsights(focal);
 assert.equal(focal.length,10);
 const monday=byDay.find(row=>row.label==='Monday')!,friday=byDay.find(row=>row.label==='Friday')!;
 assert.deepEqual([monday.visits,monday.knownCounts,monday.itemsTotal,monday.meanItems,monday.medianScore,monday.scoreCount],[5,5,14,2.8,3,5]);
 assert.deepEqual([friday.visits,friday.knownCounts,friday.itemsTotal,friday.meanItems,friday.medianScore,friday.scoreCount],[5,5,30,6,4,5]);
 assert.equal(monday.limitedCounts,false);assert.equal(friday.limitedScores,false);
 assert.equal(byDay.find(row=>row.label==='Saturday')!.visits,0);
 assert.ok(focal.some(visit=>visit.visitDate==='2026-10-12'&&visit.recordedAt.startsWith('2026-10-17')));
 assert.deepEqual(focal.map(visit=>visit.itemsPurchased),[2,6,3,5,2,7,4,4,3,8]);
 assert.deepEqual(focal.map(visit=>visit.haulPotential),[2,4,3,4,2,5,3,4,3,5]);
 const few=records.filter(visit=>visit.id.startsWith('example-visit-01-')),many=records.filter(visit=>visit.id.startsWith('example-visit-02-'));
 assert.ok(few.every(visit=>visit.itemsPurchased!<=2&&visit.haulPotential===5));
 assert.ok(many.every(visit=>visit.itemsPurchased!>=9&&visit.haulPotential!<=2));
 const zero=records.filter(visit=>visit.id.startsWith('example-visit-03-'));
 assert.ok(zero.every(visit=>visit.itemsPurchased===0&&visit.haulPotential===undefined));
 assert.ok(records.some(visit=>visit.itemsPurchased===undefined));
 assert.ok(records.some(visit=>visit.itemsPurchased!>0&&visit.haulPotential===undefined));
});

test('example stock colours show two Blue returns, limited Green evidence, unchanged runs and conflicts',async()=>{
 const pack=await buildExamplePack(ROOT,'Practice vault');
 const records=await Promise.all(Object.entries(pack.files).filter(([path])=>path.startsWith(ROOT+'/Visits/')).map(([path,raw])=>readVisitRecord(raw,path)));
 const focal=records.filter(visit=>visit.id.startsWith('example-visit-00-')),colours=colourInsights(focal);
 assert.equal(colours.timeline.length,10);assert.equal(colours.hints.length,1);
 const blue=colours.hints[0]!;
 assert.equal(blue.colour,'Blue');assert.equal(blue.returns,2);assert.equal(blue.minimumDays,14);assert.equal(blue.maximumDays,14);assert.equal(blue.medianDays,14);
 assert.deepEqual(blue.supportingDates,['2026-09-14','2026-09-28','2026-10-12']);assert.equal(blue.includesSuspected,false);
 assert.ok(!colours.hints.some(hint=>hint.colour==='Green'));
 for(const index of ['08','09'])assert.equal(colourInsights(records.filter(visit=>visit.id.startsWith('example-visit-'+index+'-'))).hints.length,0);
 for(const index of ['06','12']){
  const conflictRecords=records.filter(visit=>visit.id.startsWith('example-visit-'+index+'-'));
  for(const suspected of [false,true]){const conflicting=colourInsights(conflictRecords,suspected);assert.equal(conflicting.conflictingDates.length,1);assert.ok(conflicting.timeline.every(row=>row.conflicting&&!row.eligible));assert.equal(conflicting.hints.length,0);}
 }
 const uncertain=records.filter(visit=>visit.id.startsWith('example-visit-07-'));
 assert.equal(colourInsights(uncertain).timeline.filter(row=>row.eligible).length,0);
 assert.equal(colourInsights(uncertain,true).timeline.filter(row=>row.eligible).length,1);
 assert.ok(records.some(visit=>!visit.stockColour));
});

test('finished example outing links one detailed visit while preserving visited-without-details and active draft',async()=>{
 const f=await loaded(),outings=await f.store.outings.list(),finished=outings.find(outing=>outing.status==='finished')!,active=outings.find(outing=>outing.status==='active')!;
 const visited=finished.groups.flatMap(group=>group.stops).filter(stop=>stop.status==='visited');
 const linked=visited.filter(stop=>stop.visitPath);assert.equal(linked.length,1);
 const stop=linked[0]!,path=linkPath(stop.visitPath!),record=await readVisitRecord(f.pack.files[path]!,path);
 assert.equal(record.id,stop.visitId);assert.equal(record.sourcePath,stop.sourcePath);assert.equal(record.outingPath,finished.path);assert.equal(record.outingId,finished.id);assert.equal(record.stopId,stop.id);
 assert.ok(visited.some(stop=>!stop.visitPath));assert.ok(active.draft);
 const visitNotes=Object.entries(f.pack.files).filter(([path])=>path.startsWith(ROOT+'/Visits/'));assert.equal(visitNotes.length,40);
 assert.ok(!visitNotes.some(([,raw])=>raw.includes('example-unsaved-visit-draft')));
});

test('example pack versions are explicit and unsupported versions are refused',async()=>{
 for(const version of [1,2,3,4,5])assert.ok(Object.keys((await buildExamplePack(ROOT,'Practice vault',version)).files).length>100);
 for(const version of [0,6,-1,1.5,NaN])await assert.rejects(buildExamplePack(ROOT,'Practice vault',version),/version is not supported/);
});

test('version-three continuation retains all 158 payload bytes and practice defaults',async()=>{
 const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/examples-v3-hashes.json',import.meta.url),'utf8'));
 const pack=await buildExamplePack('Legacy notebook/Examples','Legacy vault',3);
 const hashes=Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async([path,text])=>[path,await hashText(text)])));
 assert.equal(frozen.oldMainSha256,'45ff28793a01938c3a436ea0323ae41d2e563e0252f56aeab48855b5a0c889ec');
 assert.deepEqual(hashes,frozen.files);assert.equal(await hashText(JSON.stringify(pack.settings)),frozen.settingsHash);
});
test('fresh v4 examples organise actual visit dates by year/month and expose calm workflows',async()=>{
 const pack=await buildExamplePack(ROOT,'Practice vault',4),old=await buildExamplePack(ROOT,'Practice vault',3);
 const visits=Object.entries(pack.files).filter(([path])=>path.startsWith(ROOT+'/Visits/'));
 assert.equal(visits.length,40);const months=new Set<string>();
 for(const[path,raw]of visits){
  const record=await readVisitRecord(raw,path),month=record.visitDate.slice(0,7).replace('-','/');
  assert.ok(path.startsWith(ROOT+'/Visits/'+month+'/'),path);months.add(month);
 }
 assert.deepEqual([...months].sort(),['2026/08','2026/09','2026/10']);
 assert.ok(Object.keys(old.files).filter(path=>path.startsWith(ROOT+'/Visits/')).every(path=>!path.startsWith(ROOT+'/Visits/2026/')));
 const oldLinked=notes(old.files).find(note=>note.path.endsWith('Thimbleton coats and curios.md'))!;
 const linked=notes(pack.files).find(note=>note.path.endsWith('Thimbleton coats and curios.md'))!;
 const path=(linked.properties.outing as {groups:{stops:{visitPath?:string}[]}[]}).groups[0]!.stops[0]!.visitPath!;
 assert.match(path,/Visits\/2026\/10\//);assert.ok(pack.files[linkPath(path)]);
 assert.doesNotMatch(JSON.stringify(oldLinked.properties),/Visits\/2026\/10\//);
 assert.match(pack.files[ROOT+'/Visits.md']!,/view: visits/);assert.doesNotMatch(pack.files[ROOT+'/Visits.md']!,/view: insights/);
 assert.match(pack.files[ROOT+'/Reference/Everyday workflows.md']!,/Record a visit, Plan an outing and Find sources/);
 assert.match(pack.files[ROOT+'/Guided tour/Start here.md']!,/guide is optional/);
 assert.doesNotMatch(pack.files[ROOT+'/Home.md']!,/Browse \[\[.*forty separate editable visits/);
});

test('fresh examples include a saved quick-note-only visit and an uncluttered zero-purchase draft',async()=>{
 const f=await loaded(),visits=await f.store.visits.list(),quick=visits.find(visit=>visit.id==='example-visit-15-01')!;
 assert.ok(quick);assert.match(quick.observations,/quick note/);assert.equal(quick.finds,'');assert.equal(quick.nextTime,'');assert.equal(quick.itemsPurchased,undefined);assert.equal(quick.haulPotential,undefined);
 const active=(await f.store.outings.list()).find(outing=>outing.status==='active')!,draft=active.draft!.input;
 assert.equal(draft.itemsPurchased,0);assert.equal(draft.finds,'');assert.equal(draft.nextTime,'');assert.equal(draft.rating,undefined);assert.equal(draft.updateLastVisited,false);
});
