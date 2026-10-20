import type { PlaceRecord } from '../types';
import type { OutingFocusPhase, OutingFocusState, OutingGroup, OutingRecord, OutingStop } from './types';
import { validateCoordinates } from '../domain/coordinates';

const phases: OutingFocusPhase[] = ['drive', 'walk', 'visit', 'return'];
export const focusPhaseLabel = (phase: OutingFocusPhase): string => ({ drive: 'Drive to parking', walk: 'Walk to shop', visit: 'Record visit', return: 'Return to car' })[phase];
export function isOutingFocus(value: unknown): value is OutingFocusState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  return Object.keys(fields).every(key => ['enabled', 'phase', 'stopId', 'parkedGroupId', 'parkedParkingPath', 'parkedCoordinates'].includes(key)) &&
    typeof fields.enabled === 'boolean' && phases.some(phase => phase === fields.phase) && typeof fields.stopId === 'string' &&
    fields.stopId.length < 200 && (fields.parkedGroupId === undefined || typeof fields.parkedGroupId === 'string' && fields.parkedGroupId.length < 200) &&
    (fields.parkedParkingPath === undefined || typeof fields.parkedParkingPath === 'string') &&
    (fields.parkedGroupId === undefined) === (fields.parkedParkingPath === undefined) &&
    (fields.parkedCoordinates === undefined || Array.isArray(fields.parkedCoordinates) && fields.parkedCoordinates.every(value => typeof value === 'number') && !!validateCoordinates(fields.parkedCoordinates)) &&
    (fields.parkedCoordinates === undefined || fields.parkedGroupId !== undefined);
}
function contextPlace(record: OutingRecord, places: PlaceRecord[], path: string, kind: PlaceRecord['kind']): PlaceRecord | undefined {
  const at = record.path.lastIndexOf('/Outings/'), root = at < 0 ? '' : record.path.slice(0, at);
  if (!root || !path.startsWith(root + '/') || path.slice(root.length + 1).startsWith('Examples/') || path.includes('\\') || path.split('/').some(part => part === '..' || part.startsWith('.'))) return;
  return places.find(place => place.path === path && place.kind === kind);
}
export interface OutingFocusView {
  state: OutingFocusState; stop?: OutingStop; group?: OutingGroup; source?: PlaceRecord; parking?: PlaceRecord;
  parked?: PlaceRecord; warning: string; readyToFinish: boolean;
}
/** A manual parking confirmation is the only source of a parked anchor. No GPS or external-return inference. */
export function outingFocusView(record: OutingRecord, places: PlaceRecord[]): OutingFocusView {
  const group = record.groups.find(value => value.stops.some(stop => stop.status === 'pending'));
  const stop = group?.stops.find(value => value.status === 'pending');
  const source = stop ? contextPlace(record, places, stop.sourcePath, 'shop') : undefined;
  const parking = group?.parkingPath ? contextPlace(record, places, group.parkingPath, 'parking') : undefined;
  const saved = record.focus, anchorGroup = record.groups.find(value => value.id === saved?.parkedGroupId && value.parkingPath === saved.parkedParkingPath);
  const anchor = anchorGroup ? contextPlace(record, places, anchorGroup.parkingPath, 'parking') : undefined;
  const anchorCoordinates = validateCoordinates(anchor?.coordinates), confirmedCoordinates = validateCoordinates(saved?.parkedCoordinates);
  const parked = anchor && anchorCoordinates && confirmedCoordinates && anchorCoordinates[0] === confirmedCoordinates[0] && anchorCoordinates[1] === confirmedCoordinates[1] ? anchor : undefined;
  const sameStop = !!stop && saved?.stopId === stop.id;
  const defaultPhase: OutingFocusPhase = parked ? group?.id === anchorGroup?.id ? 'walk' : 'return' : group?.parkingPath ? 'drive' : 'walk';
  let phase = sameStop ? saved.phase : defaultPhase;
  let warning = saved?.parkedGroupId && !parked ? 'The saved parking anchor is unavailable or has changed. Confirm your stage; no parked location has been assumed.' : '';
  if (phase === 'return' && !parked) phase = defaultPhase;
  if (!stop) phase = parked ? 'return' : 'visit';
  if (stop && !source) warning = 'This source is missing or belongs to another notebook. Open the full outing to review this stop.';
  if (source?.properties.shop_closed === true) warning = 'This source is marked permanently closed. Review or skip it in More.';
  const state: OutingFocusState = { enabled: saved?.enabled ?? false, phase, stopId: stop?.id ?? '' };
  if (parked && anchorGroup) { state.parkedGroupId = anchorGroup.id; state.parkedParkingPath = parked.path; state.parkedCoordinates = [...parked.coordinates!]; }
  return { state, stop, group, source, parking, parked, warning, readyToFinish: !stop && !parked };
}
/** A coordinate edit or move must invalidate a rendered phase choice as well as an outing edit. */
export function outingFocusFingerprint(record: OutingRecord, places: PlaceRecord[]): string {
  const related = new Set(record.groups.flatMap(group => [group.parkingPath, ...group.stops.map(stop => stop.sourcePath)]));
  if (record.focus?.parkedParkingPath) related.add(record.focus.parkedParkingPath);
  return JSON.stringify([record.revision, places.filter(place => related.has(place.path)).map(place => [place.path, place.kind, place.name, place.coordinates, place.properties.shop_closed === true]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
/** Explicit manual changes do not change a stop outcome, visit draft or receipt. */
export function changedOutingFocus(record: OutingRecord, places: PlaceRecord[], phase: OutingFocusPhase): OutingFocusState {
  const view = outingFocusView(record, places), state = { ...view.state, phase };
  if (!view.stop && phase !== 'return') throw Error('No remaining source needs this stage.');
  if (phase === 'return' && !view.parked) throw Error('Confirm where you parked before returning to the car.');
  if (phase === 'drive' && (!view.group?.parkingPath || !view.parking || !validateCoordinates(view.parking.coordinates))) throw Error('The selected parking needs a valid pin before driving directions are available.');
  return state;
}
export function confirmOutingParked(record: OutingRecord, places: PlaceRecord[]): OutingFocusState {
  const view = outingFocusView(record, places);
  if (!view.group || !view.stop || !view.parking || !validateCoordinates(view.parking.coordinates)) throw Error('Confirm a valid parking location in the full outing first.');
  return { ...view.state, phase: 'walk', parkedGroupId: view.group.id, parkedParkingPath: view.parking.path, parkedCoordinates: [...view.parking.coordinates!] };
}
export function leaveOutingParking(record: OutingRecord, places: PlaceRecord[]): OutingFocusState {
  const view = outingFocusView(record, places);
  if (!view.parked) throw Error('The saved parking anchor is unavailable. Review the full outing.');
  return { enabled: view.state.enabled, phase: view.stop ? view.group?.parkingPath ? 'drive' : 'walk' : 'visit', stopId: view.stop?.id ?? '' };
}
