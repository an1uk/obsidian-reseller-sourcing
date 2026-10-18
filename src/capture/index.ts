import type { CaptureDraft, PlaceKind } from '../types';
import { parseGooglePlaceUrl, validateRootPath } from '../domain';
import { websiteUrl } from '../domain/contacts';
export { getAddressHints, matchAreaHints, normalizeAreaPhrase } from '../domain/area-hints';
export type { AddressHints } from '../domain/area-hints';

// Browser template release: bump when generated Clipper JSON changes. This is
// independent of the capture format version, which preserves queued captures.
export const CLIPPER_TEMPLATE_RELEASE = '0.4.2';
export const CAPTURE_TEMPLATE_VERSION = 2;
export const CAPTURE_SCHEMA_VERSION = 1;
export interface ClipperTemplate {
  schemaVersion: '0.1.0'; name: string; behavior: 'create'; noteNameFormat: string;
  path: string; vault: string; noteContentFormat: string; properties: never[]; triggers: string[];
}
export const CAPTURE_SELECTORS = {
  name: '[role="main"][aria-label] h1',
  address: '[role="main"][aria-label] [data-item-id="address"] .Io6YTe',
  website: '[role="main"][aria-label] a[data-item-id="authority"]?href',
  telephone: '[role="main"][aria-label] button[data-item-id^="phone:tel:"] .Io6YTe',
  rating: '[role="main"][aria-label] .F7nice > span:first-child > span[aria-hidden="true"]',
  reviews: '[role="main"][aria-label] .F7nice > span:last-child [role="img"]',
  hoursTable: '[role="main"][aria-label] .OqCZI table.eK4R0e',
  hours: '[role="main"][aria-label] .OqCZI table.eK4R0e button[data-value][jsaction*="pane.openhours."][jsaction*=".copy"]?data-value',
  topicsGroup: '[role="main"][aria-label] [role="radiogroup"][aria-label="Refine reviews"]',
  topics: '[role="main"][aria-label] [role="radiogroup"][aria-label="Refine reviews"] button[role="radio"][aria-label*="mentioned in "]?aria-label',
};
const yamlValue = (expression: string) => `'{{${expression}|replace:"'":"''"|replace:"/[\\\\r\\\\n\\\\u2028\\\\u2029]/g":" "}}'`;
const yamlArray = (property: string, expression: string, group: string) => `{%if ${group}.length == 1 and ${expression}.length > 0%}{%if ${expression}.length == 1%}${property}:\n- ${yamlValue(`${expression}[0]`)}{%else%}${property}:\n- '{{${expression}|join:"␞"|replace:"'":"''"|replace:"/[\\\\r\\\\n\\\\u2028\\\\u2029]/g":" "|replace:"␞":"'\n- '"}}'{%endif%}{%else%}${property}: []{%endif%}\n`;
const select = (variable: string, selector: string) => `{%set ${variable}=selector:${selector}%}`;
const rawField = (property: string, variable: string, selector: string) => `${select(variable, selector)}${property}: {%if ${variable}.length == 1%}${yamlValue(`${variable}[0]`)}{%else%}''{%endif%}\n`;

export function createClipperTemplates(root: string, vault = ''): { shop: ClipperTemplate; parking: ClipperTemplate } {
  const path = `${validateRootPath(root)}/Capture inbox`;
  function create(kind: PlaceKind): ClipperTemplate {
    const guard = select('n', CAPTURE_SELECTORS.name) + String.raw`{%set u=url|replace:"/^https?://(?:www[.])?google[.](?:com|co[.]uk)/maps/place/[^ ]+$/":""%}{%set ok=url and u == "" and n.length == 1%}`;
    const body = `${guard}{%if ok%}---\nsourcing_capture: 1\ncapture_kind: ${kind}\n${kind === 'shop' ? "source_type: ''\n" : ''}template_version: ${CAPTURE_TEMPLATE_VERSION}\nclipper_template_release: '${CLIPPER_TEMPLATE_RELEASE}'\ncaptured_at: '{{date|date:"YYYY-MM-DDTHH:mm:ssZ"}}'\ngoogle_name: ${yamlValue('n[0]')}\ngoogle_maps_url: ${yamlValue('url')}\n` +
      rawField('address', 'a', CAPTURE_SELECTORS.address) +
      rawField('website', 'w', CAPTURE_SELECTORS.website) +
      rawField('telephone', 'p', CAPTURE_SELECTORS.telephone) +
      rawField('google_rating_raw', 'r', CAPTURE_SELECTORS.rating) +
      rawField('google_review_count_raw', 'c', CAPTURE_SELECTORS.reviews) +
      `${select('ht', CAPTURE_SELECTORS.hoursTable)}${select('h', CAPTURE_SELECTORS.hours)}${yamlArray('google_hours_raw', 'h', 'ht')}` +
      `${select('tg', CAPTURE_SELECTORS.topicsGroup)}${select('t', CAPTURE_SELECTORS.topics)}${yamlArray('google_review_topics_raw', 't', 'tg')}` +
      `---\nOpen this capture in Obsidian to review its location and save it.\n{%else%}# Open one Google Maps place listing\n\nWait for the selected place's details and reopen Web Clipper. Do not save this instruction preview.\n{%endif%}`;
    return {
      schemaVersion: '0.1.0', name: `${kind === 'shop' ? 'Source' : 'Parking'} v${CLIPPER_TEMPLATE_RELEASE} — Google Maps`, behavior: 'create',
      noteNameFormat: `${guard}{%if ok%}${kind === 'shop' ? 'Source' : 'Parking'} capture - {{date|date:"YYYYMMDD-HHmmss-SSS"}} - {{n[0]|safe_name}}{%else%}Open one Google Maps listing{%endif%}`,
      path, vault, noteContentFormat: body, properties: [],
      triggers: [String.raw`/^https?:\/\/(?:www\.)?google\.(?:com|co\.uk)\/maps\/place\//`],
    };
  }
  return { shop: create('shop'), parking: create('parking') };
}

const clean = (value: unknown): string => typeof value === 'string' ? value.replace(/[\r\n\u2028\u2029]/g, ' ').trim() : '';
const strings = (value: unknown): string[] => (Array.isArray(value) ? value : []).filter((v): v is string => typeof v === 'string').map(clean).filter(Boolean);
export function parseGoogleRating(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : clean(value);
  return /^(?:[1-4](?:\.\d+)?|5(?:\.0+)?)$/.test(text) ? Number(text) : null;
}
export function parseGoogleReviewCount(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : clean(value).replace(/^\(|\)$/g, '').replace(/[ ,\u00a0\u202f]/g, '');
  const number = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(number) ? number : null;
}
export function addressParts(address: string): { street: string; postcode: string; postalTown: string } {
  const parts = address.replace(/,\s*(UK|United Kingdom|England|Scotland|Wales|Northern Ireland)$/i, '').split(',').map(s => s.trim()).filter(Boolean);
  const last = parts.at(-1) ?? '';
  const postcode = last.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i)?.[0].toUpperCase().replace(/\s*(\d[A-Z]{2})$/, ' $1') ?? '';
  const postalTown = postcode ? last.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, '').trim() : '';
  const road = /\b(street|st|road|rd|lane|ln|avenue|ave|drive|dr|way|close|crescent|cres|terrace|place|pl|square|sq|hill|walk|row|grove|gardens|gdns|court|ct|parade|oval|mews|rise|gate|gates|bank|brae|view|green|park|passage|yard|quay|embankment)\.?$/i;
  const street = parts.slice(0, -1).find(p => road.test(p)) ?? (parts.length > 1 ? parts[0]! : '');
  return { street, postcode, postalTown };
}
export function extractBrandTag(name: string, address: string, locality = ''): string {
  const { postalTown } = addressParts(address);
  const slug = (v: string) => v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let brand = slug(name);
  const areas = [postalTown, locality, ...address.split(',').slice(1, -1)].map(slug).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const area of areas) brand = brand.replace(new RegExp(`(?:^|-)${area}(?=-|$)`, 'g'), '').replace(/^-+|-+$/g, '');
  return brand;
}
export function parseCapture(properties: Record<string, unknown>, sourcePath = ''): CaptureDraft {
  if (properties.sourcing_capture !== CAPTURE_SCHEMA_VERSION) throw Error('Unsupported capture format. Import the current capture template.');
  if (properties.template_version !== 1 && properties.template_version !== CAPTURE_TEMPLATE_VERSION) throw Error('This capture uses an unsupported or outdated template. Import the current template, then capture the place again.');
  if (properties.capture_kind !== 'shop' && properties.capture_kind !== 'parking') throw Error('Capture must identify a source or parking record.');
  const name = clean(properties.google_name), address = clean(properties.address), url = clean(properties.google_maps_url);
  const parsed = parseGooglePlaceUrl(url);
  const rawHours = strings(properties.google_hours_raw);
  const weekdays = rawHours.map(row => row.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), .+$/)?.[1]);
  const hours = rawHours.length === 7 && weekdays.every(Boolean) && new Set(weekdays).size === 7 ? rawHours : [];
  const topics = strings(properties.google_review_topics_raw).flatMap(row => {
    const match = /^(.+), mentioned in (\d+|\d{1,3}(?:,\d{3})+) reviews?$/.exec(row);
    return match ? [`${match[1]} (${match[2]})`] : [];
  });
  const parts = addressParts(address);
  return {
    captureId: clean(properties.capture_id) || sourcePath,
    sourcePath: sourcePath || undefined, kind: properties.capture_kind, name, address, url,
    website: websiteUrl(properties.website) || undefined, telephone: clean(properties.telephone) || undefined,
    ...(properties.capture_kind === 'shop' ? { sourceType: clean(properties.source_type) || (properties.template_version === 1 ? 'Charity shop' : undefined) } : {}),
    coordinates: parsed.coordinates, coordinateIssue: parsed.issue,
    googleRating: parseGoogleRating(properties.google_rating_raw), googleReviewCount: parseGoogleReviewCount(properties.google_review_count_raw),
    topics, hours, capturedAt: clean(properties.captured_at), street: parts.street, postcode: parts.postcode, brandTag: extractBrandTag(name, address),
  };
}
