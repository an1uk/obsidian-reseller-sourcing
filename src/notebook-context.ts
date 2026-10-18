import type { App, EventRef, PluginManifest } from 'obsidian';
import type { Settings, Coordinates, PlaceKind } from './types';
import type { SourcingStore } from './storage/store';
import type { MapHost } from './map';

/** Global UI services. Resolving a note never changes the selected real notebook. */
export interface NotebookUiHost {
  readonly app: App;
  readonly manifest: Pick<PluginManifest, 'version'>;
  readonly basesReady: boolean;
  readonly examplesAvailable: boolean;
  showExamples(): void | Promise<void>;
  contextForPath(path: string): Promise<NotebookContext | undefined>;
  contextRootForPath(path: string): string | undefined;
  register(callback: () => unknown): void;
  registerEvent(event: EventRef): void;
}

/** One captured notebook capability; a modal retains this context throughout its life. */
export interface NotebookContext {
  readonly kind: 'real' | 'examples';
  readonly root: string;
  readonly label: string;
  readonly externalActions: 'open' | 'preview';
  readonly host: NotebookUiHost;
  readonly app: App;
  readonly manifest: Pick<PluginManifest, 'version'>;
  readonly basesReady: boolean;
  readonly settings: Settings;
  readonly store: SourcingStore;
  readonly mapHost: MapHost;
  readonly referencePath?: string;
  readonly tourPath?: string;
  beginEditing(): (() => void) | undefined;
  runRootOperation<T>(run: () => Promise<T>, recovery?: boolean): Promise<T>;
  openExternal(url: string, title?: string): void | Promise<void>;
  openFile(path: string): Promise<void>;
  home(): Promise<void>;
  newPlace(kind: PlaceKind, coordinates?: Coordinates | null, shopPath?: string): void;
  newOuting(): void;
  newLocality(): void;
  reviewCaptures(explicit?: boolean): Promise<void>;
  saveSettings(): Promise<void>;
  openClipperSetup(): void;
  openClipperImportTools(): Promise<boolean>;
  revealTemplates(kind?: PlaceKind): Promise<void>;
  notifyClipperStatusChanged(): void;
  onClipperStatusChanged(callback: () => void): () => void;
}
