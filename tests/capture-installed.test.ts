// Optional integration with the locally installed Web Clipper 1.7.1 compiler and
// importer. The harness runs copied pure routines in a VM; it never opens or edits
// the browser profile. Portable builds run the pure tests without this harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import YAML from 'yaml';
import { CAPTURE_SELECTORS, CAPTURE_TEMPLATE_VERSION, CLIPPER_TEMPLATE_RELEASE, createClipperTemplates, parseCapture } from '../src/capture';

// These listings, coordinates, addresses and contacts are synthetic regression fixtures.

const harnessDir = process.env.CLIPPER_TEST_HARNESS_DIR;
test('installed Clipper import, quota, selected panel extraction and YAML escaping', { skip: !harnessDir }, async () => {
  const require = createRequire(import.meta.url);
  const engine = require(path.join(harnessDir!, 'check-installed-renderer.cjs'));
  const importer = require(path.join(harnessDir!, 'check-installed-import.cjs'));
  const out = path.resolve('.runtime-tests/capture'); fs.mkdirSync(out, { recursive: true });
  const weeklyHours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `${day}, 9 am–5 pm`);
  const fields = {
    [CAPTURE_SELECTORS.name]: ["Mabel's Mittens: 'Shop'\nNew line"],
    [CAPTURE_SELECTORS.address]: ['50-51 Riverside Shopping Centre, Station Rd, Exampletown AB1 2CD'],
    [CAPTURE_SELECTORS.website]: ['https://mabels-mittens.example/'], [CAPTURE_SELECTORS.telephone]: ['01632 960101'],
    [CAPTURE_SELECTORS.rating]: ['4.1'], [CAPTURE_SELECTORS.reviews]: ['(10)'],
    [CAPTURE_SELECTORS.hoursTable]: ['table'], [CAPTURE_SELECTORS.hours]: weeklyHours,
    [CAPTURE_SELECTORS.topicsGroup]: ['group'], [CAPTURE_SELECTORS.topics]: ['helpful staff, mentioned in 4 reviews', "children's clothing, mentioned in 1 review"],
  };
  const url = "https://www.google.com/maps/place/Mabel's+Mittens/@12.3073181,45.6512096,17z/data=!4m14!1m7!3m6!1s0xa:0xb!2sKindred+Threads!8m2!3d12.3073181!4d45.6512096!16sa!3m5!1s0xc:0xd!8m2!3d12.3057904!4d45.651864!16sb";
  const reports = [];
  for (const [kind, template] of Object.entries(createClipperTemplates('Charity Sourcing', 'Test vault'))) {
    const templatePath = path.join(out, `${kind}.json`); fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
    const imported = await importer.inspect(templatePath);
    assert.equal(imported.importError, null); for (const warnings of Object.values(imported.validation)) assert.deepEqual(warnings, []);
    assert.ok(imported.storage[0].bytes < 8000); reports.push(imported);
    for (const [label, selected, pageUrl] of [
      ['normal', fields, url],
      ['no reviews', { ...fields, [CAPTURE_SELECTORS.rating]: [], [CAPTURE_SELECTORS.reviews]: [] }, url],
      ['missing contacts', { ...fields, [CAPTURE_SELECTORS.website]: [], [CAPTURE_SELECTORS.telephone]: [] }, url],
      ['ambiguous contacts', { ...fields, [CAPTURE_SELECTORS.website]: ['https://one.example/', 'https://two.example/'], [CAPTURE_SELECTORS.telephone]: ['01632 960111', '01632 960222'] }, url],
      ['unsafe website', { ...fields, [CAPTURE_SELECTORS.website]: ['javascript:alert(1)'], [CAPTURE_SELECTORS.telephone]: ['+44 (0)1632 960101'] }, url],
      ['missing address', { ...fields, [CAPTURE_SELECTORS.address]: [] }, url],
      ['multiple addresses', { ...fields, [CAPTURE_SELECTORS.address]: ['A', 'B'] }, url],
      ['multiple names', { ...fields, [CAPTURE_SELECTORS.name]: ['A', 'B'] }, url],
      ['wrong page', fields, 'https://www.google.com/maps/search/charity'],
      ['missing fields', {}, url],
    ] as const) {
      const rendered = await engine.compile(template.noteContentFormat, {}, selected, pageUrl);
      assert.deepEqual(rendered.errors, [], `${kind}: ${label}`);
      if (['multiple names', 'wrong page', 'missing fields'].includes(label)) { assert.equal(rendered.output.startsWith('---'), false); continue; }
      assert.ok(rendered.output.startsWith('---\n'), `${kind}: ${label}: ${rendered.output}`);
      const fm = YAML.parse(rendered.output.match(/^---\n([\s\S]*?)\n---/)[1]);
      assert.equal(fm.clipper_template_release, CLIPPER_TEMPLATE_RELEASE);
      assert.equal(fm.template_version, CAPTURE_TEMPLATE_VERSION);
      const draft = parseCapture(fm);
      assert.equal(draft.name, "Mabel's Mittens: 'Shop' New line"); assert.deepEqual(draft.coordinates, [12.3057904, 45.651864]);
      assert.deepEqual(draft.hours, weeklyHours); assert.deepEqual(draft.topics, ['helpful staff (4)', "children's clothing (1)"]);
      if (label === 'missing contacts' || label === 'ambiguous contacts') { assert.equal(fm.website, ''); assert.equal(fm.telephone, ''); assert.equal(draft.website, undefined); assert.equal(draft.telephone, undefined); }
      else if (label === 'unsafe website') { assert.equal(fm.website, 'javascript:alert(1)'); assert.equal(draft.website, undefined); assert.equal(draft.telephone, '+44 (0)1632 960101'); }
      else { assert.equal(draft.website, 'https://mabels-mittens.example/'); assert.equal(draft.telephone, '01632 960101'); }
      if (label === 'no reviews') { assert.equal(draft.googleRating, null); assert.equal(draft.googleReviewCount, null); }
      if (label.includes('address')) assert.equal(draft.address, '');
      const filename = await engine.compile(template.noteNameFormat, {}, selected, pageUrl);
      assert.deepEqual(filename.errors, []); assert.equal(filename.output.includes(':'), false); assert.equal(filename.output.includes('\n'), false);
    }
  }
  fs.writeFileSync(path.join(out, 'installed-import-report.json'), JSON.stringify(reports, null, 2));
});


test('selected listing contacts exclude neighbouring results and reviewer text', { skip: !harnessDir }, async () => {
  const require = createRequire(import.meta.url);
  const engine = require(path.join(harnessDir!, 'check-installed-renderer.cjs'));
  const { parseHTML } = require(path.join(harnessDir!, 'node_modules/linkedom'));
  const { document } = parseHTML(`<html><body>
    <div role="main"><h1>Results</h1><a data-item-id="authority" href="https://neighbour.example/">Neighbour</a><button data-item-id="phone:tel:01632960999"><div class="Io6YTe">01632 960999</div></button></div>
    <div role="main" aria-label="Mabel's Mittens"><h1>Mabel's Mittens</h1>
      <a data-item-id="authority" href="https://mabels-mittens.example/">Website</a>
      <button data-item-id="phone:tel:01632960101"><div class="Io6YTe">01632 960101</div></button>
      <div class="review"><a href="https://reviewer.example/">Reviewer link</a><span class="Io6YTe">Reviewer telephone 01632 960456</span></div>
    </div></body></html>`);
  // The extension's selector transport returns raw attribute/text arrays. This
  // fixture exercises the exact CSS selectors before its installed compiler.
  const fields: Record<string, string[]> = {};
  for (const expression of Object.values(CAPTURE_SELECTORS)) {
    const split = expression.lastIndexOf('?'), selector = split < 0 ? expression : expression.slice(0, split), attribute = split < 0 ? '' : expression.slice(split + 1);
    fields[expression] = [...document.querySelectorAll(selector)].map((element: any) => attribute ? element.getAttribute(attribute) || '' : element.textContent?.trim() || '');
  }
  assert.deepEqual(fields[CAPTURE_SELECTORS.website], ['https://mabels-mittens.example/']);
  assert.deepEqual(fields[CAPTURE_SELECTORS.telephone], ['01632 960101']);
  const template = createClipperTemplates('Reseller sourcing').shop;
  const rendered = await engine.compile(template.noteContentFormat, {}, fields, 'https://www.google.com/maps/place/Mabel+Mittens/data=!3d12.3057904!4d45.651864');
  assert.deepEqual(rendered.errors, []);
  const properties = YAML.parse(rendered.output.match(/^---\n([\s\S]*?)\n---/)[1]);
  const draft = parseCapture(properties);
  assert.equal(draft.website, 'https://mabels-mittens.example/'); assert.equal(draft.telephone, '01632 960101');
  assert.equal(draft.googleRating, null); assert.equal(draft.googleReviewCount, null);
});
