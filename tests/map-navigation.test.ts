import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placeNavigation} from '../src/map/navigation';
import type {PlaceRecord} from '../src/types';

const shop: PlaceRecord = {path:'Charity Sourcing/Shops/Riverside/Shop.md', name:'Shop',kind:'shop',locality:'Riverside',coordinates:[12.3,45.6],properties:{rating:0}};
const parking = (name: string, coords: [number,number] | null): PlaceRecord => ({path:`Charity Sourcing/Parking/Riverside/${name}.md`,name,kind:'parking',locality:'Riverside',coordinates:coords,properties:{parking_for:[`[[${shop.path}]]`]}});
test('map popup drives to shared parking while walking remains directed to the shop', () => {
  const p = parking('Car park',[12.31,45.61]);
  const n = placeNavigation(shop,[shop,p]);
  assert.match(n.drive,/destination=12.31,45.61/); assert.match(n.walk,/destination=12.3,45.6/);
  assert.match(n.drive,/travelmode=driving/); assert.match(n.walk,/travelmode=walking/);
  assert.equal(n.choices.length,0);
});
test('multiple parking options require a destination choice unless explicitly preferred', () => {
  const a=parking('A',[12.31,45.61]),b=parking('B',[12.32,45.62]);
  const n=placeNavigation(shop,[shop,a,b]); assert.equal(n.drive,''); assert.deepEqual(n.choices.map(c => c.name),['A','B']);
  const preferred={...shop,properties:{parking_location:`[[${b.path}]]`}};
  assert.match(placeNavigation(preferred,[preferred,a,b]).drive,/destination=12.32,45.62/);
});
test('invalid preferred parking cannot silently fall back to the shop destination', () => {
  const broken={...shop,properties:{parking_location:'[[Deleted parking]]'}};
  assert.equal(placeNavigation(broken,[broken]).drive,'');
  assert.match(placeNavigation(broken,[broken]).walk,/walking/);
});
test('missing coordinates keep a valid listing link but no navigation actions', () => {
  const p={...shop,coordinates:null,properties:{google_maps_url:'https://www.google.com/maps/place/Test/'}};
  const n=placeNavigation(p,[p]); assert.equal(n.listing,p.properties.google_maps_url); assert.equal(n.drive,''); assert.equal(n.walk,'');
});
