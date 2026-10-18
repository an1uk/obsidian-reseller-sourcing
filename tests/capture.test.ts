import test from 'node:test';
import assert from 'node:assert/strict';
import { addressParts, CAPTURE_SELECTORS, CAPTURE_TEMPLATE_VERSION, CLIPPER_TEMPLATE_RELEASE, createClipperTemplates, extractBrandTag, parseCapture, parseGoogleRating, parseGoogleReviewCount } from '../src/capture';
const url = "https://www.google.com/maps/place/Mabel's+Mittens/data=!4m14!1m7!3m6!1s0xa:0xb!2sKindred+Threads!8m2!3d12.3073181!4d45.6512096!16sa!3m5!1s0xc:0xd!8m2!3d12.3057904!4d45.651864!16sb";
test('capture parsing derives selected coordinates without assigning locality or visit', () => {
  const draft = parseCapture({ sourcing_capture: 1, template_version: 1, capture_kind: 'shop', google_name: "Mabel's Mittens", address: '50-51 Riverside Shopping Centre, Station Rd, Exampletown AB1 2CD', google_maps_url: url, google_rating_raw: '4.1', google_review_count_raw: '(10)', captured_at: '2026-10-14T10:00:00+01:00', google_review_topics_raw: ['helpful staff, mentioned in 4 reviews', 'unknown format'], google_hours_raw: [] }, 'Root/Capture inbox/Mabel Mittens.md');
  assert.deepEqual(draft.coordinates, [12.3057904, 45.651864]); assert.equal(draft.postcode, 'AB1 2CD'); assert.equal(draft.street, 'Station Rd'); assert.equal(draft.googleRating, 4.1); assert.equal(draft.googleReviewCount, 10); assert.deepEqual(draft.topics, ['helpful staff (4)']);
  assert.equal(draft.captureId, 'Root/Capture inbox/Mabel Mittens.md'); assert.equal('locality' in draft, false); assert.equal('last_visited' in draft, false);
});
test('missing values stay blank; only complete current weekly hours survive', () => {
  const base = { sourcing_capture: 1, template_version: 1, capture_kind: 'parking' };
  const draft = parseCapture(base); assert.equal(draft.coordinates, null); assert.equal(draft.googleRating, null); assert.equal(draft.googleReviewCount, null); assert.equal(draft.name, ''); assert.deepEqual(draft.hours, []);
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `${day}, Closed`);
  assert.deepEqual(parseCapture({ ...base, google_hours_raw: days }).hours, days);
  assert.deepEqual(parseCapture({ ...base, google_hours_raw: [...days.slice(0, 6), days[0]] }).hours, []);
  assert.throws(() => parseCapture({ ...base, template_version: 0 }), /outdated/);
  assert.throws(() => parseCapture({ ...base, sourcing_capture: 99 }), /Unsupported/);
});
test('public scores, names and postal metadata are conservative', () => {
  assert.equal(parseGoogleRating('4.3'), 4.3); assert.equal(parseGoogleRating(''), null); assert.equal(parseGoogleRating('5.5'), null);
  assert.equal(parseGoogleReviewCount('(1,234)'), 1234); assert.equal(parseGoogleReviewCount('No reviews'), null); assert.equal(parseGoogleReviewCount('1.2k'), null);
  assert.equal(extractBrandTag('Second Sunrise Orchard Exampletown', '2 Lantern Rd, Orchard, Exampletown AB1 4GH'), 'second-sunrise');
  assert.equal(extractBrandTag('Kindred Threads Not For Profit CIC', '18 Road, Exampletown AB1 1AA', 'Riverside'), 'kindred-threads-not-for-profit-cic');
  assert.equal(addressParts('No postal address').postcode, '');
});
test('capture templates stay small, new-note-only and scoped to selected panel', () => {
  const templates = createClipperTemplates('Charity Sourcing', 'Test vault');
  for (const t of Object.values(templates)) {
    assert.equal(t.behavior, 'create'); assert.equal(t.path, 'Charity Sourcing/Capture inbox'); assert.equal(t.vault, 'Test vault');
    assert.ok(Buffer.byteLength(JSON.stringify(t)) < 7000); assert.ok(t.noteContentFormat.includes(CAPTURE_SELECTORS.name));
    assert.equal(t.noteContentFormat.includes('safe_name:"windows"'), false); assert.equal(t.noteContentFormat.includes('fullHtml'), false); assert.equal(t.noteContentFormat.includes('review_text'), false); assert.equal(t.noteContentFormat.includes('codex-generated'), false);
    assert.ok(t.noteContentFormat.includes('google_hours_raw:')); assert.ok(t.noteContentFormat.includes('google_review_topics_raw:'));
  }
  assert.throws(() => createClipperTemplates('../Old maps'));
});

// These listings, coordinates, addresses and contacts are synthetic regression fixtures.

test('source captures accept legacy v1 and neutral v2 with editable custom types', () => {
  const base = { sourcing_capture: 1, capture_kind: 'shop', google_name: 'Wholesale clothing', google_maps_url: url };
  assert.equal(parseCapture({ ...base, template_version: 1 }).sourceType, 'Charity shop');
  assert.equal(parseCapture({ ...base, template_version: 2 }).sourceType, undefined);
  assert.equal(parseCapture({ ...base, template_version: 2, clipper_template_release: '0.4.2' }).sourceType, undefined);
  assert.equal(parseCapture({ ...base, template_version: 2, clipper_template_release: 'future-release' }).sourceType, undefined);
  assert.equal(parseCapture({ ...base, template_version: 2, source_type: '   ' }).sourceType, undefined);
  assert.equal(parseCapture({ ...base, template_version: 1, source_type: 'Other' }).sourceType, 'Other');
  for (const sourceType of ['Charity shop', 'Rag house', 'Wholesaler', 'Market', 'Other', 'Estate clearance']) {
    const draft = parseCapture({ ...base, template_version: 2, source_type: sourceType });
    assert.equal(draft.sourceType, sourceType); assert.equal(draft.kind, 'shop');
    assert.equal('rating' in draft, false); assert.equal('shortlist' in draft, false);
  }
  assert.equal(parseCapture({ ...base, template_version: 2, capture_kind: 'parking', source_type: 'Wholesaler' }).sourceType, undefined);
  assert.throws(() => parseCapture({ ...base, template_version: 99 }), /unsupported or outdated/);
});
test('browser templates show a separate release number without changing compatible capture kinds', () => {
  const templates = createClipperTemplates('Reseller sourcing', 'Vault');
  assert.equal(templates.shop.name, `Source v${CLIPPER_TEMPLATE_RELEASE} — Google Maps`);
  assert.equal(templates.parking.name, `Parking v${CLIPPER_TEMPLATE_RELEASE} — Google Maps`);
  assert.equal(CAPTURE_TEMPLATE_VERSION, 2);
  for (const template of Object.values(templates)) {
    assert.ok(template.noteContentFormat.includes(`clipper_template_release: '${CLIPPER_TEMPLATE_RELEASE}'`));
    assert.ok(template.noteContentFormat.includes('template_version: 2'));
  }
  assert.ok(templates.shop.noteNameFormat.includes('Source capture'));
  assert.ok(templates.shop.noteContentFormat.includes('capture_kind: shop'));
  assert.ok(templates.shop.noteContentFormat.includes("source_type: ''"));
  assert.equal(templates.parking.noteContentFormat.includes('source_type:'), false);
  assert.equal(templates.shop.path, 'Reseller sourcing/Capture inbox');
});

test('optional contacts preserve text and remain independent of Google assessment or listing URL', () => {
  const base = { sourcing_capture: 1, template_version: 2, capture_kind: 'shop', google_name: 'Fixture source' };
  const properties = { ...base, website: 'https://www.example.org/contact?branch=one', telephone: '+44 (0)1632 960101' };
  const before = structuredClone(properties), draft = parseCapture(properties);
  assert.equal(draft.website, properties.website); assert.equal(draft.telephone, properties.telephone);
  assert.equal(draft.googleRating, null); assert.equal(draft.url, ''); assert.deepEqual(properties, before);
  assert.equal(parseCapture({ ...base, telephone: '01632 960101' }).telephone, '01632 960101');
  assert.equal(parseCapture({ ...base, telephone: 1632960101 }).telephone, undefined);
  for (const version of [1, 2]) {
    const missing = parseCapture({ ...base, template_version: version });
    assert.equal(missing.website, undefined); assert.equal(missing.telephone, undefined);
  }
  for (const website of ['javascript:alert(1)', 'data:text/html,hello', 'mailto:test@example.org', 'not a web address']) assert.equal(parseCapture({ ...base, website }).website, undefined, website);
  assert.equal(parseCapture({ ...base, website: 'http://www.example.org/' }).website, 'http://www.example.org/');
  assert.equal(parseCapture({ ...base, website: 'example.org' }).website, 'https://example.org/');
  assert.equal(parseCapture({ ...base, capture_kind: 'parking', telephone: '01632 960101' }).telephone, '01632 960101');
});
test('contact selectors target only selected-place authority and telephone controls', () => {
  assert.equal(CAPTURE_SELECTORS.website, '[role="main"][aria-label] a[data-item-id="authority"]?href');
  assert.equal(CAPTURE_SELECTORS.telephone, '[role="main"][aria-label] button[data-item-id^="phone:tel:"] .Io6YTe');
  for (const template of Object.values(createClipperTemplates('Reseller sourcing'))) {
    assert.ok(template.noteContentFormat.includes('website:'));
    assert.ok(template.noteContentFormat.includes('telephone:'));
    assert.ok(template.noteContentFormat.includes('template_version: 2'));
    assert.equal(template.noteContentFormat.includes('reviewer'), false);
  }
});
