import type { Coordinates } from '../types';

export function validateCoordinates(value: unknown): Coordinates | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const numbers = value.map(v => typeof v === 'number' ? v : typeof v === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v.trim()) ? Number(v) : NaN);
  return numbers.every(Number.isFinite) && Math.abs(numbers[0]) <= 90 && Math.abs(numbers[1]) <= 180 ? [numbers[0], numbers[1]] : null;
}

interface Token { field: number; type: string; value: string; children: Token[] }
export interface GooglePlaceResult { coordinates: Coordinates | null; issue?: string; placeId?: string; canonicalUrl: string }
const issue = (reason: string, canonicalUrl = ''): GooglePlaceResult => ({ coordinates: null, issue: reason, canonicalUrl });
export function isGoogleMapsUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === 'https:' && /^(?:www\.)?google\.(?:com|co\.uk)$/.test(u.hostname) && /^\/maps(?:\/|$)/.test(u.pathname); } catch { return false; }
}

// In Maps' URL wire format, m counts the following wire tokens, including nested
// message headers. Treating it as a sibling count selects stale previous places.
function tree(wire: string): Token[] | null {
  const parts = wire.split('!');
  if (parts.shift() !== '' || parts.length > 2000 || !parts.length) return null;
  const raw = parts.map(part => /^(\d+)([a-z])(.*)$/.exec(part));
  if (raw.some(part => !part)) return null;
  let cursor = 0;
  function read(end: number): Token[] {
    const output: Token[] = [];
    while (cursor < end) {
      const token = raw[cursor++]!;
      const node: Token = { field: Number(token[1]), type: token[2], value: token[3], children: [] };
      if (node.type === 'm') {
        if (!/^\d+$/.test(node.value)) throw Error('Bad message length');
        const limit = cursor + Number(node.value);
        if (limit > end) throw Error('Truncated message');
        node.children = read(limit);
      }
      output.push(node);
    }
    return output;
  }
  try { return read(raw.length); } catch { return null; }
}

function exactPair(nodes: Token[]): Coordinates | null {
  if (nodes.length !== 2 || nodes[0]?.field !== 3 || nodes[0]?.type !== 'd' || nodes[1]?.field !== 4 || nodes[1]?.type !== 'd') return null;
  return validateCoordinates(nodes.map(t => t.value));
}

export function parseGooglePlaceUrl(value: string): GooglePlaceResult {
  if (!isGoogleMapsUrl(value)) return issue('Open a full Google Maps place listing, or place the pin manually.');
  const u = new URL(value);
  if (!/^\/maps\/place\//.test(u.pathname)) return issue('This is not an individual place listing. Place the pin manually.', u.href);
  let wire: string;
  try { wire = decodeURIComponent(u.pathname.match(/\/data=(.+)$/)?.[1] ?? u.searchParams.get('data') ?? ''); } catch { return issue('The listing URL is malformed. Place the pin manually.', u.href); }
  const clean = new URL(u.href); clean.search = ''; clean.hash = '';
  // @ is the camera position, never a destination.
  clean.pathname = clean.pathname.replace(/\/@[^/]+(?=\/|$)/, '');
  const canonicalUrl = clean.href;
  if (!wire) return issue('No place coordinates are present in this URL. Place the pin manually.', canonicalUrl);
  const roots = tree(wire);
  if (!roots) return issue('Unrecognised Google coordinate structure. Place the pin manually.', canonicalUrl);
  const envelopes = roots.filter(t => t.field === 4 && t.type === 'm');
  // Only direct field-3 children of the place envelope identify the selected
  // place. Previous/search context lives beneath field 1 and is ignored.
  const selected = envelopes.length === 1 ? envelopes[0].children.filter(t => t.field === 3 && t.type === 'm') : [];
  if (selected.length === 1) {
    const node = selected[0];
    const identities = node.children.filter(t => t.field === 1 && t.type === 's' && t.value);
    const locations = node.children.filter(t => t.field === 8 && t.type === 'm');
    const coordinates = locations.length === 1 ? exactPair(locations[0].children) : null;
    const placeId = identities.length === 1 ? identities[0].value : undefined;
    if (placeId && coordinates) return { coordinates, placeId, canonicalUrl };
    // A selected identity is independent of its pin; ambiguous coordinates still require manual placement.
    return { ...issue('The selected place has ambiguous or invalid coordinates. Place the pin manually.', canonicalUrl), ...(placeId ? { placeId } : {}) };
  }
  // Older minimal place links can contain just one bare 3d/4d pair.
  const minimal = exactPair(roots);
  if (minimal) return { coordinates: minimal, canonicalUrl };
  const minimalMessages = roots.filter(t => t.field === 8 && t.type === 'm');
  if (minimalMessages.length === 1 && roots.every(t => (t.field === 8 && t.type === 'm') || (t.field === 16 && (t.type === 's' || t.type === 'z')))) {
    const coordinates = exactPair(minimalMessages[0].children);
    if (coordinates) return { coordinates, canonicalUrl };
  }
  return issue('The destination cannot be distinguished safely from other places in this URL. Place the pin manually.', canonicalUrl);
}

function identityForParsedUrl(url: string, parsed: GooglePlaceResult, selectedIdentity = true): string | null {
  if (selectedIdentity && parsed.placeId) return `google:${parsed.placeId.toLowerCase()}`;
  if (!isGoogleMapsUrl(url)) return null;
  const u = new URL(url);
  const id = u.searchParams.get('query_place_id') || u.searchParams.get('place_id');
  if (id && /^[A-Za-z0-9_-]+$/.test(id)) return `google:${id}`;
  const cid = u.searchParams.get('cid');
  if (cid && /^\d+$/.test(cid)) return `google-cid:${cid}`;
  let name = u.pathname.split('/')[3] ?? '';
  try { name = decodeURIComponent(name); } catch { return null; }
  return parsed.coordinates ? `google-location:${parsed.coordinates.join(',')}:${name.toLowerCase()}` : null;
}

export function canonicalPlaceIdentity(url: string): string | null {
  return identityForParsedUrl(url, parseGooglePlaceUrl(url));
}
/** Validate old portable receipts without weakening identity matching between new captures and sources. */
export function matchesSavedPlaceIdentity(url: string, saved: unknown): boolean {
  const parsed = parseGooglePlaceUrl(url);
  if (saved === identityForParsedUrl(url, parsed)) return true;
  // Earlier releases omitted the selected identity whenever its coordinates were unavailable.
  return !!parsed.placeId && !parsed.coordinates && saved === identityForParsedUrl(url, parsed, false);
}

export function navigationUrl(coordinates: unknown, mode: 'driving' | 'walking'): string {
  const valid = validateCoordinates(coordinates);
  return valid ? `https://www.google.com/maps/dir/?api=1&destination=${valid.join(',')}&travelmode=${mode}&dir_action=navigate` : '';
}

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const r = Math.PI / 180;
  const h = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
