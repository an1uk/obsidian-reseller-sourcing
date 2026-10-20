import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { catchupVisitDate } from '../src/outings/catch-up';

function harness(existing = false) {
 class Element {
  children: Element[] = []; parent?: Element; tag='div'; textContent=''; value=''; type=''; disabled=false; isConnected=true; hidden=false; inert=false; open=false;
  attributes: Record<string,string>={}; cls=''; style:any={}; readOnly=false; rows=0; min=''; step=''; id=''; placeholder=''; checked=false;
  onchange?:()=>unknown; onclick?:()=>unknown;
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
 let draft:any,draftRevision='',draftVisitRevision:string|undefined,draftCleared=false,draftCounter=0,operations:any[]=[],released=0,create=0,update=0,draftSaves=0,clears=0,resumed=0,cancelled=0,failUpdate=false,failClear=false,waitPlaces:Promise<unknown>|undefined;
 const saves:any[]=[];const notices:string[]=[];const timers=new Map<number,()=>void>();let timer=0;
 const context:any={kind:'examples',app:{},beginEditing:()=>()=>released++,openFile:async()=>{},store:{listPlaces:async()=>{if(waitPlaces)await waitPlaces;return[source];},visits:{
  list:async()=>existing?[structuredClone(record)]:[],get:async()=>structuredClone(record),getDraft:async()=>draft&&!draftCleared?structuredClone(draft):undefined,getDraftState:async()=>draft?{input:structuredClone(draft),revision:draftRevision,visitRevision:draftVisitRevision,cleared:draftCleared}:undefined,
  saveDraft:async(_source:string,input:any,_path:string,expected:string,visitRevision?:string)=>{if(expected!==draftRevision)throw Error('The visit draft changed in another pane');draftSaves++;draft=structuredClone(input);draftRevision='draft-'+(++draftCounter);draftVisitRevision=visitRevision;draftCleared=false;return draftRevision;},clearDraft:async(_source:string,_path:string,expected:string)=>{clears++;if(failClear)throw Error('Draft cleanup interrupted');if(expected!==draftRevision)throw Error('The visit draft changed in another pane');if(draft){draftCleared=true;draftRevision='draft-'+(++draftCounter);}},
  create:async(path:string,input:any,options:any)=>{create++;saves.push({path,input:structuredClone(input),options});return{...structuredClone(record),...input};},
  update:async(path:string,input:any,revision:string)=>{update++;saves.push({path,input:structuredClone(input),revision});if(failUpdate||revision!==record.revision)throw Error('Visit changed before save');return{...structuredClone(record),...input};},
  pendingOperations:async()=>structuredClone(operations),resumeOperation:async()=>{resumed++;operations=[];return record;},cancelOperation:async()=>{cancelled++;operations=[];},
 }}};
 const module={exports:{} as Record<string,any>};
 const code=transformSync(fs.readFileSync(new URL('../src/ui/visits.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
 const sandbox:any={module,exports:module.exports,structuredClone,Number,Date,Map,Set,Error,crypto:{randomUUID:()=> 'ui-operation-'+(++timer)},window:{setTimeout:(callback:()=>void)=>{const id=++timer;timers.set(id,callback);return id;},clearTimeout:(id:number)=>timers.delete(id)},
 require(id:string){if(id==='../outings/catch-up')return{catchupVisitDate:(record:any,stop:any)=>catchupVisitDate(record,stop,new Date('2026-10-18T12:00:00Z'))};if (id.endsWith('modal-layout')) return { markInputModal() {}, modalWindow: () => sandbox.window }; if(id==='obsidian')return{Component:class{},Modal,Setting,Notice:class{constructor(message:string){notices.push(message);}}};if(id==='../storage/markdown')return{localDate:(date?:Date)=>date?date.toISOString().slice(0,10):'2026-10-18'};if(id==='../ui')return{button:(parent:Element,text:string,run:()=>unknown)=>{const button=parent.createEl('button',{text});button.onclick=run;return button;},details:(parent:Element,title:string)=>{const value=parent.createEl('details');value.createEl('summary',{text:title});return value;},propertyText: (value: unknown, fallback = '') => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback, errorText:(error:any)=>error.message??String(error),renderContextBanner:()=>{}};if(id==='./visits')return module.exports;if(['../domain','../outings/domain','../map','./outing-route','./outing-planner','../workspace/outing-preparation','./outing-shortcuts','./outing-catchup'].includes(id))return{};throw Error('Unexpected import '+id);}
 };vm.runInNewContext(code,sandbox);
 const api=module.exports,modal=new api.StructuredVisitModal(context,record.sourcePath,existing?record.path:undefined);
 const outingModal=(path:string,stopId:string)=>{const out={exports:{} as Record<string,any>};vm.runInNewContext(transformSync(fs.readFileSync(new URL('../src/ui/outings.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,{...sandbox,module:out,exports:out.exports});return new out.exports.OutingVisitModal(context,path,stopId);};
 return{api,modal,context,record,source,saves,notices,outingModal,element:()=>new Element(),counts:()=>({released,create,update,draftSaves,clears,resumed,cancelled}),
 setDraft:(value:any,meta:{visitRevision?:string;cleared?:boolean}={})=>{draft=structuredClone(value);draftRevision='draft-'+(++draftCounter);draftVisitRevision=meta.visitRevision;draftCleared=meta.cleared??false;},getDraft:()=>draftCleared?undefined:draft,setOperations:(value:any[])=>operations=value,failUpdate:()=>failUpdate=true,failClear:(value:boolean)=>failClear=value,deferPlaces:(pending:Promise<unknown>)=>waitPlaces=pending};
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
