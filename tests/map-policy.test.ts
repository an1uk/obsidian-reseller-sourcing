import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FitPolicy, fitOptions, validCoordinates, mapCoordinates, visiblePlaces, ratingColour, PLACE_ZOOM, LOCALITY_HEIGHT, LOCALITY_MAX_ZOOM} from '../src/map/policy';
import type {PlaceRecord} from '../src/types';

const place = (path: string, coordinates: unknown, properties = {}, kind: 'shop'|'parking' = 'shop'): PlaceRecord =>
  ({path, coordinates:coordinates as PlaceRecord['coordinates'], properties, kind, name:path, locality:'Locality'});

test('coordinate order is explicit and invalid values cannot become map destinations', () => {
  assert.deepEqual(mapCoordinates([12.3057904,45.651864]),[45.651864,12.3057904]);
  for (const v of [null,undefined,[],[0],[0,0,0],[91,0],[0,181],[Infinity,0],[NaN,0],['12.3','45.6']]) assert.equal(validCoordinates(v),false);
  for (const v of [[0,0],[-90,-180],[90,180],[12.3057904,45.651864]]) assert.equal(validCoordinates(v),true);
});

test('maps cannot leak old experiment notes and closed shops remain excluded', () => {
  const rows = [place('Charity Sourcing/Shops/A.md',[1,2]),place('Charity Sourcing/Parking/P.md',[1,2],{},'parking'),
    place('Charity Sourcing/Shops/closed.md',[1,2],{shop_closed:true}),place('Charity Sourcing/Shops/missing.md',null),
    place('Charity Sourcing Other/Shops/B.md',[1,2]),place('Maps/Places/old.md',[1,2])];
  assert.deepEqual(visiblePlaces(rows,'Charity Sourcing').map(p => p.name),[rows[0]!.name,rows[1]!.name]);
});

test('locality fits leave useful edge padding and a single pin does not overzoom', () => {
  assert.deepEqual(fitOptions(false),{padding:64,maxZoom:15,duration:0});
  assert.deepEqual(fitOptions(true),{padding:32,maxZoom:15,duration:0});
  assert.equal(PLACE_ZOOM,16); assert.equal(LOCALITY_HEIGHT,680); assert.equal(LOCALITY_MAX_ZOOM,15);
  const desktop=fitOptions(false); desktop.padding=1;
  assert.equal(fitOptions(false).padding,64,'MapLibre mutation cannot alter subsequent fits');
});

test('manual camera movement persists across data updates until Fit all', () => {
  const camera = new FitPolicy(); assert.equal(camera.automatic,true);
  camera.userMoved(); assert.equal(camera.automatic,false);
  camera.userMoved(); assert.equal(camera.automatic,false);
  camera.resume(); assert.equal(camera.automatic,true);
});

test('numeric sourcing colour uses half-star scale independently of Google score', () => {
  assert.equal(ratingColour(0),'#2563eb'); assert.equal(ratingColour(null),'#2563eb');
  assert.equal(ratingColour(1.5),'#dc2626'); assert.equal(ratingColour(2),'#d97706');
  assert.equal(ratingColour(3.5),'#d97706'); assert.equal(ratingColour(4),'#16a34a');
  assert.equal(ratingColour(5),'#16a34a'); assert.equal(ratingColour(4.3),'#2563eb');
  assert.equal(ratingColour(6),'#2563eb'); assert.equal(ratingColour(-1),'#2563eb');
});
