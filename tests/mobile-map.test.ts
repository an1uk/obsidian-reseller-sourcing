import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {nearestTouchMarker} from '../src/map/touch';

const obsidian = `
export class Value {static equals(a,b){return a===b}}
export class StringValue extends Value {constructor(value){super();this.value=value} toString(){return String(this.value)}}
export class NumberValue extends StringValue {}
export class ListValue extends Value {}
export class NullValue extends Value {static value=new NullValue()}
export class App {}
export class Component {register(){} registerEvent(){} unload(){this.onunload?.()}}
export class BasesView extends Component {constructor(controller){super();this.app=controller.app;this.config=controller.config} registerDomEvent(el,event,fn){el.addEventListener(event,fn)}}
export class Modal {constructor(app){this.app=app;this.modalEl=globalThis.__element();this.titleEl=globalThis.__element();this.contentEl=globalThis.__element()} open(){globalThis.__fallback=this;this.onOpen?.()}}
export class Setting {constructor(el){} addButton(fn){fn({setButtonText(){return this},onClick(){return this}});return this}}
export class Notice {constructor(text){(globalThis.__notices??=[]).push(text)}}
export class Menu {constructor(){this.items=[];globalThis.__menu=this} static forEvent(){return new Menu()} addItem(fn){const item={setTitle(title){this.title=title;return this},setSection(){return this},setIcon(){return this},setWarning(){return this},onClick(fn){this.run=fn;return this}};fn(item);this.items.push(item);return this} showAtMouseEvent(){}}
export const Platform={isMobile:true,isMobileApp:true};
export const Keymap={isModEvent:event=>!!event.ctrlKey};
export function setIcon(){}
export const debounce=fn=>fn;
export function requestUrl(options){return globalThis.__request(options)}
`;
const libre = `
export class Map {constructor(options){this.options=options;this.handlers={};this.center={lng:options.center[0],lat:options.center[1]};this.zoom=options.zoom;this.canvas=globalThis.__element();options.container?.children.push(this.canvas);(globalThis.__maps??=[]).push(this)}
 on(event,layer,fn){const key=typeof layer==='string'?event+':'+layer:event;(this.handlers[key]??=[]).push(typeof layer==='function'?layer:fn);return this}
 off(event,fn){this.handlers[event]=(this.handlers[event]??[]).filter(handler=>handler!==fn);return this}
 emit(event,value={}){for(const fn of this.handlers[event]??[])fn(value)}
 addControl(control){return this} remove(){this.removed=true}
 getCenter(){return this.center} getZoom(){return this.zoom} getCanvas(){return this.canvas} getContainer(){return this.options.container}
 project(value){return {x:value[0],y:value[1]}} setCenter(value){this.center={lng:value[0],lat:value[1]}} setZoom(value){this.zoom=value}
 flyTo(options){this.flown=options} setStyle(){} isStyleLoaded(){return true} resize(){}
}
export class LngLatBounds {extend(){return this} isEmpty(){return true}}
export class Marker {constructor(options){this.options=options;(globalThis.__markers??=[]).push(this)} setLngLat(value){this.position=value;return this} addTo(){return this} remove(){this.removed=true} setPopup(){return this}}
export class Popup {constructor(options){this.options=options;this.handlers={};this.element=globalThis.__element();if(options.closeButton)this.element.createEl('button',{text:'Close'});(globalThis.__popups??=[]).push(this)} on(event,fn){this.handlers[event]=fn;return this} setDOMContent(content){this.content=content;return this} setLngLat(){return this} addTo(){this.open=true;this.handlers.open?.();return this} getElement(){return this.element} remove(){this.open=false;return this}}
export function getRTLTextPluginStatus(){return 'loaded'} export function setWorkerUrl(){} export function clearPrewarmedResources(){}
export async function setRTLTextPlugin(){}
`;
class Element {
  children:Element[]=[]; parentElement:Element|null=null; tagName:string; className=''; textContent=''; attributes:Record<string,string>={};
  style:any={setProperty(){},removeProperty(){}}; listeners:Record<string,Array<(event:any)=>void>>={}; ownerDocument:any; win=globalThis; value=''; rows=0; isConnected=true;
  constructor(tag='div',doc:any=undefined){this.tagName=tag;this.ownerDocument=doc??documentFixture();}
  createEl(tag:string,options:any={}){const el=new Element(tag,this.ownerDocument);el.parentElement=this;el.textContent=options.text??'';el.className=options.cls??'';el.attributes={...(options.attr??{})};this.children.push(el);return el}
  createDiv(options:any=''){return this.createEl('div',typeof options==='string'?{cls:options}:options)}
  createSpan(options:any=''){return this.createEl('span',typeof options==='string'?{cls:options}:options)}
  createSvg(tag:string,options:any){return this.createEl(tag,options)}
  appendChild(el:Element){el.remove();this.children.push(el);el.parentElement=this;return el}
  setText(text:string){this.children=[];this.textContent=text} empty(){this.children=[];this.textContent=''}
  setAttribute(key:string,value:string){this.attributes[key]=value} getAttribute(key:string){return this.attributes[key]??null}
  addClass(value:string){this.className+=' '+value} removeClass(value:string){this.className=this.className.replace(value,'')} toggleClass(value:string,on:boolean){on?this.addClass(value):this.removeClass(value)}
  setCssProps(){} setCssStyles(){} remove(){this.parentElement?.children.splice(this.parentElement.children.indexOf(this),1)} detach(){this.remove()}
  focus(){this.ownerDocument.activeElement=this} select(){} addEventListener(type:string,fn:(event:any)=>void){(this.listeners[type]??=[]).push(fn)}
  instanceOf(type:any){return this instanceof type}
  removeEventListener(type:string,fn:(event:any)=>void){this.listeners[type]=(this.listeners[type]??[]).filter(value=>value!==fn)}
  click(){for(const fn of this.listeners.click??[])fn({preventDefault(){},stopPropagation(){}})}
  querySelector(selector:string):Element|null {return this.children.find(el=>el.tagName===selector)??this.children.map(el=>el.querySelector(selector)).find(Boolean)??null}
  find(text:string):Element|undefined {return this.children.find(el=>el.textContent===text)??this.children.map(el=>el.find(text)).find(Boolean)}
}
function documentFixture(){
  const listeners:Record<string,Array<()=>void>>={};
  const doc:any={hidden:false,adoptNode:(el:Element)=>{el.ownerDocument=doc;return el},createElement:(tag:string)=>new Element(tag,doc),addEventListener:(event:string,fn:()=>void)=>{(listeners[event]??=[]).push(fn)},removeEventListener:(event:string,fn:()=>void)=>{listeners[event]=(listeners[event]??[]).filter(item=>item!==fn)},emit:(event:string)=>{for(const fn of listeners[event]??[])fn()}};
  return doc;
}
async function load(source:string){
  const result=await build({stdin:{contents:source,resolveDir:path.resolve('.'),sourcefile:'mobile-map-entry.ts'},define:{__MAP_WORKER_CODE__:'"fixture"'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'mobile-stubs',setup(build){
    build.onResolve({filter:/^(obsidian|maplibre-gl)$/},args=>({path:args.path,namespace:'mobile-test'}));
    build.onLoad({filter:/.*/,namespace:'mobile-test'},args=>({contents:args.path==='obsidian'?obsidian:libre,loader:'js'}));
  }}]});
  (globalThis as any).__element=()=>new Element();
  (globalThis as any).HTMLElement=Element;
  (globalThis as any).createDiv=(cls:string)=>{const el=new Element();el.className=cls;return el};
  (globalThis as any).createEl=(tag:string,options:any={})=>{const el=new Element(tag);el.className=options.cls??'';return el};
  (globalThis as any).__request=async()=>({status:200,json:{version:8,sources:{},layers:[]}});
  (globalThis as any).__maps=[];(globalThis as any).__popups=[];(globalThis as any).__markers=[];
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0]!.text).toString('base64'));
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const app=()=>({isDarkMode:()=>false,workspace:{openLinkText(path:string){(globalThis as any).__opened=path},on(){}}});

test('touch pins have a 44px target, choose the nearest marker and reject invalid projections',()=>{
  const pins=[{x:100,y:100},{x:140,y:100},{x:NaN,y:100}];
  assert.equal(nearestTouchMarker({x:121,y:121},pins,p=>p),pins[1]);
  assert.equal(nearestTouchMarker({x:78,y:78},pins,p=>p),pins[0]);
  assert.equal(nearestTouchMarker({x:77,y:100},pins,p=>p),null);
});

test('mobile Base marker taps persist, expose Open note and close button; desktop still opens directly',async()=>{
  const m=await load(`export {MarkerManager} from './src/map/markers';export {PopupManager} from './src/map/popup';export {Map} from 'maplibre-gl';export {Platform} from 'obsidian';`);
  const root=new Element(), currentApp=app(), map=new m.Map({container:root,center:[0,0],zoom:4});
  const popup=new m.PopupManager(root,currentApp,(entry:any,el:Element)=>el.createEl('a',{text:'Google Maps'}));
  popup.setMap(map);const entry={file:{path:'Reseller sourcing/Sources/Exampletown/Shop.md',basename:'Shop'}};
  const manager=new m.MarkerManager(currentApp,root,popup,(path:string)=>(globalThis as any).__opened=path,()=>({properties:[]}),()=>({coordinatesProp:'note.coordinates'}),(prop:string)=>prop);
  manager.setMap(map);manager.markers=[{entry,coordinates:[100,100]}];manager.setupMarkerInteractions();
  (globalThis as any).__opened='';
  map.emit('click',{point:{x:119,y:110},originalEvent:{},preventDefault(){}});
  const opened=root.children.find(el=>el.className==='charity-map-touch-popup')!;
  assert.ok(opened);assert.equal((globalThis as any).__popups.length,0,'touch sheets never inherit MapLibre inline positioning');assert.equal((globalThis as any).__opened,'');
  assert.ok(opened.find('Close'));assert.equal(opened.attributes.role,'dialog');
  assert.ok(opened.find('Google Maps'));opened.find('Open note')!.click();
  assert.equal((globalThis as any).__opened,entry.file.path);
  popup.hidePopup();await new Promise(resolve=>setTimeout(resolve,180));assert.ok(root.children.includes(opened));
  opened.find('Close')!.click();assert.ok(!root.children.includes(opened),'explicit close dismisses persistent touch details');
  map.emit('click',{point:{x:119,y:110},originalEvent:{},preventDefault(){}});
  popup.destroy();assert.equal(root.children.filter(el=>el.className==='charity-map-touch-popup').length,0);
  m.Platform.isMobileApp=false;
  const desktop=new m.MarkerManager(currentApp,root,popup,(path:string)=>(globalThis as any).__opened=path,()=>({properties:[]}),()=>({coordinatesProp:'note.coordinates'}),(prop:string)=>prop);
  desktop.setMap(map);desktop.markers=[{entry,coordinates:[100,100]}];desktop.setupMarkerInteractions();
  (globalThis as any).__opened='';
  map.emit('click:marker-pins',{features:[{properties:{entryIndex:0}}],originalEvent:{}});
  assert.equal((globalThis as any).__opened,entry.file.path);
  m.Platform.isMobileApp=true;
});

test('touch popup focuses its close control, supports Escape and restores the triggering window focus',async()=>{
  const m=await load(`export {MobileMapPopup} from './src/map/mobile-popup';`);
  const doc=documentFixture(),root=new Element('div',doc),trigger=root.createEl('button',{text:'Shop pin'});
  trigger.focus();
  const popup=new m.MobileMapPopup(root),content=new Element('div',doc);
  content.createEl('a',{text:'Preview directions'});
  popup.open(content,'Fictional place',trigger);
  const overlay=root.children.find(el=>el.className==='charity-map-touch-popup')!;
  const close=overlay.find('Close')!;
  assert.equal(doc.activeElement,close);assert.equal(overlay.attributes['aria-modal'],'false');
  assert.equal(content.parentElement,overlay);
  let prevented=false;
  overlay.listeners.keydown[0]({key:'Escape',preventDefault(){prevented=true},stopPropagation(){}});
  assert.equal(prevented,true);assert.equal(doc.activeElement,trigger);assert.ok(!root.children.includes(overlay));
  popup.destroy();
});

test('inline touch markers use the same bounded popup and fictional navigation remains a preview',async()=>{
  const m=await load(`export {PlaceMap} from './src/map/place-map';`);
  const root=new Element(),external:unknown[]=[];
  const host={app:app(),mode:'examples',settings:{root:'Notebook/Examples',tileSets:[]},getPlaces:async()=>[record],openParking(){},confirmMove(){},openExternal:(...args:unknown[])=>external.push(args)};
  const record={path:'Notebook/Examples/Places/Exampletown/Fictional shop.md',name:'Fictional shop',kind:'shop',coordinates:[12,34],properties:{rating:3.5,google_maps_url:'https://www.google.com/maps/place/Fictional+shop',comments:'The coat had a promising label and an unpromising zip'}};
  const place=new m.PlaceMap(root,host,{records:[record]});await place.initialize();
  const marker=(globalThis as any).__markers.at(-1);marker.options.element.click();
  assert.equal((globalThis as any).__popups.length,0);
  const popup=root.children[0].children.find(el=>el.className==='charity-map-touch-popup')!;
  assert.ok(popup);await tick();popup.find('Preview Google Maps')!.click();await tick();
  assert.equal(external.length,1);assert.equal((external[0] as unknown[])[1],'Google Maps');
  popup.find('Close')!.click();assert.equal(root.find('Close'),undefined);place.onunload();
});

test('location starts only on tap, stops when backgrounded or removed and ignores old fixes',async()=>{
  const m=await load(`export {CustomGeolocateControl} from './src/map/controls/geolocate-control';export {Map} from 'maplibre-gl';`);
  const doc=documentFixture(), root=new Element('div',doc);(globalThis as any).createDiv=()=>root;
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');const watches:any[]=[],cleared:number[]=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{watchPosition(success:any,error:any){watches.push({success,error});return watches.length},clearWatch(id:number){cleared.push(id)}}}});
  try{
    const control=new m.CustomGeolocateControl(), map=new m.Map({container:root,center:[0,0],zoom:5});
    control.onAdd(map);assert.equal(watches.length,0);
    const locate=root.children.find(el=>el.tagName==='button')!;locate.click();assert.equal(watches.length,1);
    watches[0].success({coords:{latitude:10,longitude:20}});assert.equal((globalThis as any).__markers.length,1);
    doc.hidden=true;doc.emit('visibilitychange');assert.deepEqual(cleared,[1]);assert.equal(control.isTracking,false);
    watches[0].success({coords:{latitude:30,longitude:40}});assert.equal((globalThis as any).__markers.length,1);
    doc.hidden=false;doc.emit('visibilitychange');assert.equal(watches.length,1);
    locate.click();assert.equal(watches.length,2);watches[0].error({code:1,PERMISSION_DENIED:1});assert.equal(control.isTracking,true);
    control.onRemove();assert.deepEqual(cleared,[1,2]);assert.equal(control.isTracking,false);
    watches[1].success({coords:{latitude:1,longitude:2}});assert.equal((globalThis as any).__markers.length,1);
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete (globalThis as any).navigator}
});

test('synchronous permission denial cannot leave an orphaned location watch',async()=>{
  const m=await load(`export {CustomGeolocateControl} from './src/map/controls/geolocate-control';export {Map} from 'maplibre-gl';`);
  const root=new Element();(globalThis as any).createDiv=()=>root;const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');const cleared:number[]=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{watchPosition(success:any,error:any){error({code:1,PERMISSION_DENIED:1});return 7},clearWatch(id:number){cleared.push(id)}}}});
  try{
    const control=new m.CustomGeolocateControl();control.onAdd(new m.Map({container:root,center:[0,0],zoom:5}));root.children.find(el=>el.tagName==='button')!.click();
    assert.deepEqual(cleared,[7]);assert.equal(control.isTracking,false);control.onRemove();
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete (globalThis as any).navigator}
});

test('Base Map actions save the camera centre and zoom without right-clicking',async()=>{
  const m=await load(`export {MapView} from './src/map/base-view';`);
  (String as any).isString=(v:unknown)=>typeof v==='string';(Number as any).isNumber=(v:unknown)=>typeof v==='number';
  const writes:Record<string,unknown>={}, config={get:()=>null,getAsPropertyId:()=>null,getEvaluatedFormula:()=>null,set:(key:string,value:unknown)=>writes[key]=value};
  try{
    const currentApp=app(), view=new m.MapView({app:currentApp,config},new Element(),{app:currentApp,settings:{root:'Reseller sourcing',tileSets:[]}});await view.initializeMap();
    const map=(globalThis as any).__maps.at(-1);map.center={lat:12.3456789,lng:-2.7654321};map.zoom=14.26;
    view.showMapActions({});const menu=(globalThis as any).__menu;menu.items.find((item:any)=>item.title==='Save current centre').run();menu.items.find((item:any)=>item.title.startsWith('Save current zoom')).run();
    assert.equal(writes.center,'[12.34568, -2.76543]');assert.equal(writes.defaultZoom,14.3);
    view.onunload();
  }finally{delete (String as any).isString;delete (Number as any).isNumber}
});

test('inline map errors expose Retry map and preserve records and camera across recreation',async()=>{
  const m=await load(`export {PlaceMap} from './src/map/place-map';`);
  const currentApp=app(), root=new Element(), host={app:currentApp,settings:{root:'Reseller sourcing',tileSets:[]},openParking(){throw Error('Must not create parking')},confirmMove(){throw Error('Must not move a place')}};
  const place=new m.PlaceMap(root,host,{records:[],readOnly:true});await place.initialize();const first=(globalThis as any).__maps.at(-1);
  first.center={lng:7,lat:8};first.zoom=16;first.emit('error',{error:Error('tile fixture failure')});
  assert.ok(root.find('Retry map'));first.emit('load');assert.ok(root.find('Retry map'),'load cannot erase a tile failure');
  root.find('Retry map')!.click();await tick();const second=(globalThis as any).__maps.at(-1);
  assert.notEqual(first,second);assert.equal(first.removed,true);assert.deepEqual(second.options.center,[7,8]);assert.equal(second.options.zoom,16);
  place.setPickMode('move');assert.equal(place.pickMode,null,'read-only outing maps cannot move places');
  place.setPickMode('copy');assert.equal(place.pickMode,'copy','read-only maps still support coordinate copying');place.onunload();
});

test('Base WebGL failure exposes retry without removing the query table',async()=>{
  const m=await load(`export {MapView} from './src/map/base-view';`);
  (String as any).isString=(v:unknown)=>typeof v==='string';(Number as any).isNumber=(v:unknown)=>typeof v==='number';
  try{
    const currentApp=app(), root=new Element(), config={get:()=>null,getAsPropertyId:()=>null,getEvaluatedFormula:()=>null,set(){}};
    const view=new m.MapView({app:currentApp,config},root,{app:currentApp,settings:{root:'Reseller sourcing',tileSets:[]}});await view.initializeMap();
    const first=(globalThis as any).__maps.at(-1);first.center={lng:3,lat:4};first.zoom=12;first.emit('webglcontextlost');
    assert.ok(root.find('Retry map'));await view.retryMap();assert.equal(first.removed,true);assert.equal(root.children.length,1);assert.equal(view.disposed,false);
    view.onunload();
  }finally{delete (String as any).isString;delete (Number as any).isNumber}
});

test('a rejected Base background change is caught and offers a visible retry',async()=>{
  const m=await load(`export {MapView} from './src/map/base-view';`);
  (String as any).isString=(v:unknown)=>typeof v==='string';(Number as any).isNumber=(v:unknown)=>typeof v==='number';
  try{
    const currentApp=app(),root=new Element(),config={get:()=>null,getAsPropertyId:()=>null,getEvaluatedFormula:()=>null,set(){}};
    const view=new m.MapView({app:currentApp,config},root,{app:currentApp,settings:{root:'Reseller sourcing',tileSets:[]}});await view.initializeMap();
    const map=(globalThis as any).__maps.at(-1);map.setStyle=()=>{throw Error('Invalid replacement background')};
    await assert.doesNotReject(()=>view.updateMapStyle());
    assert.ok(root.find('Retry map'));assert.equal(map.removed,undefined,'background errors preserve the current map and notes');
    view.onThemeChange();await tick();assert.ok(root.find('Retry map'));
    view.onunload();
  }finally{delete (String as any).isString;delete (Number as any).isNumber}
});

test('empty practice Bases resolve their declared notebook and cannot mix real rows',async()=>{
  const m=await load(`export {MapView} from './src/map/base-view';`);
  const realRoot='Notebook', exampleRoot=realRoot+'/Examples';
  const currentApp=app(), practice={app:currentApp,settings:{root:exampleRoot,tileSets:[]},mode:'examples',ownsPath:(path:string)=>path.startsWith(exampleRoot+'/'),assertCurrent(){}};
  const config={get:(key:string)=>key==='notebookRoot'?exampleRoot:null,getAsPropertyId:()=>null,getEvaluatedFormula:()=>null};
  const real={app:currentApp,settings:{root:realRoot,tileSets:[]},ownsPath:(path:string)=>path.startsWith(realRoot+'/')&&!path.startsWith(exampleRoot+'/'),resolveNotebook:async(root:string)=>root===exampleRoot?practice:undefined};
  const view=new m.MapView({app:currentApp,config},new Element(),real);
  await view.resolveContext();
  assert.equal(view.plugin,practice);
  assert.deepEqual(view.mapData().data,[],'an empty practice map still has the right creation context');
  const allowed={file:{path:exampleRoot+'/Sources/A.md'}},blocked={file:{path:realRoot+'/Sources/Real.md'}};
  view.data={data:[allowed,blocked],properties:[]};
  assert.deepEqual(view.mapData().data,[allowed]);
  const invalid=new m.MapView({app:currentApp,config:{...config,get:()=>realRoot+'/Foreign'}},new Element(),real);
  await assert.rejects(invalid.resolveContext(),/invalid context/);
  assert.deepEqual(invalid.mapData().data,[]);
  view.onunload();invalid.onunload();
});

test('practice camera saves use scoped storage and deleted contexts cannot write Base config',async()=>{
  const m=await load(`export {MapView} from './src/map/base-view';`);
  const currentApp=app(),root='Notebook/Examples',path=root+'/System/Sources.base',writes:unknown[]=[];
  let current=true;
  const config={name:'Map',get:(key:string)=>key==='notebookBasePath'?path:key==='notebookRoot'?root:null,getAsPropertyId:()=>null,getEvaluatedFormula:()=>null,set:()=>{throw Error('unsafe native config write');}};
  const host={app:currentApp,settings:{root,tileSets:[]},mode:'examples',assertCurrent(){if(!current)throw Error('Deleted practice context');},persistMapConfig:async(...args:unknown[])=>{writes.push(args)}};
  const view=new m.MapView({app:currentApp,config},new Element(),host);
  await view.resolveContext();
  view.saveMapConfig('defaultZoom',17);await tick();
  assert.deepEqual(writes,[[path,'Map','defaultZoom',17]]);
  current=false;view.saveMapConfig('center','[1, 2]');await tick();
  assert.equal(writes.length,1);
  assert.ok((globalThis as any).__notices.some((n:string)=>n.includes('Deleted practice context')));
  view.onunload();
});
