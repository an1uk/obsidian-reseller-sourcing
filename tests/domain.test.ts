import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPlaceIdentity, formatRating, googleMapsUrl, haversineKm, localitySuggestions, navigationUrl, parseGooglePlaceUrl, ratingColor, resolveParking, safeFileName, validateCoordinates, validateRootPath } from '../src/domain';
import type { PlaceRecord } from '../src/types';

// These listings, coordinates, addresses and contacts are synthetic regression fixtures.

export const selectedListing = "https://www.google.com/maps/place/Mabel's+Mittens/@12.3073181,45.6512096,17z/data=!4m14!1m7!3m6!1s0x1111111111111111:0x2222222222222222!2sKindred+Threads+Not+For+Profit+CIC!8m2!3d12.3073181!4d45.6512096!16s%2Fg%2Ffictional_previous!3m5!1s0x3333333333333333:0x4444444444444444!8m2!3d12.3057904!4d45.651864!16s%2Fg%2Ffictional_selected?entry=ttu";
const single = 'https://www.google.co.uk/maps/place/Shop/@50,1,12z/data=!4m6!3m5!1s0x1:0x2!8m2!3d12.3!4d45.65!16s%2Fg%2Fid';
test('selected place is distinguished from previous context and panning', () => {
  const result = parseGooglePlaceUrl(selectedListing);
  assert.deepEqual(result.coordinates, [12.3057904, 45.651864]);
  assert.equal(result.placeId, '0x3333333333333333:0x4444444444444444');
  assert.deepEqual(parseGooglePlaceUrl(selectedListing.replace('@12.3073181,45.6512096,17z', '@10,20,4z')), result);
  assert.deepEqual(parseGooglePlaceUrl(single).coordinates, [12.3, 45.65]);
  assert.equal(canonicalPlaceIdentity(single), canonicalPlaceIdentity(single.replace('@50,1,12z', '@1,2,3z')));
});
test('ambiguous, unknown, malformed and camera-only coordinates require manual pin', () => {
  for (const url of [
    'https://www.google.com/maps/place/Shop/@12.3,45.65,16z',
    'https://www.google.com/maps/place/Shop/data=!3d1!4d2!3d3!4d4',
    single.replace('!4m6', '!4m999'), single.replace('!3d12.3', '!3d999'),
    'https://www.google.com/maps/search/charity+shops', 'https://google.com.evil.test/maps/place/Shop/data=!3d1!4d2',
    'https://www.google.com/maps/place/Shop/data=!8m2!3d1!4d2!8m2!3d3!4d4',
    'https://www.google.com/maps/place/Shop/data=!4m12!3m5!1sa!8m2!3d1!4d2!16sx!3m5!1sb!8m2!3d3!4d4!16sy',
    'https://www.google.com/maps/place/Shop/data=%E0%A4%A',
  ]) { assert.equal(parseGooglePlaceUrl(url).coordinates, null, url); assert.ok(parseGooglePlaceUrl(url).issue); }
  assert.deepEqual(parseGooglePlaceUrl('https://www.google.com/maps/place/Shop/data=!3d0!4d0').coordinates, [0, 0]);
  assert.deepEqual(parseGooglePlaceUrl('https://www.google.com/maps/place/Shop/data=!8m2!3d1!4d2!16sabc').coordinates, [1, 2]);
});
test('coordinate, naming and root guards cover valid zero and Windows edge cases', () => {
  assert.deepEqual(validateCoordinates([0, 0]), [0, 0]);
  assert.deepEqual(validateCoordinates(['12.3', '45.6']), [12.3, 45.6]);
  for (const value of [[null, 0], ['', 1], [true, 0], [91, 0], [0, 181], [NaN, 1], [1], [1, 2, 3]]) assert.equal(validateCoordinates(value), null);
  assert.equal(safeFileName('CON.txt'), '_CON.txt');
  assert.equal(safeFileName('Mabel\'s Mittens: River/side?'), "Mabel's Mittens River side");
  assert.equal(validateRootPath('Charity Sourcing'), 'Charity Sourcing');
  for (const path of ['', '../Maps', '/Maps', 'C:/Maps', '.obsidian', 'Places/../Maps', 'NUL', 'A//B', 'A/#B', 'A/']) assert.throws(() => validateRootPath(path));
});
test('half-star sourcing rating remains separate from Google decimals', () => {
  assert.match(formatRating(0), /Not rated/); assert.match(formatRating(3.5), /★★★½/);
  assert.equal(ratingColor(0), '#3b82f6'); assert.equal(ratingColor(1.5), '#dc2626'); assert.equal(ratingColor(2), '#d97706'); assert.equal(ratingColor(4), '#16a34a');
  assert.match(formatRating(4.3), /Not rated/);
});
const shop: PlaceRecord = { path: 'Root/Shops/Town/Shop.md', name: 'Shop', kind: 'shop', locality: 'Root/Localities/Town.md', coordinates: [12.3, 45.6], properties: {} };
const parking = (name: string, properties = {}, coordinates: PlaceRecord['coordinates'] = [12.3, 45.6]): PlaceRecord => ({ path: `Root/Parking/Town/${name}.md`, name, kind: 'parking', locality: '[[Root/Localities/Town]]', coordinates, properties });
test('parking supports shared pins, explicit preference, choices and broken targets', () => {
  const a = parking('A', { parking_for: ['[[Root/Shops/Town/Shop]]', '[[Another shop]]'] });
  const b = parking('B', { parking_for: ['[[Shop]]'] });
  assert.equal(resolveParking(shop, [shop]).status, 'shop');
  assert.equal(resolveParking(shop, [shop, a]).destination?.path, a.path);
  assert.equal(resolveParking(shop, [shop, a, b]).status, 'choice');
  assert.equal(resolveParking({ ...shop, properties: { parking_location: '[[B]]' } }, [shop, a, b]).destination?.path, b.path);
  assert.equal(resolveParking({ ...shop, properties: { parking_location: '[[Deleted]]' } }, [shop, a]).status, 'invalid');
  assert.equal(resolveParking(shop, [shop, parking('Missing pin', { parking_for: ['[[Shop]]'] }, null)]).status, 'invalid');
  const other = { ...shop, path: 'Root/Shops/Other/Shop.md' };
  assert.equal(resolveParking(shop, [shop, other, b]).choices.length, 0, 'ambiguous short links are not guessed');
});
test('locality proposals use closest saved place, radius boundary and all place kinds', () => {
  const localities = [{ path: 'Root/Localities/Town.md', name: 'Town' }, { path: 'Root/Localities/Empty.md', name: 'Empty' }].map(l => ({ ...l, parentPath: '', segments: [l.name], label: l.name }));
  const point: [number, number] = [12.309, 45.6]; const distance = haversineKm(point, shop.coordinates!);
  assert.equal(localitySuggestions(point, localities, [shop], distance).length, 1);
  assert.equal(localitySuggestions(point, localities, [shop], distance - 0.000001).length, 0);
  assert.equal(localitySuggestions(shop.coordinates, localities, [parking('A')])[0]?.locality.name, 'Town');
  assert.deepEqual(localitySuggestions(null, localities, [shop]), []);
});
test('navigation URLs use validated coordinates and saved Google links safely', () => {
  assert.match(navigationUrl([0, 0], 'driving'), /destination=0,0&travelmode=driving/);
  assert.equal(navigationUrl([], 'walking'), '');
  assert.match(googleMapsUrl({ ...shop, properties: { google_maps_url: 'javascript:alert(1)' } }), /maps\/search/);
  assert.equal(googleMapsUrl({ ...shop, properties: { google_maps_url: 'https://maps.app.goo.gl/example' } }), 'https://maps.app.goo.gl/example');
});
