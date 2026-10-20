import { checkedShortTripDefaults, isShortTripDefaultsForRoot } from '../outings/short-trip-preferences';
import { isRecord, isUnknownArray } from '../domain/guards';
import { DEFAULT_SETTINGS } from '../types';
import type { AreaHint, CaptureSnapshot, MoveEntry, MoveJournal, MoveSettingsSnapshot, Settings, TileSet } from '../types';
import { normaliseDistanceUnit } from '../units';

const text = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const texts = (value: unknown): value is string[] => isUnknownArray(value) && value.every(text);
const areaHint = (value: unknown): value is AreaHint => isRecord(value) && text(value.id) && text(value.phrase) && text(value.townPath) && text(value.localityPath) && typeof value.enabled === 'boolean';
const tileSet = (value: unknown): value is TileSet => isRecord(value) && text(value.id) && text(value.name) && text(value.lightTiles) && text(value.darkTiles);
const snapshot = (value: unknown): value is CaptureSnapshot => isRecord(value) && text(value.captureId) && text(value.revision) && (value.reviewRequired === undefined || typeof value.reviewRequired === 'boolean');
const asset = (value: unknown): value is Settings['assets'][string] => isRecord(value) && text(value.hash) && number(value.version);
function recordOf<T>(value: unknown, check: (entry: unknown) => entry is T): value is Record<string, T> {
  return isRecord(value) && Object.values(value).every(check);
}
function moveEntry(value: unknown): value is MoveEntry {
  return isRecord(value) && text(value.from) && text(value.to) && text(value.beforeHash) && text(value.afterHash) &&
    (value.text === undefined || text(value.text)) && (value.backupPath === undefined || text(value.backupPath)) &&
    (value.phase === undefined || value.phase === 'backed-up' || value.phase === 'moved' || value.phase === 'updated');
}
function settingsSnapshot(value: unknown): value is MoveSettingsSnapshot {
  return isRecord(value) && text(value.root) && recordOf(value.assets, asset) && recordOf(value.captureReceipts, text) &&
    recordOf(value.captureSnapshots, snapshot) && texts(value.previousRoots) && texts(value.recentLocalities) &&
    (value.areaHints === undefined || isUnknownArray(value.areaHints) && value.areaHints.every(areaHint)) &&
    (value.shortTripDefaults === undefined || isShortTripDefaultsForRoot(value.shortTripDefaults, value.root));
}
function moveJournal(value: unknown): value is MoveJournal {
  return isRecord(value) && text(value.id) && (value.kind === 'notebook' || value.kind === 'locality' || value.kind === 'place-area' || value.kind === 'capture-archive') &&
    (value.status === 'preparing' || value.status === 'moving' || value.status === 'failed') && text(value.backupRoot) && text(value.fromRoot) && text(value.toRoot) &&
    isUnknownArray(value.entries) && value.entries.every(moveEntry) && settingsSnapshot(value.settingsBefore) &&
    (value.error === undefined || text(value.error)) && (value.writeBoundary === undefined || text(value.writeBoundary));
}
function clipperImport(value: unknown): value is NonNullable<Settings['clipperImports']>['shop'] {
  return isRecord(value) && text(value.fingerprint) && text(value.release) && text(value.confirmedAt);
}

/** Validate saved JSON before exposing it as typed settings. Never drop recovery state. */
export function parseSettings(value: unknown): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (value === undefined || value === null) return settings;
  if (!isRecord(value)) throw new Error('The saved plugin settings are invalid. Preserve data.json before reviewing it.');
  if (value.root !== undefined) {
    if (!text(value.root)) throw new Error('The saved notebook folder is invalid.');
    settings.root = value.root;
  }
  if (value.suggestionKm !== undefined) {
    if (!number(value.suggestionKm) || value.suggestionKm < .1 || value.suggestionKm > 50) throw new Error('The saved nearby-area radius is invalid.');
    settings.suggestionKm = value.suggestionKm;
  }
  if (value.setupVersion !== undefined) {
    if (!number(value.setupVersion) || !Number.isSafeInteger(value.setupVersion) || value.setupVersion < 0) throw new Error('The saved notebook setup version is invalid.');
    settings.setupVersion = value.setupVersion;
  }
  settings.distanceUnit = normaliseDistanceUnit(value.distanceUnit);
  if (value.defaultSourceType !== undefined) {
    if (!text(value.defaultSourceType) || !value.defaultSourceType.trim() || value.defaultSourceType.length > 80 || /[\r\n]/.test(value.defaultSourceType)) throw new Error('The saved default source type is invalid.');
    settings.defaultSourceType = value.defaultSourceType;
  }
  if (value.sourceTypes !== undefined) {
    if (!texts(value.sourceTypes) || !value.sourceTypes.length || value.sourceTypes.some(type => !type.trim() || type.length > 80)) throw new Error('The saved source types are invalid.');
    settings.sourceTypes = structuredClone(value.sourceTypes);
  }
  if (value.tileSets !== undefined) {
    if (!isUnknownArray(value.tileSets) || !value.tileSets.every(tileSet)) throw new Error('The saved map backgrounds are invalid.');
    settings.tileSets = structuredClone(value.tileSets);
  }
  if (value.assets !== undefined) {
    if (!recordOf(value.assets, asset)) throw new Error('The saved component ownership is invalid.');
    settings.assets = structuredClone(value.assets);
  }
  if (value.captureReceipts !== undefined) {
    if (!recordOf(value.captureReceipts, text)) throw new Error('The saved capture receipts are invalid. Preserve them before reviewing settings.');
    settings.captureReceipts = structuredClone(value.captureReceipts);
  }
  if (value.captureSnapshots !== undefined) {
    if (!recordOf(value.captureSnapshots, snapshot)) throw new Error('The saved capture snapshots are invalid. Preserve them before reviewing settings.');
    settings.captureSnapshots = structuredClone(value.captureSnapshots);
  }
  if (value.previousRoots !== undefined) {
    if (!texts(value.previousRoots)) throw new Error('The saved previous notebook folders are invalid.');
    settings.previousRoots = structuredClone(value.previousRoots);
  }
  if (value.recentLocalities !== undefined) {
    if (!texts(value.recentLocalities)) throw new Error('The saved recent areas are invalid.');
    settings.recentLocalities = structuredClone(value.recentLocalities);
  }
  if (value.areaHints !== undefined) {
    if (!isUnknownArray(value.areaHints) || !value.areaHints.every(areaHint)) throw new Error('The saved address rules are invalid.');
    settings.areaHints = structuredClone(value.areaHints);
  }
  if (value.shortTripDefaults !== undefined) settings.shortTripDefaults = checkedShortTripDefaults(value.shortTripDefaults, settings.root);
  if (value.clipperImports !== undefined) {
    if (!isRecord(value.clipperImports) || value.clipperImports.shop !== undefined && !clipperImport(value.clipperImports.shop) || value.clipperImports.parking !== undefined && !clipperImport(value.clipperImports.parking)) throw new Error('The saved Clipper import confirmations are invalid.');
    settings.clipperImports = {};
    if (clipperImport(value.clipperImports.shop)) settings.clipperImports.shop = structuredClone(value.clipperImports.shop);
    if (clipperImport(value.clipperImports.parking)) settings.clipperImports.parking = structuredClone(value.clipperImports.parking);
  }
  if (value.clipperNoticeFingerprint !== undefined) {
    if (!text(value.clipperNoticeFingerprint)) throw new Error('The saved Clipper notice is invalid.');
    settings.clipperNoticeFingerprint = value.clipperNoticeFingerprint;
  }
  if (value.migration !== undefined) {
    if (!moveJournal(value.migration)) throw new Error('The saved organisation recovery record is invalid. Preserve data.json and notebook backups before reviewing it.');
    settings.migration = structuredClone(value.migration);
  }
  return settings;
}
