import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

const obsidian = `
export class Value { static equals(a,b){return a===b} }
export class NumberValue extends Value {constructor(n){super();this.n=n} toString(){return String(this.n)}}
export class StringValue extends NumberValue {}
export class ListValue extends Value {constructor(items){super();this.items=items} length(){return this.items.length} get(i){return this.items[i]}}
export class NullValue extends Value { static value = new NullValue(); }
export class BasesView { constructor(controller){this.app=controller.app;this.config=controller.config} register(){} registerEvent(){} registerDomEvent(){} }
export class App {}
export class Notice {}
export class Modal {}
export class Setting {}
export class Menu {}
export const Platform={isMobile:false,isMobileApp:false};
export const Keymap={}; export function setIcon(){} export const debounce=fn=>fn;
export function requestUrl(options){return globalThis.__mapRequest(options)};
`;
const libre = `
export class Map { constructor(options){globalThis.__mapInstances++;this.options=options;this.handlers={}} on(e,fn){this.handlers[e]=fn;return this} addControl(){} remove(){globalThis.__mapRemoved++} }
export class LngLatBounds {} export class Marker {} export class Popup {}
export async function setRTLTextPlugin(){} export function getRTLTextPluginStatus(){return 'loaded'}
export function setWorkerUrl(){} export function clearPrewarmedResources(){}
`;
async function loadModule(source: string) {
  const result = await build({stdin:{contents:source,resolveDir:path.resolve('.'),sourcefile:'map-runtime-entry.ts'},define:{__MAP_WORKER_CODE__:'"/* fixture worker */"'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{
    name:'map-public-api-stubs', setup(build) {
      build.onResolve({filter:/^(obsidian|maplibre-gl)$/},args=>({path:args.path,namespace:'map-test'}));
      build.onLoad({filter:/.*/,namespace:'map-test'},args=>({contents:args.path==='obsidian'?obsidian:libre,loader:'js'}));
    }
  }]});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0]!.text).toString('base64'));
}

test('upstream style adapter retains free light/dark styles and custom raster or JSON sources', async () => {
  const m=await loadModule(`export { StyleManager } from './src/map/style';`);
  const requested:string[]=[];
  (globalThis as any).__mapRequest=async ({url}:{url:string})=>{requested.push(url);return {status:200,json:{version:8,sources:{},layers:[],name:url}}};
  let dark=false; const style=new m.StyleManager({isDarkMode:()=>dark});
  assert.match((await style.getMapStyle([],[])).name,/openfreemap.org\/styles\/bright$/);
  dark=true; assert.match((await style.getMapStyle([],[])).name,/openfreemap.org\/styles\/dark$/);
  assert.equal((await style.getMapStyle(['https://example.test/light.json'],['https://example.test/dark.json'])).name,'https://example.test/dark.json');
  const count=requested.length;
  const raster=await style.getMapStyle(['https://example.test/{z}/{x}/{y}.png'],[]);
  assert.equal(requested.length,count); assert.deepEqual(raster.sources['custom-tiles-0'].tiles,['https://example.test/{z}/{x}/{y}.png']);
  assert.equal(raster.layers[0].type,'raster');
});

test('native Bases coordinate adapter accepts exact numbers and rejects partial or extra coordinates', async () => {
  const m=await loadModule(`export * from './src/map/utils'; export {StringValue,NumberValue,ListValue} from 'obsidian';`);
  assert.deepEqual(m.coordinateFromValue(new m.ListValue([new m.NumberValue(12.3),new m.StringValue('45.6')])),[12.3,45.6]);
  assert.deepEqual(m.coordinateFromValue(new m.StringValue('[0, 0]')),[0,0]);
  assert.equal(m.coordinateFromValue(new m.StringValue('12.3bad,45.6')),null);
  assert.equal(m.coordinateFromValue(new m.StringValue('12.3,45.6,2')),null);
  assert.equal(m.coordinateFromValue(new m.ListValue([new m.NumberValue(0),new m.NumberValue(0),new m.NumberValue(1)])),null);
});

test('unloading while remote style is pending prevents late map creation; concurrent initializers share a request', async () => {
  const m=await loadModule(`export {MapView} from './src/map/base-view';`);
  (String as any).isString=(v:unknown)=>typeof v==='string';
  (Number as any).isNumber=(v:unknown)=>typeof v==='number';
  let release:(value:unknown)=>void=()=>{}; let requests=0;
  (globalThis as any).__mapInstances=0; (globalThis as any).__mapRemoved=0;
  (globalThis as any).__mapRequest=()=>{requests++;return new Promise(resolve=>{release=resolve})};
  const element=()=>({createDiv:()=>element(),parentElement:null,style:{},querySelector:()=>null,setText(){},remove(){},removeClass(){},addClass(){}});
  const app={isDarkMode:()=>false,workspace:{openLinkText(){}}};
  const config={get:()=>null,getAsPropertyId:()=>null,getEvaluatedFormula:()=>null};
  const view=new m.MapView({app,config},element(),{app,settings:{root:'Charity Sourcing',tileSets:[]}});
  const first=view.initializeMap(), second=view.initializeMap();
  assert.equal(requests,1); assert.equal(first,second);
  view.onunload();
  release({status:200,json:{version:8,sources:{},layers:[]}});
  await Promise.all([first,second]);
  assert.equal((globalThis as any).__mapInstances,0);
  delete (String as any).isString; delete (Number as any).isNumber;
});
