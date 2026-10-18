import type { AreaSelection, CaptureDraft } from '../types';
import type { OutingGroup, OutingPlanningOptions } from '../outings/types';
export type WorkspaceRoute =
  | { screen: 'home' | 'places' | 'outings' | 'history' | 'more' }
  | { screen: 'place'; path: string; section?: 'overview' | 'map' | 'visits' | 'details' }
  | { screen: 'outing' | 'visit' | 'area'; path: string };
export interface WorkspaceViewState {
  root: string; route: WorkspaceRoute;
  places?: { query: string; area: string; kind: string; shortlist: boolean; view: 'list' | 'map' };
  history?: import('../ui/visit-history').VisitsHubState;
  positions?: Record<string, { scroll: number; focus?: string; expanded?: string[] }>;
}
export interface OutingPreparation {
  startAfterSave?: boolean;
  name: string; groups: OutingGroup[]; planning?: OutingPlanningOptions; step: 1 | 2 | 3; unresolved: string[];
  filter: { text: string; area: string; shortlist: boolean; type: string; view: 'list' | 'map' };
  existingPath?: string; existingRevision?: string;
}
export interface PlacePreparation { capture: CaptureDraft; area: AreaSelection; step: 1 | 2; linkedSource?: string; filename: string; coordinatesText?: string; makeDefaultSourceType?: boolean; }
interface PreparationEnvelope<T, K extends 'outing' | 'place'> {
  schema: 1; id: string; kind: K; root: string; updatedAt: string; deferred: boolean;
  phase: 'editing' | 'completing' | 'complete' | 'discarded'; data: T; revision: string; resultPath?: string;
}
export type PreparationDraft<T = OutingPreparation | PlacePreparation> =
  T extends OutingPreparation ? PreparationEnvelope<T, 'outing'> : T extends PlacePreparation ? PreparationEnvelope<T, 'place'> : never;
