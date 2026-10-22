import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { catchupVisitDate } from '../src/outings/catch-up';
import { fixture, newDraft } from './storage-fixtures';
import { readNote, updateNoteProperty } from '../src/storage/markdown';

function harness(existing = false) {
 class TFile { extension='md'; constructor(public path:string){} }
 class Element {
  children: Element[] = []; parent?: Element; tag='div'; textContent=''; value=''; type=''; disabled=false; isConnected=true; hidden=false; inert=false; open=false;
  attributes: Record<string,string>={}; cls=''; style:any={}; readOnly=false; rows=0; min=''; step=''; id=''; placeholder=''; checked=false;
  onchange?:()=>unknown; onclick?:()=>unknown; focused=false;
  focus(){this.focused=true;}
  createEl(tag:string,options:any={}) {const el=new Element();el.tag=tag;el.parent=this;el.textContent=options.text??'';el.value=options.value??'';el.type=options.type??'';el.cls=options.cls??'';el.attributes=options.attr??{};el.id=el.attributes.id??'';this.children.push(el);return el;}
  createDiv(options:any={}){return this.createEl('div',typeof options==='string'?{cls:options}:options);}
  createSpan(options:any={}){return this.createEl('span',options);}
  setText(value:string){this.textContent=value;} setAttribute(key:string,value:string){this.attributes[key]=value;}getAttribute(key:string){return this.attributes[key]??null;}
  addClass(...values:string[]){this.cls+=' '+values.join(' ');}removeClass(value:string){this.cls=this.cls.replace(value,'');}toggle(show:boolean){this.hidden=!show;}
  appendChild(el:Element){el.remove();el.parent=this;el.isConnected=true;this.children.push(el);return el;}
  empty(){for(const child of all(this).slice(1))child.isConnected=false;this.children=[];this.textContent='';}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(value=>value!==this);this.isConnected=false;}
  querySelectorAll(selector:string):Element[]{return all(this).slice(1).filter(el=>selector.split(',').includes(el.tag));}
  querySelector(selector:string):Element|null{if(selector.startsWith('.'))return all(this).find(el=>el.cls.split(' ').includes(selector.slice(1)))??null;if(selector==='button.mod-cta')return all(this).find(el=>el.tag==='button'&&el.cls.includes('mod-cta'))??null;return this.querySelectorAll(selector)[0]??null;}
 }
 class Modal {
  contentEl=new Element();modalEl=new Element();titleEl=new Element();closed=false;
  constructor(public app:unknown){}open(){(this as any).onOpen?.();}close(){this.closed=true;(this as any).onClose?.();}
 }
 class Setting {
  settingEl:Element;constructor(parent:Element){this.settingEl=parent.createDiv();}
  setName(value:string){this.settingEl.setAttribute('name',value);return this;}setDesc(value:string){this.settingEl.setAttribute('description',value);return this;}
  addText(run:(control:any)=>void){return this.text('input',run);}addTextArea(run:(control:any)=>void){return this.text('textarea',run);}
  text(tag:string,run:(control:any)=>void){const inputEl=this.settingEl.createEl(tag);const control:any={inputEl,setValue(value:string){inputEl.value=value;return control;},onChange(callback:(value:string)=>void){inputEl.onchange=()=>callback(inputEl.value);return control;}};run(control);return this;}
  addDropdown(run:(control:any)=>void){const selectEl=this.settingEl.createEl('select');const control:any={selectEl,addOption(value:string,text:string){selectEl.createEl('option',{value,text});return control;},setValue(value:string){selectEl.value=value;return control;},onChange(callback:(value:string)=>void){selectEl.onchange=()=>callback(selectEl.value);return control;}};run(control);return this;}
  addToggle(run:(control:any)=>void){const input=this.settingEl.createEl('input',{type:'checkbox'});const control:any={setValue(value:boolean){input.checked=value;return control;},onChange(callback:(value:boolean)=>void){input.onchange=()=>callback(input.checked);return control;}};run(control);return this;}
 }
 const record:any={schema:1,id:'visit-one',path:'Book/Examples/Visits/2026/10/Visit one.md',sourcePath:'Book/Examples/Sources/One.md',visitDate:'2026-10-16',recordedAt:'2026-10-18T10:00:00Z',updatedAt:'2026-10-18T10:00:00Z',observations:'Original observation',finds:'Useful original find',nextTime:'Check seams',itemsPurchased:2,haulPotential:3,stockColour:'Blue',colourEvidence:'unknown',revision:'old-revision'};
 const source:any={path:record.sourcePath,name:'Source one',kind:'shop',coordinates:[1,2],properties:{rating:4.5,comments:'Current source takeaway'}};
 let draft:any,draftRevision='',draftOperationId='',draftVisitRevision:string|undefined,draftCleared=false,draftCounter=0,operations:any[]=[],released=0,create=0,update=0,draftSaves=0,clears=0,resumed=0,cancelled=0,failUpdate=false,failClear=false,waitPlaces:Promise<unknown>|undefined;
 const saves:any[]=[];const notices:string[]=[];const timers=new Map<number,()=>void>();let timer=0;
 const context:any={kind:'examples',app:{},beginEditing:()=>()=>released++,openFile:async()=>{},store:{listPlaces:async()=>{if(waitPlaces)await waitPlaces;return[source];},visits:{
  list:async()=>existing?[structuredClone(record)]:[],get:async()=>structuredClone(record),getDraft:async()=>draft&&!draftCleared?structuredClone(draft):undefined,getDraftState:async()=>draft?{input:structuredClone(draft),revision:draftRevision,visitRevision:draftVisitRevision,cleared:draftCleared,operationId:draftCleared?undefined:draftOperationId}:undefined,
  saveDraft:async(_source:string,input:any,_path:string,expected:string,visitRevision?:string)=>{if(expected!==draftRevision)throw Error('The visit draft changed in another pane');draftSaves++;if(!draftOperationId||draftCleared)draftOperationId='draft-operation-'+(++timer);draft=structuredClone(input);draftRevision='draft-'+(++draftCounter);draftVisitRevision=visitRevision;draftCleared=false;return draftRevision;},clearDraft:async(_source:string,_path:string,expected:string)=>{clears++;if(failClear)throw Error('Draft cleanup interrupted');if(expected!==draftRevision)throw Error('The visit draft changed in another pane');if(draft){draftCleared=true;draftRevision='draft-'+(++draftCounter);}},
  create:async(path:string,input:any,options:any)=>{create++;saves.push({path,input:structuredClone(input),options});return{...structuredClone(record),...input};},
  update:async(path:string,input:any,revision:string)=>{update++;saves.push({path,input:structuredClone(input),revision});if(failUpdate||revision!==record.revision)throw Error('Visit changed before save');return{...structuredClone(record),...input};},
  pendingOperations:async()=>structuredClone(operations),resumeOperation:async()=>{resumed++;operations=[];return record;},cancelOperation:async()=>{cancelled++;operations=[];},
 }}};
 const module={exports:{} as Record<string,any>};
 const code=transformSync(fs.readFileSync(new URL('../src/ui/visits.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
 const sandbox:any={module,exports:module.exports,structuredClone,Number,Date,Map,Set,Error,crypto:{randomUUID:()=> 'ui-operation-'+(++timer)},window:{setTimeout:(callback:()=>void)=>{const id=++timer;timers.set(id,callback);return id;},clearTimeout:(id:number)=>timers.delete(id)},
 require(id:string){if(id==='../outings/catch-up')return{catchupVisitDate:(record:any,stop:any)=>catchupVisitDate(record,stop,new Date('2026-10-18T12:00:00Z'))};if (id.endsWith('modal-layout')) return { markInputModal() {}, modalWindow: () => sandbox.window }; if(id==='obsidian')return{Component:class{},Modal,Setting,TFile,Notice:class{constructor(message:string){notices.push(message);}}};if(id==='../storage/markdown')return{localDate:(date?:Date)=>date?date.toISOString().slice(0,10):'2026-10-18'};if(id==='../ui')return{button:(parent:Element,text:string,run:()=>unknown)=>{const button=parent.createEl('button',{text});button.onclick=run;return button;},details:(parent:Element,title:string)=>{const value=parent.createEl('details');value.createEl('summary',{text:title});return value;},propertyText: (value: unknown, fallback = '') => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback, errorText:(error:any)=>error.message??String(error),renderContextBanner:()=>{}};if(id==='./visits')return module.exports;if(['../domain','../outings/domain','../map','./outing-route','./outing-planner','../workspace/outing-preparation','./outing-shortcuts','./outing-catchup','./outing-focus','../outings/focus'].includes(id))return{};throw Error('Unexpected import '+id);}
 };vm.runInNewContext(code,sandbox);
 const api=module.exports,modal=new api.StructuredVisitModal(context,record.sourcePath,existing?record.path:undefined);
 const outingApi=()=>{const out={exports:{} as Record<string,any>};vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/ui/outings.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,{...sandbox,module:out,exports:out.exports});return out.exports;};
 const outingModal=(path:string,stopId:string)=>new (outingApi().OutingVisitModal)(context,path,stopId);
 return{api,modal,context,record,source,saves,notices,file:(path:string)=>new TFile(path),outingModal,outingHome:(el:Element)=>outingApi().renderOutingsHome(context,{},el),element:()=>new Element(),counts:()=>({released,create,update,draftSaves,clears,resumed,cancelled}),
 setDraft:(value:any,meta:{visitRevision?:string;cleared?:boolean}={})=>{draft=structuredClone(value);draftOperationId='draft-operation-'+(++timer);draftRevision='draft-'+(++draftCounter);draftVisitRevision=meta.visitRevision;draftCleared=meta.cleared??false;},getDraft:()=>draftCleared?undefined:draft,setOperations:(value:any[])=>operations=value,failUpdate:()=>failUpdate=true,failClear:(value:boolean)=>failClear=value,deferPlaces:(pending:Promise<unknown>)=>waitPlaces=pending};
}
function all(el:any):any[]{return[el,...el.children.flatMap(all)];}
function field(el:any,label:string,value:string){const input=all(el).find(el=>el.attributes['aria-label']===label);assert.ok(input,label);input.value=value;input.onchange?.();return input;}
function blankInput(){return{observations:'',finds:'',nextTime:'',visitDate:'2026-10-18',updateLastVisited:false};}
async function settle(){for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));}
async function open(h:ReturnType<typeof harness>){h.modal.open();await settle();}

test('quick fields accept zero purchases without assigning a zero or retained haul score',()=>{
 const h=harness(),el=h.element(),input:any={...blankInput(),haulPotential:4};
 const editor=h.api.renderVisitFields(el,input,()=>{});
 field(el,'Items purchased','0');
 const score=all(el).find(el=>el.attributes['aria-label']==='Whole-haul profit potential');
 assert.equal(score.disabled,true);assert.equal(score.value,'');editor.validate();assert.equal(editor.snapshot().haulPotential,undefined);
 assert.equal(input.haulPotential,4);assert.match(all(el).map(el=>el.textContent).join('\n'),/Saving clears any saved haul score/);
 field(el,'Items purchased','2');assert.equal(score.disabled,false);assert.equal(score.value,'4');assert.equal(editor.snapshot().haulPotential,4);
});

test('blank counts stay unknown, typed counts require safe nonnegative integers and haul scores require whole values',()=>{
 const h=harness(),el=h.element(),input:any=blankInput(),editor=h.api.renderVisitFields(el,input,()=>{});
 assert.throws(()=>editor.validate(),/Add a purchase count/);
 for(const value of ['-1','1.5','9007199254740992']){field(el,'Items purchased',value);assert.throws(()=>editor.validate(),/whole number/);}
 field(el,'Items purchased','');field(el,'Whole-haul profit potential','3');editor.validate();assert.equal(editor.snapshot().itemsPurchased,undefined);
 field(el,'Whole-haul profit potential','2.5');assert.throws(()=>editor.validate(),/1 to 5/);
});

test('stock colour alone is useful visit data and meaning remains explicitly unknown',()=>{
 const h=harness(),el=h.element(),input:any=blankInput(),editor=h.api.renderVisitFields(el,input,()=>{},{colourSuggestions:['Blue','Blue','Orange']});
 field(el,'Stock colour','  Lilac  ');editor.validate();assert.equal(editor.snapshot().stockColour,'Lilac');assert.equal(editor.snapshot().colourEvidence,'unknown');
 field(el,'Colour meaning','suspected');assert.equal(editor.snapshot().colourEvidence,'suspected');
 field(el,'Stock colour','');assert.equal(editor.snapshot().colourEvidence,undefined);
});

test('actual visit date suggestions prefer stop completion, then outing start, then today',()=>{
 const h=harness(),suggest=h.api.visitDateSuggestion;
 assert.equal(suggest({startedAt:'2026-10-10T10:00:00Z'},{completedAt:'2026-10-11T12:00:00Z'}).date,'2026-10-11');
 assert.match(suggest({startedAt:'2026-10-10T10:00:00Z'}).origin,/outing start/);
 assert.equal(suggest().date,'2026-10-18');
 const el=h.element(),input:any={...blankInput(),visitDate:'2026-02-30',itemsPurchased:0},editor=h.api.renderVisitFields(el,input,()=>{});
 assert.throws(()=>editor.validate(),/valid actual visit date/);
});

test('editing saved visits never implicitly re-applies a source assessment or last-visited update',()=>{
 const h=harness(true);h.record.rating=1;h.record.comments='Old assessment';
 const input=h.api.visitInputFromRecord(h.record);assert.equal(input.rating,undefined);assert.equal(input.comments,undefined);assert.equal(input.updateLastVisited,false);
 const el=h.element();h.api.renderVisitFields(el,input,()=>{},{source:h.source});
 const update=all(el).find(el=>el.attributes.name==='Update current assessment').children.find((el:any)=>el.tag==='input');assert.equal(update.checked,false);
});

test('standalone structured-only save creates one separate visit through its captured context',async()=>{
 const h=harness();await open(h);field(h.modal.contentEl,'Items purchased','0');await h.modal.save();
 assert.equal(h.counts().create,1);assert.equal(h.saves[0].path,h.record.sourcePath);assert.equal(h.saves[0].input.itemsPurchased,0);assert.equal(h.saves[0].input.haulPotential,undefined);
 assert.ok(h.saves[0].options.operationId);assert.equal(h.counts().released,1);assert.equal(h.modal.closed,true);
});

test('keep-draft close persists entered fields without creating a visit and reopening restores them',async()=>{
 const h=harness();await open(h);field(h.modal.contentEl,'Items purchased','3');field(h.modal.contentEl,'Visit quick note','Inspect the allegedly cashmere cardigan');
 h.modal.close();await settle();assert.equal(h.counts().create,0);assert.equal(h.getDraft().itemsPurchased,3);assert.equal(h.modal.closed,true);
 const again=new h.api.StructuredVisitModal(h.context,h.record.sourcePath);again.open();await settle();
 assert.equal(all(again.contentEl).find(el=>el.attributes['aria-label']==='Items purchased').value,'3');assert.match(all(again.contentEl).map(el=>el.textContent).join('\n'),/draft restored/);
 await again.discard();assert.equal(h.getDraft(),undefined);
});

test('discarding unfinished standalone changes clears only the draft',async()=>{
 const h=harness();await open(h);field(h.modal.contentEl,'Items purchased','5');await h.modal.flush();await h.modal.discard();
 assert.equal(h.getDraft(),undefined);assert.equal(h.counts().create,0);assert.equal(h.counts().update,0);assert.equal(h.modal.closed,true);
});

test('stale saved visit errors retain all edited fields and do not silently retry',async()=>{
 const h=harness(true);await open(h);h.failUpdate();field(h.modal.contentEl,'Items purchased','6');field(h.modal.contentEl,'Visit quick note','New intended observation');
 await h.modal.save();assert.equal(h.counts().update,1);assert.equal(h.modal.closed,false);
 assert.equal(all(h.modal.contentEl).find(el=>el.attributes['aria-label']==='Items purchased').value,'6');assert.match(h.modal.status.textContent,/Visit changed/);
 assert.equal(h.saves[0].revision,'old-revision');await h.modal.discard();
});

test('completed visit draft cleanup retries without creating or editing the visit again',async()=>{
 const h=harness();await open(h);field(h.modal.contentEl,'Items purchased','1');h.failClear(true);
 await h.modal.save();assert.equal(h.counts().create,1);assert.equal(h.modal.closed,false);assert.match(h.modal.status.textContent,/Visit saved; draft cleanup/);
 h.failClear(false);await h.modal.save();assert.equal(h.counts().create,1);assert.equal(h.counts().update,0);assert.equal(h.modal.closed,true);
});

test('closing while initial data loads prevents late form creation and releases the lease once',async()=>{
 const h=harness();let done!:()=>void;h.deferPlaces(new Promise<void>(resolve=>done=resolve));h.modal.open();h.modal.close();done();await settle();
 assert.equal(h.modal.contentEl.children.length,0);assert.equal(h.counts().released,1);assert.equal(h.counts().create,0);
});

test('visit history respects stale render guards and displays separate visit details',async()=>{
 const h=harness(true),el=h.element();await h.api.renderVisitHistory(h.context,{},el,h.record.sourcePath,()=>false);assert.equal(el.children.length,0);
 await h.api.renderVisitHistory(h.context,{},el,h.record.sourcePath);
 const text=all(el).map(el=>el.textContent).join('\n');assert.match(text,/Visits \(1\)/);assert.match(text,/2 items purchased/);assert.match(text,/Whole-haul potential 3/);assert.match(text,/Edit visit/);
});

test('pending save recovery shows retained input read-only and requires an explicit action',async()=>{
 const h=harness(),el=h.element();h.setOperations([{id:'op',kind:'create',stage:'prepared',sourcePath:h.record.sourcePath,input:{...blankInput(),itemsPurchased:2,observations:'Retained observation'},expected:h.record}]);
 await h.api.renderVisitRecovery(h.context,el);assert.equal(all(el).some(el=>el.tag==='input'||el.tag==='textarea'),false);assert.equal(h.counts().resumed,0);
 const button=all(el).find(el=>el.textContent==='Cancel unwritten save');button.onclick();await settle();assert.equal(h.counts().cancelled,1);assert.equal(h.counts().create,0);
});

test('written partial saves offer completion rather than cancellation or replay',async()=>{
 const h=harness(),el=h.element();h.setOperations([{id:'op',kind:'create',stage:'visit-written',sourcePath:h.record.sourcePath,input:{...blankInput(),itemsPurchased:2},expected:h.record}]);
 await h.api.renderVisitRecovery(h.context,el);assert.equal(all(el).some(el=>el.textContent==='Cancel unwritten save'),false);
 all(el).find(el=>el.textContent==='Finish visit save').onclick();await settle();assert.equal(h.counts().resumed,1);assert.equal(h.counts().create,0);
});

test('visit note controls leave canonical observations in the note body without duplication',async()=>{
 const h=harness(true),el=h.element();await h.api.renderVisitNote(h.context,{},el,h.record.path);
 const text=all(el).map(el=>el.textContent).join('\n');assert.match(text,/Visit on 2026-10-16/);assert.match(text,/2 items purchased/);assert.doesNotMatch(text,/Original observation|Useful original find|Check seams/);
});
test('finished outing late visit details use completion date and preserve the finished state',async()=>{
 const h=harness(),calls:any[]=[];
 const outing:any={id:'outing',path:'Book/Examples/Outings/Finished.md',name:'Finished outing',status:'finished',startedAt:'2026-10-10T10:00:00Z',revision:'outing-revision',groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:h.record.sourcePath,status:'visited',completedAt:'2026-10-11T12:00:00Z',visitOperationId:'legacy-receipt'}]}]};
 h.context.store.outings={get:async()=>structuredClone(outing),saveDraft:async(_path:string,_stop:string,input:any)=>{calls.push({kind:'draft',input});return structuredClone(outing);},recordVisit:async(_path:string,_stop:string,input:any,options:any)=>{calls.push({kind:'visit',input,options});return structuredClone(outing);},start:async()=>{throw Error('Must not restart');}};
 const modal=h.outingModal(outing.path,'stop');modal.open();await settle();
 assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Visit date').value,'2026-10-11');
 assert.match(all(modal.contentEl).map(el=>el.textContent).join('\n'),/Earlier inline notes stay/);
 field(modal.contentEl,'Items purchased','2');field(modal.contentEl,'Whole-haul profit potential','5');await modal.saveVisit();
 assert.equal(calls.filter(call=>call.kind==='visit').length,1);assert.equal(calls.at(-1).input.visitDate,'2026-10-11');assert.equal(calls.at(-1).input.haulPotential,5);assert.equal(modal.record.status,'finished');assert.equal(modal.closed,true);
});
test('saving details for a skipped outing stop requires an explicit outcome confirmation',async()=>{
 const h=harness(),calls:any[]=[];
 const outing:any={id:'outing',path:'Book/Examples/Outings/Finished.md',name:'Finished',status:'finished',revision:'revision',groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:h.record.sourcePath,status:'skipped'}]}]};
 h.context.store.outings={get:async()=>structuredClone(outing),saveDraft:async()=>structuredClone(outing),recordVisit:async(_path:string,_stop:string,input:any,options:any)=>{calls.push({input,options});return structuredClone(outing);}};
 const modal=h.outingModal(outing.path,'stop');modal.open();await settle();field(modal.contentEl,'Items purchased','0');await modal.saveVisit();
 assert.equal(calls.length,0);assert.match(modal.status.textContent,/Confirm changing this skipped stop/);
 const row=all(modal.contentEl).find(el=>el.attributes.name==='Change this skipped stop to visited'),toggle=row.children.find((el:any)=>el.type==='checkbox');toggle.checked=true;toggle.onchange();
 await modal.saveVisit();assert.equal(calls.length,1);assert.equal(calls[0].options.confirmSkipped,true);assert.equal(calls[0].input.haulPotential,undefined);
});
test('restored outing drafts retain their actual date and structured fields after save validation errors',async()=>{
 const h=harness();const input={...blankInput(),visitDate:'2026-09-04',itemsPurchased:2,haulPotential:4,stockColour:'Orange',colourEvidence:'suspected'};
 const outing:any={id:'outing',path:'Book/Examples/Outings/Active.md',name:'Active',status:'active',revision:'revision',draft:{stopId:'stop',operationId:'saved-op',input,updatedAt:'2026-10-18'},groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:h.record.sourcePath,status:'pending'}]}]};
 h.context.store.outings={get:async()=>structuredClone(outing),saveDraft:async()=>structuredClone(outing),recordVisit:async()=>{throw Error('Concurrent stop changed');}};
 const modal=h.outingModal(outing.path,'stop');modal.open();await settle();assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Visit date').value,'2026-09-04');
 field(modal.contentEl,'Items purchased','0');await modal.saveVisit();assert.equal(modal.closed,false);assert.match(modal.status.textContent,/Concurrent stop changed/);
 assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Whole-haul profit potential').disabled,true);
 assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Stock colour').value,'Orange');
 modal.changed=false;modal.close();
});

test('outing-linked recovery completes progress through the outing coordinator',async()=>{
 const h=harness(),el=h.element();let resumed=0,cancelled=0;
 h.context.store.outings={resumeVisit:async(path:string)=>{assert.equal(path,'Book/Examples/Outings/One.md');resumed++;},cancelPendingVisit:async()=>{cancelled++;}};
 h.setOperations([{id:'linked-op',kind:'create',stage:'visit-written',sourcePath:h.record.sourcePath,outingPath:'Book/Examples/Outings/One.md',input:{...blankInput(),itemsPurchased:1},expected:h.record}]);
 await h.api.renderVisitRecovery(h.context,el);all(el).find(el=>el.textContent==='Finish visit save').onclick();await settle();
 assert.equal(resumed,1);assert.equal(h.counts().resumed,0);assert.equal(cancelled,0);
 const another=h.element();h.setOperations([{id:'linked-op',kind:'create',stage:'prepared',sourcePath:h.record.sourcePath,outingPath:'Book/Examples/Outings/One.md',input:{...blankInput(),itemsPurchased:1},expected:h.record}]);
 await h.api.renderVisitRecovery(h.context,another);all(another).find(el=>el.textContent==='Cancel unwritten save').onclick();await settle();assert.equal(cancelled,1);assert.equal(h.counts().cancelled,0);
});

test('an explicitly selected source assessment can record a visit without mandatory prose',()=>{
 const h=harness(),el=h.element(),input:any=blankInput(),editor=h.api.renderVisitFields(el,input,()=>{},{source:h.source});
 const row=all(el).find(el=>el.attributes.name==='Update current assessment'),toggle=row.children.find((el:any)=>el.type==='checkbox');toggle.checked=true;toggle.onchange();
 editor.validate();assert.equal(editor.snapshot().rating,4.5);assert.equal(editor.snapshot().comments,'Current source takeaway');
});

test('an outing editor loads its linked visit and retains the reviewed revision across concurrent edits',async()=>{
 const h=harness(true),calls:any[]=[];h.record.outingId='outing';h.record.stopId='stop';
 const outing:any={id:'outing',path:'Book/Examples/Outings/Active.md',name:'Active',status:'active',revision:'outing-revision',groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:h.record.sourcePath,status:'pending',visitPath:h.record.path,visitId:h.record.id}]}]};
 h.context.store.outings={get:async()=>structuredClone(outing),saveDraft:async(_path:string,_stop:string,input:any,_revision:string,visitRevision:string)=>{calls.push({kind:'draft',input,visitRevision});return structuredClone(outing);},recordVisit:async(_path:string,_stop:string,input:any,options:any)=>{calls.push({kind:'visit',input,options});if(options.visitRevision!==h.record.revision)throw Error('The linked visit changed');return structuredClone(outing);}};
 const modal=h.outingModal(outing.path,'stop');modal.open();await settle();
 assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Outing visit quick note').value,'Original observation');
 h.record.revision='new-revision';h.record.observations='Concurrent observations';
 field(modal.contentEl,'Items purchased','6');await modal.saveVisit();
 assert.equal(calls.find(call=>call.kind==='draft').visitRevision,'old-revision');
 assert.equal(calls.find(call=>call.kind==='visit').options.visitRevision,'old-revision');
 assert.equal(modal.closed,false);assert.match(modal.status.textContent,/linked visit changed/);
 assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Items purchased').value,'6');
 assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Outing visit quick note').value,'Original observation');
 modal.changed=false;modal.close();
});

test('restored outing edit drafts keep their original visit comparison instead of rebasing to the latest note',async()=>{
 const h=harness(true);h.record.outingId='outing';h.record.stopId='stop';h.record.revision='latest';
 const outing:any={id:'outing',path:'Book/Examples/Outings/Finished.md',name:'Finished',status:'finished',revision:'outing-revision',draft:{operationId:'draft',stopId:'stop',visitRevision:'original',input:{...blankInput(),itemsPurchased:4,observations:'My older draft'},updatedAt:'2026-10-18'},groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:h.record.sourcePath,status:'visited',visitPath:h.record.path,visitId:h.record.id}]}]};
 let savedRevision='';h.context.store.outings={get:async()=>structuredClone(outing),saveDraft:async()=>structuredClone(outing),recordVisit:async(_path:string,_stop:string,_input:any,options:any)=>{savedRevision=options.visitRevision;throw Error('Comparison stale');}};
 const modal=h.outingModal(outing.path,'stop');modal.open();await settle();
 assert.match(all(modal.contentEl).map(el=>el.textContent).join('\n'),/saved visit changed after this draft/);
 await modal.saveVisit();assert.equal(savedRevision,'original');assert.equal(modal.closed,false);
 assert.equal(all(modal.contentEl).find(el=>el.attributes['aria-label']==='Outing visit quick note').value,'My older draft');modal.changed=false;modal.close();
});

test('legacy outing drafts without a visit comparison remain read-only rather than silently overwrite a linked visit',async()=>{
 const h=harness(true);h.record.outingId='outing';h.record.stopId='stop';
 const outing:any={id:'outing',path:'Book/Examples/Outings/Finished.md',name:'Finished',status:'finished',revision:'revision',draft:{operationId:'draft',stopId:'stop',input:{...blankInput(),itemsPurchased:3,observations:'Legacy draft stays visible'},updatedAt:'2026-10-18'},groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:h.record.sourcePath,status:'visited',visitPath:h.record.path,visitId:h.record.id}]}]};
 h.context.store.outings={get:async()=>structuredClone(outing)};
 const modal=h.outingModal(outing.path,'stop');modal.open();await settle();
 const text=all(modal.contentEl).map(el=>el.textContent).join('\n');assert.match(text,/older draft has no saved visit comparison/);assert.match(text,/Legacy draft stays visible/);
 assert.equal(all(modal.contentEl).some(el=>el.attributes['aria-label']==='Items purchased'),false);modal.close();
});

test('restoring an older standalone edit draft never substitutes the current visit revision',async()=>{
 const h=harness(true);h.setDraft({...blankInput(),itemsPurchased:7,observations:'Older intended draft'},{visitRevision:'original-base'});h.record.revision='current-visit';
 await open(h);assert.equal(h.modal.visitRevision,'original-base');assert.match(all(h.modal.contentEl).map(el=>el.textContent).join('\n'),/saved visit changed after this draft/);
 await h.modal.save();assert.equal(h.saves.at(-1).revision,'original-base');assert.equal(h.modal.closed,false);
 assert.equal(all(h.modal.contentEl).find(el=>el.attributes['aria-label']==='Items purchased').value,'7');await h.modal.discard();
});
test('simultaneous standalone editors preserve the saved draft and retain conflicting entered fields',async()=>{
 const h=harness();await open(h);const other=new h.api.StructuredVisitModal(h.context,h.record.sourcePath);other.open();await settle();
 field(h.modal.contentEl,'Items purchased','2');field(h.modal.contentEl,'Visit quick note','First editor saved draft');await h.modal.flush();
 field(other.contentEl,'Items purchased','5');field(other.contentEl,'Visit quick note','Second editor unsaved details');await other.save();
 assert.equal(h.counts().create,0);assert.equal(h.getDraft().observations,'First editor saved draft');assert.equal(other.closed,false);
 assert.equal(all(other.contentEl).find(el=>el.attributes['aria-label']==='Items purchased').value,'5');
 assert.match(all(other.contentEl).find(el=>el.attributes['aria-label']==='Entered visit details to copy before closing').value,/Second editor unsaved details/);
 all(other.contentEl).find(el=>el.textContent==='Close without saving this form').onclick();assert.equal(other.closed,true);assert.equal(h.getDraft().observations,'First editor saved draft');
 await h.modal.discard();
});
test('a cleared draft tombstone is ignored as content but retained as the next edit precondition',async()=>{
 const h=harness();h.setDraft({...blankInput(),itemsPurchased:9,observations:'Previously discarded'},{cleared:true});await open(h);
 assert.equal(all(h.modal.contentEl).find(el=>el.attributes['aria-label']==='Items purchased').value,'');
 assert.equal(h.modal.draftRevision,'draft-1');field(h.modal.contentEl,'Items purchased','1');await h.modal.save();
 assert.equal(h.counts().create,1);assert.equal(h.saves[0].input.itemsPurchased,1);
});
test('legacy standalone edit drafts without a base revision cannot silently overwrite a saved visit',async()=>{
 const h=harness(true);h.setDraft({...blankInput(),itemsPurchased:4,observations:'Legacy draft text'});await open(h);
 const text=all(h.modal.contentEl).map(el=>el.textContent).join('\n');assert.match(text,/older draft has no saved visit comparison/);assert.match(text,/Legacy draft text/);
 assert.equal(all(h.modal.contentEl).some(el=>el.attributes['aria-label']==='Items purchased'),false);await h.modal.discard();assert.equal(h.counts().update,0);
});

test('new visit forms lead with only date, items and quick note and keep optional groups collapsed', () => {
  const h = harness(), el = h.element(), input: any = blankInput();
  const editor = h.api.renderVisitFields(el, input, () => {});
  assert.deepEqual(el.children.filter((value: any) => value.attributes.name).map((value: any) => value.attributes.name), ['Visit date', 'Items purchased', 'Quick note']);
  const sections = el.children.filter((value: any) => value.tag === 'details');
  assert.deepEqual(sections.map((value: any) => value.children[0].textContent), ['Haul and stock details', 'Finds and reminders', 'Update source assessment']);
  assert.ok(sections.every((value: any) => !value.open));
  field(el, 'Visit quick note', 'A useful quick observation'); editor.validate(); assert.equal(editor.snapshot().observations, 'A useful quick observation');
});
test('saved optional visit values open the relevant groups and collapsing never removes entered data', () => {
  const h = harness(), el = h.element(), input: any = { ...blankInput(), finds: 'Wool coat', nextTime: 'Look at cuffs', stockColour: 'Blue', colourEvidence: 'confirmed', haulPotential: 4, rating: 0, comments: '', updateLastVisited: true };
  const editor = h.api.renderVisitFields(el, input, () => {});
  const sections = el.children.filter((value: any) => value.tag === 'details'); assert.ok(sections.every((value: any) => value.open));
  for (const section of sections) section.open = false;
  const saved = editor.snapshot(); assert.equal(saved.finds, 'Wool coat'); assert.equal(saved.nextTime, 'Look at cuffs'); assert.equal(saved.stockColour, 'Blue');
  assert.equal(saved.colourEvidence, 'confirmed'); assert.equal(saved.haulPotential, 4); assert.equal(saved.rating, 0); assert.equal(saved.comments, ''); assert.equal(saved.updateLastVisited, true);
  field(el, 'Useful finds', 'Two wool coats'); assert.equal(editor.snapshot().finds, 'Two wool coats');
});
test('restored drafts expose only optional groups containing saved details', async () => {
  const h = harness(); h.setDraft({ ...blankInput(), observations: 'Quick note only', nextTime: 'Check restocked rails' }); await open(h);
  const sections = all(h.modal.contentEl).filter(value => value.tag === 'details');
  const byTitle = new Map(sections.map(value => [value.children[0].textContent, value]));
  assert.equal(byTitle.get('Finds and reminders').open, true); assert.equal(byTitle.get('Haul and stock details').open, false);
  assert.equal(byTitle.get('Update source assessment').open, false); await h.modal.discard();
});


test('purchase chips distinguish unknown and zero, announce selection and preserve the optional haul until explicit save', () => {
 const h=harness(),el=h.element(),input:any={...blankInput(),haulPotential:4};let changed=0;
 const editor=h.api.renderVisitFields(el,input,()=>changed++);
 const choice=(label:string)=>all(el).find(value=>value.attributes['aria-label']===label);
 assert.equal(choice('Purchase count unknown').attributes['aria-pressed'],'true');
 assert.equal(choice('Items purchased').hidden,true);
 choice('Set purchases to 0').onclick();
 assert.equal(input.itemsPurchased,0);assert.equal(changed,1);assert.equal(choice('Set purchases to 0').attributes['aria-pressed'],'true');
 assert.equal(choice('Purchase count unknown').attributes['aria-pressed'],'false');
 assert.equal(choice('Whole-haul profit potential').disabled,true);assert.equal(editor.snapshot().haulPotential,undefined);assert.equal(input.haulPotential,4);
 choice('Purchase count unknown').onclick();assert.equal(input.itemsPurchased,undefined);assert.equal(editor.snapshot().haulPotential,4);
 assert.equal(choice('Whole-haul profit potential').disabled,false);assert.equal(choice('Whole-haul profit potential').value,'4');
 choice('Set purchases to 3').onclick();assert.equal(editor.snapshot().itemsPurchased,3);assert.equal(choice('Set purchases to 3').attributes['aria-pressed'],'true');
 assert.equal(h.counts().create,0);assert.equal(h.counts().update,0);
});

test('More reveals and focuses numeric entry without creating data; undo restores the exact prior count', () => {
 const h=harness(),el=h.element(),input:any=blankInput();let changed=0;
 const editor=h.api.renderVisitFields(el,input,()=>changed++);
 const more=all(el).find(value=>value.tag==='button'&&value.textContent==='More');
 const count=all(el).find(value=>value.attributes['aria-label']==='Items purchased');
 more.onclick();assert.equal(count.hidden,false);assert.equal(count.focused,true);assert.equal(more.attributes['aria-expanded'],'true');
 assert.equal(input.itemsPurchased,undefined);assert.equal(changed,0);
 field(el,'Items purchased','12');assert.equal(editor.snapshot().itemsPurchased,12);
 all(el).find(value=>value.attributes['aria-label']==='Set purchases to 2').onclick();assert.equal(count.hidden,true);assert.equal(input.itemsPurchased,2);
 const undo=all(el).find(value=>value.tag==='button'&&value.textContent==='Undo count');assert.equal(undo.hidden,false);undo.onclick();
 assert.equal(input.itemsPurchased,12);assert.equal(count.value,'12');assert.equal(count.hidden,false);assert.equal(undo.hidden,true);
 assert.equal(changed,3);editor.validate();
});

test('purchase-chip undo restores unknown or zero and does not replace subsequent typed input', () => {
 const h=harness(),el=h.element(),input:any=blankInput(),editor=h.api.renderVisitFields(el,input,()=>{});
 const zero=all(el).find(value=>value.attributes['aria-label']==='Set purchases to 0');
 const unknown=all(el).find(value=>value.attributes['aria-label']==='Purchase count unknown');
 const undo=all(el).find(value=>value.tag==='button'&&value.textContent==='Undo count');
 zero.onclick();undo.onclick();assert.equal(input.itemsPurchased,undefined);
 zero.onclick();unknown.onclick();undo.onclick();assert.equal(input.itemsPurchased,0);editor.validate();
 field(el,'Items purchased','-2');assert.equal(undo.hidden,true);undo.onclick();assert.equal(input.itemsPurchased,-2);
 assert.throws(()=>editor.validate(),/whole number/);
 zero.onclick();undo.onclick();assert.equal(input.itemsPurchased,-2);assert.equal(all(el).find(value=>value.attributes['aria-label']==='Items purchased').value,'-2');
 assert.throws(()=>editor.validate(),/whole number/);
});

test('restored large and invalid counts stay editable while restored chips show their exact state', () => {
 for(const value of [0,1,2,3,7,-1,1.5]) {
  const h=harness(),el=h.element(),input:any={...blankInput(),itemsPurchased:value},editor=h.api.renderVisitFields(el,input,()=>{});
  const count=all(el).find(item=>item.attributes['aria-label']==='Items purchased');assert.equal(count.value,String(value));assert.equal(count.hidden,value>=0&&value<=3&&Number.isInteger(value));
  const selected=all(el).filter(item=>item.tag==='button'&&item.attributes['aria-pressed']==='true');
  assert.deepEqual(selected.map(item=>item.textContent),value>=0&&value<=3&&Number.isInteger(value)?[String(value)]:[]);
  assert.equal(editor.snapshot().itemsPurchased,value);
 }
});

test('recent stock-colour chips preserve recency, cap their number and never assign a confidence', () => {
 const h=harness(),el=h.element(),input:any={...blankInput(),stockColour:'My custom Shade'};let changed=0;
 const editor=h.api.renderVisitFields(el,input,()=>changed++,{colourSuggestions:['Orange','Blue','Orange','Lilac','Green','Yellow','White','Pink']});
 const colours=all(el).filter(value=>value.tag==='button'&&value.attributes['aria-label']?.startsWith('Use stock colour '));
 assert.deepEqual(colours.map(value=>value.textContent),['Orange','Blue','Lilac','Green','Yellow','White']);
 assert.equal(all(el).find(value=>value.attributes['aria-label']==='Stock colour').value,'My custom Shade');
 colours[1].onclick();assert.equal(input.stockColour,'Blue');assert.equal(input.colourEvidence,undefined);assert.equal(editor.snapshot().colourEvidence,'unknown');
 assert.equal(colours[1].attributes['aria-pressed'],'true');assert.equal(changed,1);
 field(el,'Stock colour','  My custom Shade  ');assert.equal(input.stockColour,'  My custom Shade  ');assert.equal(editor.snapshot().stockColour,'My custom Shade');
 assert.equal(colours.every(value=>value.attributes['aria-pressed']==='false'),true);
});

test('stock-colour shortcuts preserve explicit unknown, suspected and confirmed evidence without inference', () => {
 for(const evidence of ['unknown','suspected','confirmed']) {
  const h=harness(),el=h.element(),input:any={...blankInput(),stockColour:'blue',colourEvidence:evidence};
  const editor=h.api.renderVisitFields(el,input,()=>{},{colourSuggestions:['Blue','blue']});
  const choices=all(el).filter(value=>value.tag==='button'&&value.attributes['aria-label']?.startsWith('Use stock colour '));
  assert.equal(choices[0].attributes['aria-pressed'],'false');assert.equal(choices[1].attributes['aria-pressed'],'true');
  choices[0].onclick();assert.equal(input.stockColour,'Blue');assert.equal(editor.snapshot().colourEvidence,evidence);
 }
});

test('disabled visit controls block quick-count, more, undo and colour actions and restore valid control states', () => {
 const h=harness(),el=h.element(),input:any={...blankInput(),haulPotential:3};let changed=0;
 const editor=h.api.renderVisitFields(el,input,()=>changed++,{colourSuggestions:['Blue']});
 const zero=all(el).find(value=>value.attributes['aria-label']==='Set purchases to 0');zero.onclick();assert.equal(changed,1);
 editor.setDisabled(true);assert.equal(all(el).filter(value=>value.tag==='button').every(value=>value.disabled),true);
 for(const label of ['Set purchases to 1','Purchase count unknown','Use stock colour Blue']) all(el).find(value=>value.attributes['aria-label']===label).onclick();
 for(const label of ['More','Undo count']) all(el).find(value=>value.tag==='button'&&value.textContent===label).onclick();
 assert.equal(input.itemsPurchased,0);assert.equal(input.stockColour,undefined);assert.equal(changed,1);
 editor.setDisabled(false);assert.equal(zero.disabled,false);assert.equal(all(el).find(value=>value.attributes['aria-label']==='Whole-haul profit potential').disabled,true);
 all(el).find(value=>value.tag==='button'&&value.textContent==='Undo count').onclick();assert.equal(input.itemsPurchased,undefined);
 assert.equal(all(el).find(value=>value.attributes['aria-label']==='Whole-haul profit potential').disabled,false);
});

test('purchase-chip edits persist in the existing draft without recording a visit implicitly', async () => {
 const h=harness();await open(h);
 all(h.modal.contentEl).find(value=>value.attributes['aria-label']==='Set purchases to 1').onclick();await h.modal.flush();
 assert.equal(h.getDraft().itemsPurchased,1);assert.equal(h.counts().create,0);
 all(h.modal.contentEl).find(value=>value.attributes['aria-label']==='Purchase count unknown').onclick();await h.modal.flush();
 assert.equal(h.getDraft().itemsPurchased,undefined);assert.equal(h.counts().create,0);
 field(h.modal.contentEl,'Visit quick note','Still a draft, despite the excellent cardigan.');await h.modal.save();
 assert.equal(h.counts().create,1);assert.equal(h.saves[0].input.itemsPurchased,undefined);
});


async function realOutingEditor() {
 const f=fixture();await f.store.setup();const area=await f.store.ensureLocality('Exampletown');
 const source=await f.store.saveCapture(newDraft('editor-source'),area.path,'Source');
 let outing=await f.store.outings.create({name:'Concurrent outing',groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:source.path,status:'pending'}]}]});
 outing=await f.store.outings.start(outing.path,outing.revision);
 const h=harness();h.context.kind='real';h.context.store=f.store;h.context.app=f.app;
 const modal=h.outingModal(outing.path,'stop');await modal.load();
 return {...f,h,modal,source,outing};
}

test('retry and close after an outing draft conflict keep the reviewed revision and newer draft',async()=>{
 const f=await realOutingEditor();field(f.modal.contentEl,'Outing visit quick note','Pane A unsaved text');
 const current=await f.store.outings.saveDraft(f.outing.path,'stop',{...blankInput(),observations:'Pane B newer text',itemsPurchased:6},f.outing.revision);
 await f.modal.saveVisit();await f.modal.saveVisit();
 assert.match(f.modal.status.textContent,/changed/);assert.equal(f.modal.record.revision,f.outing.revision);
 assert.equal((await f.store.outings.get(f.outing.path)).revision,current.revision);
 assert.equal((await f.store.visits.list(f.source.path)).length,0);
 const fieldA=all(f.modal.contentEl).find(el=>el.attributes['aria-label']==='Outing visit quick note');
 assert.equal(fieldA.value,'Pane A unsaved text');assert.equal(fieldA.disabled,false);
 f.modal.close();
 // Await the actual failed draft write before pressing the re-enabled close action.
 await f.modal.queue.catch(()=>undefined);await settle();assert.equal(f.modal.closed,false);assert.equal(f.modal.saving,false);
 await all(f.modal.contentEl).find(el=>el.textContent==='Close without saving this form').onclick();await settle();
 assert.equal(f.modal.closed,true);assert.equal((await f.store.outings.get(f.outing.path)).revision,current.revision);
});

test('explicit conflict reload restores saved details and permits a reviewed save',async()=>{
 const f=await realOutingEditor();field(f.modal.contentEl,'Outing visit quick note','Pane A unsaved text');
 await f.store.outings.saveDraft(f.outing.path,'stop',{...blankInput(),observations:'Pane B newer text',itemsPurchased:6},f.outing.revision);
 await f.modal.saveVisit();
 const reload=all(f.modal.contentEl).find(el=>el.textContent==='Reload saved details');assert.ok(reload);
 const listPlaces=f.store.listPlaces.bind(f.store);f.store.listPlaces=async()=>{throw Error('Temporary read failure');};
 await reload.onclick();assert.match(f.modal.status.textContent,/Temporary read failure/);
 assert.equal(all(f.modal.contentEl).find(el=>el.attributes['aria-label']==='Outing visit quick note').value,'Pane A unsaved text');
 f.store.listPlaces=listPlaces;await reload.onclick();
 assert.equal(all(f.modal.contentEl).find(el=>el.attributes['aria-label']==='Outing visit quick note').value,'Pane B newer text');
 assert.equal(all(f.modal.contentEl).find(el=>el.attributes['aria-label']==='Items purchased').value,'6');
 await f.modal.saveVisit();assert.equal(f.modal.closed,true);
 const visits=await f.store.visits.list(f.source.path);assert.equal(visits.length,1);assert.equal(visits[0]!.observations,'Pane B newer text');assert.equal(visits[0]!.itemsPurchased,6);
});

test('an outing visit interruption keeps its explicit recovery action and records only once',async()=>{
 const f=await realOutingEditor();field(f.modal.contentEl,'Outing visit quick note','Retained for recovery');
 const create=f.vault.create.bind(f.vault);let fail=true;
 f.vault.create=async(path,text)=>{if(fail&&path.includes('/Visits/')){fail=false;throw Error('Interrupted visit write');}return create(path,text);};
 await f.modal.saveVisit();assert.ok((await f.store.outings.get(f.outing.path)).operation);
 const retry=all(f.modal.contentEl).find(el=>el.textContent==='Retry completion');assert.ok(retry);await retry.onclick();
 assert.equal(f.modal.closed,true);assert.equal((await f.store.visits.list(f.source.path)).length,1);
 assert.equal((await f.store.outings.get(f.outing.path)).operation,undefined);
});

test('an uncertain completed outing visit retries its original identity without a duplicate',async()=>{
 const f=await realOutingEditor();field(f.modal.contentEl,'Outing visit quick note','Saved once');
 const process=f.vault.process.bind(f.vault);let fail=true;
 f.vault.process=async(file,callback)=>{const result=await process(file,callback);if(fail&&file.path===f.outing.path){const latest=await f.store.outings.get(f.outing.path);if(latest.groups[0]!.stops[0]!.status==='visited'){fail=false;throw Error('Completion acknowledgement lost');}}return result;};
 await f.modal.saveVisit();assert.equal(f.modal.closed,false);assert.equal((await f.store.visits.list(f.source.path)).length,1);
 await f.modal.saveVisit();assert.equal(f.modal.closed,true);assert.equal((await f.store.visits.list(f.source.path)).length,1);
});


test('another pane visit operation never replaces a conflicting outing form',async()=>{
 const f=await realOutingEditor();field(f.modal.contentEl,'Outing visit quick note','Pane A unsaved text');
 const otherInput={...blankInput(),observations:'Pane B durable operation',itemsPurchased:4};
 const draft=await f.store.outings.saveDraft(f.outing.path,'stop',otherInput,f.outing.revision);
 const create=f.vault.create.bind(f.vault);f.vault.create=async(path,text)=>{if(path.includes('/Visits/'))throw Error('Interrupted other pane');return create(path,text);};
 await assert.rejects(f.store.outings.recordVisit(f.outing.path,'stop',otherInput,{revision:draft.revision,operationId:draft.draft!.operationId}),/Interrupted other pane/);
 const pending=await f.store.outings.get(f.outing.path);assert.ok(pending.operation);
 await f.modal.saveVisit();
 assert.equal(all(f.modal.contentEl).find(el=>el.attributes['aria-label']==='Outing visit quick note').value,'Pane A unsaved text');
 assert.equal(all(f.modal.contentEl).some(el=>el.textContent==='Retry completion'),false);
 all(f.modal.contentEl).find(el=>el.textContent==='Close without saving this form').onclick();await settle();
 assert.equal((await f.store.outings.get(f.outing.path)).revision,pending.revision);
});

test('outing browsing shows valid outings beside targeted malformed-note diagnostics',async()=>{
 const h=harness(),el=h.element(),opened:string[]=[];
 h.context.root='Book';h.context.openFile=async()=>{throw Error('Review must open Markdown outside the workspace router');};
 h.context.app={vault:{getAbstractFileByPath:(path:string)=>h.file(path)},workspace:{getLeaf:(kind:string)=>{assert.equal(kind,'tab');return{openFile:async(file:any,options:any)=>{assert.equal(options.state.mode,'source');opened.push(file.path);}};}}};
 h.context.store.outings={inspect:async()=>({records:[{name:'Valid outing',path:'Book/Outings/Good.md',status:'planned',groups:[],revision:'reviewed'}],problems:[{path:'Book/Outings/Broken.md',message:'Invalid outing data'}]}),list:async()=>{throw Error('Strict list must not be used for browsing');}};
 await h.outingHome(el);
 const text=all(el).map(node=>node.textContent).join('\n');assert.match(text,/Valid outing/);assert.match(text,/Book\/Outings\/Broken.md: Invalid outing data/);
 await all(el).find(node=>node.textContent==='Open note to review').onclick();assert.deepEqual(opened,['Book/Outings/Broken.md']);
});

for (const linkedEdit of [false, true]) test(`cold reopening after ${linkedEdit ? 'linked visit edit' : 'standalone creation'} cleanup failure only cleans the draft`, async () => {
 const f=fixture();await f.store.setup();const source=await f.store.saveCapture(newDraft('cleanup'),{town:'Exampletown',locality:''},'Source');
 let visitPath:string|undefined;
 if(linkedEdit){
  const outing=await f.store.outings.create({name:'A small outing',groups:[{id:'group',parkingPath:'',stops:[{id:'stop',sourcePath:source.path,status:'pending'}]}]});
  const recorded=await f.store.outings.recordVisit(outing.path,'stop',{...blankInput(),itemsPurchased:1});visitPath=recorded.groups[0]!.stops[0]!.visitPath;
 }
 const h=harness();h.context.store=f.store;h.context.app=f.app;h.context.kind='real';
 const first=new h.api.StructuredVisitModal(h.context,source.path,visitPath);await first.load();
 field(first.contentEl,'Visit quick note','One actual visit');field(first.contentEl,'Items purchased','3');
 const clear=f.store.visits.clearDraft.bind(f.store.visits);let fail=true;
 f.store.visits.clearDraft=async(...args)=>{if(fail){fail=false;throw Error('Draft cleanup unavailable');}return clear(...args);};
 await first.save();assert.equal(first.completed,true);assert.match(first.status.textContent,/cleanup/);assert.equal((await f.store.visits.list(source.path)).length,1);first.close();
 const saved=(await f.store.visits.list(source.path))[0]!;
 const vf=f.vault.getFiles().find(file=>file.path===saved.path)!;
 await f.vault.process(vf,raw=>updateNoteProperty(raw,'items_purchased',7)+'Personal correction after saving.\n');
 await f.store.updateAssessment(source.path,{rating:1.5,comments:'Later source correction'});
 const sourceBefore=await f.vault.read(source),visitBefore=await f.vault.read(vf);
 const second=new h.api.StructuredVisitModal(h.context,source.path,visitPath);await second.load();
 assert.equal(second.completed,true);assert.match(all(second.contentEl).map(el=>el.textContent).join(' '),/already recorded/);
 assert.equal(all(second.contentEl).some(el=>el.attributes['aria-label']==='Visit quick note'),false);
 // Merely closing this cleanup screen must not apply any old input or lose the receipt.
 second.close();assert.equal(await f.vault.read(vf),visitBefore);assert.equal(await f.vault.read(source),sourceBefore);
 const third=new h.api.StructuredVisitModal(h.context,source.path,visitPath);await third.load();await third.save();
 assert.equal(third.closed,true);assert.equal(await f.vault.read(vf),visitBefore);assert.equal(await f.vault.read(source),sourceBefore);
 assert.equal((await f.store.visits.list(source.path)).length,1);assert.equal((await f.store.visits.getDraftState(source.path,visitPath))?.cleared,true);
 assert.equal(readNote(visitBefore).properties.items_purchased,7);
 if(linkedEdit){const current=await f.store.visits.get(saved.path);assert.equal(current.outingId,saved.outingId);assert.equal(current.stopId,saved.stopId);}
});
