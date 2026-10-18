import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile } from 'obsidian';
import { fixture, newDraft } from './storage-fixtures';
import { SourcingStore } from '../src/storage/store';
import { DEFAULT_SETTINGS } from '../src/types';
import { readNote, updateNoteProperty } from '../src/storage/markdown';
const input={observations:'Retain this visit',finds:'A fictional wool coat',nextTime:'Check the ordinary rail',visitDate:'2026-10-14',updateLastVisited:false,itemsPurchased:2,haulPotential:4,stockColour:'Blue',colourEvidence:'confirmed'} as const;
const inventory=(f:ReturnType<typeof fixture>)=>[...f.vault.entries].map(([path,v])=>[path,v.text??null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
async function ready(){
 const f=fixture();await f.store.setup();const area=await f.store.ensureLocality('Exampletown');
 const source=await f.store.saveCapture(newDraft('visit-source'),area.path,'Source');
 const visit=await f.store.visits.create(source.path,input);return{...f,source,visit};
}
test('fresh-device attachment discovers linked visits without rewriting records or journals',async()=>{
 const f=await ready(),before=inventory(f),settings=structuredClone(DEFAULT_SETTINGS),device=new SourcingStore(f.app,settings,async()=>{});
 const preview=await device.inspectExistingNotebook(f.store.root);await device.attachExistingNotebook(preview.root,preview.fingerprint);
 assert.deepEqual(inventory(f),before);const visits=await device.visits.list();assert.equal(visits.length,1);assert.equal(visits[0]!.id,f.visit.id);
 assert.equal(visits[0]!.itemsPurchased,2);assert.equal(visits[0]!.haulPotential,4);
});
test('duplicate visit identifiers remain untouched and are excluded with a review warning',async()=>{
 const f=await ready(),raw=await f.vault.read(f.vault.getAbstractFileByPath(f.visit.path) as TFile);
 await f.vault.create(f.store.root+'/Visits/Copy.md',raw);const before=inventory(f),inspection=await f.store.visits.inspect();
 assert.equal(inspection.visits.length,0);assert.match(inspection.warnings.join(' '),/Duplicate visit identifier/);
 const device=new SourcingStore(f.app,structuredClone(DEFAULT_SETTINGS),async()=>{}),preview=await device.inspectExistingNotebook(f.store.root);
 assert.match(preview.warnings.join(' '),/Duplicate visit identities/);assert.deepEqual(inventory(f),before);
});
test('root moves carry visit links but preserve completed operation bytes and permit subsequent visits',async()=>{
 const f=await ready(),journals=f.vault.getFiles().filter(file=>file.path.includes('/System/Visit operations/'));
 const original=await Promise.all(journals.map(async file=>({name:file.path.split('/').at(-1)!,raw:await f.vault.read(file)})));
 await f.store.moveNotebook('Moved sourcing');const moved=(await f.store.visits.list())[0]!;
 assert.equal(moved.id,f.visit.id);assert.ok(moved.sourcePath.startsWith('Moved sourcing/Places/'));
 for(const item of original)assert.equal(await f.vault.read(f.vault.getAbstractFileByPath('Moved sourcing/System/Visit operations/'+item.name) as TFile),item.raw);
 assert.deepEqual((await f.store.visits.inspect()).warnings,[]);
 const second=await f.store.visits.create(moved.sourcePath,{...input,itemsPurchased:0,haulPotential:undefined});
 assert.equal(second.itemsPurchased,0);assert.equal((await f.store.visits.list()).length,2);
});
test('single-source area moves preserve the linked visit filename and personal prose',async()=>{
 const f=await ready(),file=f.vault.getAbstractFileByPath(f.visit.path) as TFile;
 await f.vault.process(file,raw=>raw+'Personal visit margin: retain exactly.  \n');
 const result=await f.store.changePlaceArea(f.source.path,{town:'Exampletown',locality:'Riverside'});
 assert.equal(result.moved.length,1);const saved=await f.store.visits.get(f.visit.path);
 assert.equal(saved.path,f.visit.path);assert.ok(saved.sourcePath.includes('/Exampletown/Riverside/'));
 assert.equal(saved.itemsPurchased,2);assert.ok((await f.vault.read(file)).endsWith('Personal visit margin: retain exactly.  \n'));
});
test('invalid or cross-context visit records are visible warnings and attachment remains read-only',async()=>{
 const f=await ready(),file=f.vault.getAbstractFileByPath(f.visit.path) as TFile;
 await f.vault.process(file,raw=>updateNoteProperty(raw,'source','[[Other notebook/Places/Source]]'));
 const before=inventory(f),preview=await f.store.inspectExistingNotebook(f.store.root);
 assert.match(preview.warnings.join(' '),/missing or different notebook source/);assert.deepEqual(inventory(f),before);
 assert.equal((await f.store.visits.list()).length,0);
});
