import type { ShortTripDefaults } from './outings/short-trip';
import type { DistanceUnit } from './units';
export type Coordinates = [number, number];
export type PlaceKind = 'shop' | 'parking';
export interface PlacePersonalDetails { display_name?: string; opening_notes?: string; }
export interface PlaceRecord {
  path: string; name: string; kind: PlaceKind; locality: string;
  coordinates: Coordinates | null; properties: Record<string, unknown> & PlacePersonalDetails;
}
export interface LocalityRecord { path: string; name: string; parentPath: string; segments: string[]; label: string; }
export interface AreaSelection { town: string; locality: string; townPath?: string; localityPath?: string; }
export interface AreaHint { id: string; phrase: string; townPath: string; localityPath: string; enabled: boolean; }
export interface CaptureSaveOptions { makeDefaultSourceType?: boolean; rememberHint?: { phrase: string }; allowUnassigned?: boolean; }
export interface CaptureDraft {
  captureId: string; sourcePath?: string; sourceRevision?: string; sourceType?: string; kind: PlaceKind; name: string;
  address: string; url: string; website?: string; telephone?: string; coordinates: Coordinates | null;
  coordinateIssue?: string; googleRating: number | null;
  googleReviewCount: number | null; topics: string[]; hours: string[];
  capturedAt: string; street: string; postcode: string; brandTag: string;
}
export interface VisitInput {
  observations: string; finds: string; nextTime: string;
  visitDate: string; updateLastVisited: boolean;
  itemsPurchased?: number; haulPotential?: number; stockColour?: string; colourEvidence?: 'confirmed' | 'suspected' | 'unknown';
  rating?: number; comments?: string;
}
export interface TileSet { id: string; name: string; lightTiles: string; darkTiles: string; }
export interface CaptureSnapshot { captureId: string; revision: string; reviewRequired?: boolean; }
export interface MoveEntry {
  from: string; to: string; beforeHash: string; afterHash: string; text?: string;
  backupPath?: string; phase?: 'backed-up' | 'moved' | 'updated';
}
export interface MovePreview {
  id: string; kind: 'notebook' | 'locality' | 'place-area' | 'capture-archive'; fromRoot: string; toRoot: string;
  files: { from: string; to: string }[]; moves: { from: string; to: string }[];
  rewrites: string[]; conflicts: string[]; warnings: string[];
  entries: MoveEntry[]; inventory: string[]; observed: Record<string, string>;
  captureSnapshots: Record<string, CaptureSnapshot>;
  locality?: { path: string; name: string; parentPath: string };
  areaChange?: { sourcePath: string; selection: AreaSelection; targetLocalityPath: string; creations: string[] };
  creations?: string[];
  ignoredPaths?: string[]; opaqueSubtrees?: string[]; writeBoundary?: string;
}
export interface MoveReport { moved: string[]; updated: string[]; backupRoot: string; created?: string[]; }
export interface MoveSettingsSnapshot {
  root: string; assets: Settings['assets']; captureReceipts: Record<string, string>;
  captureSnapshots: Record<string, CaptureSnapshot>; previousRoots: string[]; recentLocalities: string[];
  areaHints?: AreaHint[]; shortTripDefaults?: ShortTripDefaults;
}
export interface MoveJournal {
  id: string; kind: MovePreview['kind']; status: 'preparing' | 'moving' | 'failed';
  backupRoot: string; fromRoot: string; toRoot: string; entries: MoveEntry[];
  settingsBefore: MoveSettingsSnapshot; error?: string; writeBoundary?: string;
}
export interface Settings {
  root: string; suggestionKm: number; distanceUnit: DistanceUnit; setupVersion: number; tileSets: TileSet[];
  assets: Record<string, { hash: string; version: number }>;
  captureReceipts: Record<string, string>; captureSnapshots: Record<string, CaptureSnapshot>;
  previousRoots: string[]; sourceTypes: string[]; recentLocalities: string[];
  defaultSourceType: string; areaHints: AreaHint[]; shortTripDefaults?: ShortTripDefaults;
  clipperImports?: Partial<Record<PlaceKind, { fingerprint: string; release: string; confirmedAt: string }>>;
  clipperNoticeFingerprint?: string;
  migration?: MoveJournal;
}
export const DEFAULT_SETTINGS: Settings = {
  root: 'Reseller sourcing', suggestionKm: 1, distanceUnit: 'miles', setupVersion: 0,
  tileSets: [], assets: {}, captureReceipts: {}, captureSnapshots: {}, previousRoots: [],
  sourceTypes: ['Charity shop', 'Rag house', 'Wholesaler', 'Market', 'Other'], recentLocalities: [],
  defaultSourceType: 'Charity shop', areaHints: [],
};
