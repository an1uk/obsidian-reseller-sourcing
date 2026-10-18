import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'yaml';
import { baseText, bodyForPlace, bundledAssets, placeProperties } from '../src/storage/assets';
import { readNote } from '../src/storage/markdown';

const root = 'Reseller sourcing';
test('generated hubs use source labels and leave ordinary notes at normal width without provenance markers', () => {
  const assets = bundledAssets(root, 'A vault');
  for (const [file, text] of Object.entries(assets)) {
    assert.equal(/codex-generated/i.test(text), false, file);
    assert.equal(/^# /m.test(text), false, file + ' duplicates the note title');
  }
  assert.ok(assets[root + '/System/Sources.base'].includes('All sources'));
  assert.ok(assets[root + '/Home.md'].includes('view: home'));
  assert.equal(assets[root + '/Localities.md'], undefined);
  assert.equal(root + '/Shops.md' in assets, false);
  assert.equal(readNote(assets[root + '/Home.md']).properties.cssclasses, undefined);
  for (const name of ['Source', 'Parking']) assert.equal(readNote(assets[`${root}/System/Templates/${name}.md`]).properties.cssclasses, undefined);
  assert.equal(bodyForPlace().includes('codex-generated'), false);
});
test('source type defaults distinguish charities from wholesalers and custom sources', () => {
  for (const type of ['Charity shop', 'Rag house', 'Wholesaler', 'Market', 'Other', 'Estate clearance']) {
    const props = placeProperties('shop', root + '/Localities/Exampletown/Riverside.md', type);
    assert.equal(props.source_type, type);
    assert.ok((props.tags as string[]).includes('sourcing-source'));
    assert.equal((props.tags as string[]).includes('charity-shop'), type === 'Charity shop');
    assert.equal(props.locality, '[[Reseller sourcing/Localities/Exampletown/Riverside]]');
    assert.equal(props.rating, 0); assert.equal(props.shortlist, false); assert.equal(props.last_visited, null);
  }
  assert.equal(placeProperties('parking').source_type, undefined);
  assert.equal(placeProperties('shop', '', '   ').source_type, 'Other');
});
test('source directory provides stable browse links and grouped type, area and brand views', () => {
  const source = parse(baseText(root, 'shop'));
  const names = source.views.map((v: { name: string }) => v.name);
  for (const name of ['All sources', 'Shortlist', 'By source type', 'By area', 'By brand']) assert.ok(names.includes(name));
  assert.equal(names.includes('All shops'), false);
  assert.equal(names.includes('By charity'), false);
  assert.ok(source.filters.and.some((value: string) => value.includes('/Sources') && value.includes('/Shops')));
  assert.ok(source.filters.and.some((value: string) => value.includes('sourcing-source') && value.includes('charity-shop')));
  assert.throws(() => baseText(root, undefined, root + '/Localities/Exampletown/../Samplewick.md'));
  assert.throws(() => baseText(root, undefined, 'Another vault/Localities/Exampletown.md'));
});

const harness = process.env.CLIPPER_TEST_HARNESS_DIR;
test('native Bases filters include descendant sources and parking without leaking to sibling areas', { skip: !harness }, () => {
  const noop = new Proxy(function () { return 'native error'; }, { get: (target, key) => key === 'prototype' ? target.prototype : noop });
  const context = vm.createContext({ console, URL, queueMicrotask, db: noop, window: {}, k: (a: any[], b: any[]) => a.concat(b), g: Object.assign,
    v: (derived: any, base: any) => { Object.setPrototypeOf(derived, base); derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; } });
  const source = fs.readFileSync(path.join(harness!, 'app.js'), 'utf8');
  vm.runInContext(fs.readFileSync(path.join(harness!, 'native-formula.cjs'), 'utf8'), context);
  vm.runInContext('var ' + source.slice(source.indexOf('Sl=/\\u00A0|\\u202F/g'), source.indexOf('var Hl=', source.indexOf('function xl(', 250000))) + ';engine.TagList=mK;', context);
  for (const key of ['function QC(', 'function $C(', 'function $b(', 'function zm(']) { const start = source.indexOf(key); vm.runInContext(source.slice(start, source.indexOf('function ', start + 10)), context); }
  vm.runInContext('var QT=0,$T=false;String.prototype.contains=String.prototype.includes;', context);
  const E = context.engine;
  E.FileValue.prototype.getTags = function () { return new E.TagList((this.app.metadataCache.getFileCache(this.file)?.frontmatter?.tags ?? []).map((tag: string) => '#' + tag)); };
  const fixture = (base: any, row: string, records: Record<string, Record<string, unknown>>) => {
    const files = Object.fromEntries(Object.keys(records).map(p => [p, { path: p, extension: 'md' }]));
    const app: any = { metadataCache: { resolvedLinks: {}, getFirstLinkpathDest: (p: string) => files[p] ?? files[p + '.md'] ?? null, getFileCache: (f: { path: string }) => ({ frontmatter: records[f.path] }) } };
    for (const [p, props] of Object.entries(records)) for (const key of ['parking_for', 'parking_location', '_other_links']) {
      const values = Array.isArray(props[key]) ? props[key] : [props[key]];
      for (const value of values as unknown[]) if (typeof value === 'string' && value.startsWith('[[') && value.endsWith(']]')) {
        const target = app.metadataCache.getFirstLinkpathDest(value.slice(2, -2).split('|')[0]);
        if (target) (app.metadataCache.resolvedLinks[p] ??= {})[target.path] = 1;
      }
    }
    const file = new E.FileValue(app, files[row]), formula = new E.ObjectValue({}), note = E.ObjectValue.fromFrontMatter(app, files[row], records[row]);
    const ctx = { app, keys: () => [], getByIdentifier: (key: string) => key === 'file' ? file : key === 'note' ? note : key === 'formula' ? formula : E.Null };
    const evaluate = (expression: string) => { const parsed = new E.Formula(expression); assert.ok(!(parsed.formula instanceof E.Invalid)); const value = parsed.getValue(ctx); assert.ok(!(value instanceof E.ErrorValue), value.toString()); return value; };
    formula.objectAccess = (key: string) => evaluate(base.formulas[key]);
    const match = (view?: string) => base.filters.and.every((expression: string) => evaluate(expression).isTruthy()) && (!view || (base.views.find((v: any) => v.name === view).filters?.and ?? []).every((expression: string) => evaluate(expression).isTruthy()));
    return Object.assign(match, { value: (name: string) => evaluate(base.formulas[name]) });
  };
  const matches = (base: any, row: string, tags: string[], properties: Record<string, unknown> = {}) => fixture(base, row, { [row]: { tags, ...properties } })();
  const parent = parse(baseText(root, undefined, root + '/Localities/Exampletown.md'));
  const child = parse(baseText(root, undefined, root + '/Localities/Exampletown/Riverside.md'));
  for (const suffix of ['Riverside/Source.md', 'Riverside/Station/Source.md']) {
    assert.ok(matches(parent, root + '/Sources/Exampletown/' + suffix, ['sourcing-source']));
    assert.ok(matches(child, root + '/Sources/Exampletown/' + suffix, ['sourcing-source']));
    assert.ok(matches(parent, root + '/Parking/Exampletown/' + suffix, ['parking']));
    assert.ok(matches(child, root + '/Parking/Exampletown/' + suffix, ['parking']));
  }
  assert.ok(matches(parent, root + '/Sources/Exampletown/Source.md', ['sourcing-source']));
  assert.equal(matches(child, root + '/Sources/Exampletown/Source.md', ['sourcing-source']), false);
  assert.equal(matches(child, root + '/Sources/Exampletown/Orchard/Source.md', ['sourcing-source']), false);
  assert.equal(matches(parent, root + '/Sources/Exampletown2/Source.md', ['sourcing-source']), false);
  assert.equal(matches(parent, root + '/Sources/Exampletown/Source.md', ['sourcing-source', 'map-demo']), false);
  const directory = parse(baseText(root, 'shop'));
  for (const base of [directory, parent, child, parse(baseText(root, 'parking'))]) for (const [name, expression] of Object.entries(base.formulas)) {
    assert.ok(!(new E.Formula(expression).formula instanceof E.Invalid), name + ' must parse in native Bases');
  }
  const areaRow = root + '/Sources/Exampletown/Riverside/Source.md';
  const areaPath = root + '/Localities/Exampletown/Riverside.md';
  const otherAreaPath = root + '/Localities/Otherford/Riverside.md';
  const areaRecords = { [areaRow]: { tags: ['sourcing-source'], locality: '[[' + areaPath + ']]' }, [areaPath]: {}, [otherAreaPath]: {} };
  const areaValue = fixture(directory, areaRow, areaRecords).value('area');
  assert.equal(areaValue.display.toString(), 'Exampletown → Riverside');
  assert.equal(areaValue.data, areaPath);
  areaRecords[areaRow].locality = '[[' + otherAreaPath + ']]';
  const otherAreaValue = fixture(directory, areaRow, areaRecords).value('area');
  assert.equal(otherAreaValue.display.toString(), 'Otherford → Riverside');
  assert.notEqual(otherAreaValue.data, areaValue.data);
  assert.equal(fixture(directory, areaRow, { [areaRow]: { tags: ['sourcing-source'] } }).value('area').toString(), 'Unassigned');
  assert.equal(directory.views.find((view: any) => view.name === 'By area').groupBy.property, 'formula.area');
  assert.ok(directory.views.find((view: any) => view.name === 'All sources').order.includes('formula.area'));
  assert.ok(matches(directory, root + '/Sources/Exampletown/Rag house.md', ['sourcing-source'], { source_type: 'Rag house' }));
  assert.ok(matches(directory, root + '/Shops/Exampletown/Legacy.md', ['charity-shop']));
  assert.equal(matches(directory, root + '/Parking/Exampletown/Parking.md', ['parking']), false);
  const selected = root + '/Sources/Exampletown/Riverside/Source.md', outside = root + '/Sources/Samplewick/Source.md', carPark = root + '/Parking/Elsewhere/Station.md';
  const records: Record<string, Record<string, unknown>> = {
    [selected]: { tags: ['sourcing-source'], shortlist: true },
    [outside]: { tags: ['sourcing-source'], shortlist: true },
    [carPark]: { tags: ['parking'], parking_for: ['[[' + selected + ']]'] },
  };
  assert.ok(fixture(child, selected, records)('Locality shortlist map'));
  assert.ok(fixture(child, carPark, records)('Locality shortlist map'));
  assert.ok(fixture(parent, carPark, records)('Locality shortlist'));
  records[selected].shortlist = false;
  records[carPark].parking_for = ['[[' + selected + ']]', '[[' + outside + ']]'];
  assert.equal(fixture(child, carPark, records)('Locality shortlist map'), false);
  assert.ok(fixture(child, carPark, records)('Locality map'));
  records[selected].shortlist = true;
  records[carPark].parking_for = [];
  records[selected].parking_location = '[[' + carPark + ']]';
  assert.ok(fixture(child, carPark, records)('Locality shortlist map'));
  records[selected].shop_closed = true;
  assert.equal(fixture(child, carPark, records)('Locality shortlist map'), false);
  assert.equal(fixture(child, selected, records)('Locality shortlist map'), false);
});

test('generated guide explains reviewed town and locality defaults and manual Clipper updates', () => {
  const guide = bundledAssets(root)[root + '/System/Guide.md'];
  for (const phrase of ['Source v0.4.2', 'Parking v0.4.2', 'optional locality', 'Choose where to go', 'Close keeps the draft', 'Clipper imports remain manual']) assert.ok(guide.includes(phrase), phrase);
  assert.equal(guide.includes('Exampletown'), false);
  assert.equal(guide.includes('Riverside'), false);
  assert.equal(guide.includes('default town'), false);
  assert.equal(guide.includes('default locality'), false);
  assert.equal(guide.includes('codex-generated'), false);
});
