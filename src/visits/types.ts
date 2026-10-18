import type { VisitInput } from '../types';

export type ColourEvidence = 'confirmed' | 'suspected' | 'unknown';
export interface VisitRecord {
  schema: 1; id: string; path: string; sourcePath: string; visitDate: string;
  recordedAt: string; updatedAt: string; observations: string; finds: string; nextTime: string;
  itemsPurchased?: number; haulPotential?: number; stockColour?: string; colourEvidence?: ColourEvidence;
  outingPath?: string; outingId?: string; stopId?: string; legacyOperationId?: string;
  sourcingExample?: boolean; revision: string;
}
export interface VisitSaveOptions {
  operationId?: string; recordedAt?: string; draftRevision?: string; outingPath?: string; outingId?: string; stopId?: string; legacyOperationId?: string;
}
export interface VisitOperation {
  schema: 1; kind: 'create' | 'update'; id: string; stage: 'prepared' | 'visit-written' | 'complete' | 'cancelled';
  sourcePath: string; sourceIdentity: string; sourceBeforeHash: string;
  input: VisitInput; inputHash: string; recordedAt: string;
  visitPath: string; visitId: string; beforeVisitHash?: string; beforeValues?: Record<string, unknown>;
  expected: VisitRecord; outingPath?: string; outingId?: string; stopId?: string;
}
export interface VisitInspection { visits: VisitRecord[]; warnings: string[]; }

export interface VisitDraftState { input: VisitInput; revision: string; visitRevision?: string; cleared?: boolean; }

/** Validated, read-only summaries for choosing saved work on Home. */
export interface VisitDraftSummary {
  path: string; sourcePath: string; sourceName: string; updatedAt: string; revision: string;
  visitPath?: string; visitRevision?: string;
}
export interface VisitSavedWorkWarning { path: string; message: string; }
export interface VisitSavedWorkInspection {
  drafts: VisitDraftSummary[]; operations: VisitOperation[]; warnings: VisitSavedWorkWarning[];
}
