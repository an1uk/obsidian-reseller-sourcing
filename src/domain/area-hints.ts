import type { AreaHint, LocalityRecord } from '../types';

export interface AddressHints { town: string; locality: string; phrase: string; }

/** Exact word matching tolerates case, punctuation and spacing, never fuzzy names. */
export function normalizeAreaPhrase(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

const roadEnd = /\b(street|st|road|rd|lane|ln|avenue|ave|drive|dr|way|close|crescent|cres|terrace|place|pl|square|sq|hill|walk|row|grove|gardens|gdns|court|ct|parade|oval|mews|rise|bank|brae|view|passage|yard|quay|embankment)\.?$/i;
const building = /\b(shopping\s+(centre|center|precinct)|retail\s+park|business\s+park|industrial\s+(estate|park)|centre|center|precinct|arcade|building|wing|floor|unit|suite|shop|store|mall|complex|station|hall|house|block|office|tower)\b/i;
const administrative = /\b(county|district|region|borough|council)\b|\b[\p{L}]*shire\b|^greater\s/iu;
const isRoad = (part: string): boolean => roadEnd.test(part) || (/^\d/.test(part) && /\b(gate|gates)\.?$/i.test(part));
const areaName = (part: string): boolean => part.length > 0 && part.length <= 80 && /\p{L}/u.test(part) && /^[\p{L}\p{M} .'’()-]+$/u.test(part) && !building.test(part) && !administrative.test(part) && !isRoad(part);

/** Read only explicit UK postal address components; premises never become a locality. */
export function getAddressHints(address: string): AddressHints {
  const parts = address.replace(/[\r\n\u2028\u2029]/g, ' ').replace(/,\s*(UK|United Kingdom|England|Scotland|Wales|Northern Ireland)$/i, '')
    .split(',').map(part => part.trim()).filter(Boolean);
  const last = parts.at(-1) ?? '';
  const postcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  const match = last.match(postcode);
  if (!match) return { town: '', locality: '', phrase: '' };
  let town = last.slice(0, match.index).trim();
  let townIndex = parts.length - 1;
  if (!town && parts.length > 1) { townIndex--; town = parts[townIndex]!; }
  if (!areaName(town)) return { town: '', locality: '', phrase: '' };
  const preceding = parts.slice(0, townIndex);
  const roadIndexes = preceding.flatMap((part, index) => isRoad(part) ? [index] : []);
  const afterRoad = roadIndexes.length === 1 ? preceding.slice(roadIndexes[0]! + 1) : [];
  const locality = afterRoad.length === 1 && areaName(afterRoad[0]!) ? afterRoad[0]! : '';
  const premises = preceding.find(part => building.test(part) && !isRoad(part)) ?? '';
  const phrase = premises.replace(/^(?:(?:unit|shop|suite|building|no[.]?)\s*)?\d+[a-z]?(?:\s*[-–/]\s*\d+[a-z]?)?(?:\s+|$)/i, '').trim() || locality;
  return { town, locality, phrase };
}

/** Return every valid remembered match; the caller presents conflicts for review. */
export function matchAreaHints(address: string, townPath: string, hints: AreaHint[], localities: LocalityRecord[]): AreaHint[] {
  const town = localities.find(locality => locality.path === townPath && !locality.parentPath);
  const words = normalizeAreaPhrase(address);
  if (!town || !words) return [];
  const byPath = new Map(localities.map(locality => [locality.path, locality]));
  const withinTown = (path: string): boolean => {
    if (!path) return false;
    const visited = new Set<string>();
    let current = byPath.get(path);
    while (current && !visited.has(current.path)) {
      if (current.path === town.path) return true;
      visited.add(current.path); current = byPath.get(current.parentPath);
    }
    return false;
  };
  return hints.filter(hint => {
    if (!hint || typeof hint.id !== 'string' || !hint.id.trim() || typeof hint.phrase !== 'string' || typeof hint.townPath !== 'string' || typeof hint.localityPath !== 'string') return false;
    const phrase = normalizeAreaPhrase(hint.phrase);
    return hint.enabled === true && hint.townPath === town.path && !!phrase && withinTown(hint.localityPath) && (` ${words} `).includes(` ${phrase} `);
  });
}
