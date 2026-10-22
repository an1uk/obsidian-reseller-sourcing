import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { fixture, newDraft } from './storage-fixtures';

async function setup() {
 const f=fixture();await f.store.setup();
 const element=()=>({win:{setTimeout,clearTimeout},ownerDocument:{removeEventListener(){}},inert:false,setAttribute(){},empty(){}});
 class Modal{contentEl=element();modalEl=element();constructor(_app:unknown){}close(){(this as any).onClose();}}
 class Component{load(){}unload(){}}
 const base={exports:{} as Record<string,any>};
 const sandbox={crypto,structuredClone,module:base,exports:base.exports,require(id:string){if(id==='obsidian')return{Modal,Component,Notice:class{}};if(id==='../ui')return{errorText:String};if(id.endsWith('modal-layout'))return{markInputModal(){}};throw Error(id);}};
 vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/workspace/preparation-modal.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,sandbox);
 const prep={exports:{} as Record<string,any>};
 vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/workspace/place-preparation.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,{...sandbox,module:prep,exports:prep.exports,require(id:string){if(id==='./preparation-modal')return base.exports;return{};}});
 const capture={...newDraft('manual-contact'),name:'',address:'',url:'',coordinates:null};
 const modal=new prep.exports.PlacePreparationModal({app:f.app,store:f.store,root:f.store.root,settings:f.settings},capture);
 modal.draft={schema:1,id:crypto.randomUUID(),kind:'place',root:f.store.root,updatedAt:new Date().toISOString(),deferred:false,phase:'editing',data:modal.seed,revision:''};
 return{f,modal};
}
for(const detail of ['website','telephone','coordinates','sourceType','defaultType'] as const) test(`an unnamed manual place retains unfinished ${detail} details on Close`,async()=>{
 const {f,modal}=await setup(),d=modal.draft.data;d.step=2;
 if(detail==='website')d.capture.website='https://stock.example';
 if(detail==='telephone')d.capture.telephone='01632 960123';
 if(detail==='coordinates')d.coordinatesText='51.2,';
 if(detail==='sourceType')d.capture.sourceType='Rag house';
 if(detail==='defaultType')d.makeDefaultSourceType=true;
 const expected=JSON.parse(JSON.stringify(d));assert.equal(modal.meaningful(),true);
 modal.close();await modal.flush();assert.equal(modal.closed,true);
 const saved=await f.store.preparations.get(modal.draft.id);assert.ok(saved);assert.deepEqual(saved.data,expected);
 assert.equal((await f.store.listPlaces()).length,0);
});
test('an untouched unnamed manual place closes without adding empty saved work',async()=>{
 const {f,modal}=await setup();assert.equal(modal.meaningful(),false);modal.close();await modal.flush();
 assert.equal(modal.closed,true);assert.equal((await f.store.preparations.inspect()).drafts.length,0);
});
