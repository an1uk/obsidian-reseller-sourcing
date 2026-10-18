import type { Coordinates, VisitInput } from '../types';

export type OutingStatus = 'planned' | 'active' | 'finished';
export type OutingStopStatus = 'pending' | 'visited' | 'skipped';
export interface OutingStop {
  id: string;
  sourcePath: string;
  status: OutingStopStatus;
  completedAt?: string;
  visitOperationId?: string;
  visitPath?: string; visitId?: string;
  skipReason?: string;
}
export interface OutingGroup { id: string; parkingPath: string; stops: OutingStop[]; }
export interface OutingPlanInput { name: string; groups: OutingGroup[]; planning?: OutingPlanningOptions; }
export interface OutingVisitInput extends VisitInput { rating?: number; comments?: string; }
export interface OutingVisitDraft { operationId: string; stopId: string; input: OutingVisitInput; updatedAt: string; visitRevision?: string; }
export interface OutingVisitOperation {
  id: string; stopId: string; sourcePath: string; input: OutingVisitInput; recordedAt: string;
  sourceBeforeHash: string; sourceIdentity: string;
  kind?: 'linked-visit'; visitPath?: string; visitId?: string; visitRevision?: string; confirmedSkipped?: boolean;
}
export interface OutingRecord {
  preparationId?: string; exampleBackground?: boolean;
  id: string; path: string; name: string; status: OutingStatus; groups: OutingGroup[];
  createdAt: string; startedAt?: string; finishedAt?: string;
  draft?: OutingVisitDraft; operation?: OutingVisitOperation; revision: string; planning?: OutingPlanningOptions;
}
export interface OutingVisitOptions { operationId?: string; revision?: string; confirmSkipped?: boolean; visitRevision?: string; }

export type PlanningAnchor = { kind: 'record'; path: string } | { kind: 'coordinates'; coordinates: Coordinates; label?: string };
export interface OutingPlanningOptions {
  mode: 'distance' | 'hours';
  date: string; departureTime: string; timeZone: string;
  start: PlanningAnchor | null;
  end: { kind: 'return' } | { kind: 'last' } | PlanningAnchor;
  defaultVisitMinutes: number;
  stopOverrides: Record<string, { visitMinutes?: number; hours?: { closed: boolean; intervals: { open: string; close: string }[] } }>;
  estimates: { driveMultiplier: number; driveKph: number; walkMultiplier: number; walkKph: number; parkingMinutes: number };
  latestFinishTime?: string;
}
export interface PlanningHours { hours: string[]; hoursChecked: string; }
export interface PlanningTimelineStop {
  groupId: string; stopId: string; sourcePath: string;
  arrival: number; visitStarts: number; departure: number;
  waitMinutes: number; visitMinutes: number;
  hoursStatus: 'open' | 'closed' | 'unconfirmed'; hoursChecked: string;
}
export interface JourneyEstimate {
  drivingKm: number; walkingKm: number; totalKm: number; totalMinutes: number;
  waitingMinutes: number; openingConflicts: number; unconfirmedHours: number;
  startAt: number; finishAt: number; latestFinishMissed: boolean;
  timeline: PlanningTimelineStop[];
}
export interface OutingOptimisationPreview {
  fingerprint: string; options: OutingPlanningOptions; groups: OutingGroup[];
  current: JourneyEstimate; proposed: JourneyEstimate; warnings: string[]; blockers: string[];
}
