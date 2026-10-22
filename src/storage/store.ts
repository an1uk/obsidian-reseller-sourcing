import { checkedShortTripDefaults } from '../outings/short-trip-preferences';
import type { ShortTripDefaults } from '../outings/short-trip';
import { hasControlCharacters, isRecord, isUnknownArray } from '../domain/guards';
import { notebookFiles } from './files';
import { propertyText } from '../domain/guards';
import { VisitStore } from '../visits/store';
import { PreparationStore } from '../workspace/drafts';
import { NotebookPaths } from './paths';
import type { VisitRecord } from '../visits/types';
import { examplesStatePath, parseExamplesState, remapExamplesState } from '../examples/state';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { MutationCoordinator } from './coordinator';
import { buildCaptureRefreshPreview, captureMatchesSource, captureRefreshPatch, captureRefreshReceipts, refreshReceiptFor, type CaptureRefreshField, type CaptureRefreshPreview, type CaptureRefreshReceipt } from "../capture/refresh";
import { OutingStore } from '../outings/store';
import { inspectNotebook, type AttachmentPreview } from './attachment';
export type { AttachmentPreview } from './attachment';
import type { App, TFile } from 'obsidian';
import type { AreaHint, AreaSelection, CaptureSaveOptions, CaptureDraft, Coordinates, LocalityRecord, MovePreview, MoveReport, PlaceKind, PlaceRecord, Settings, VisitInput } from '../types';
import { CLIPPER_TEMPLATE_RELEASE, createClipperTemplates, normalizeAreaPhrase, parseCapture } from '../capture';
import { canonicalPlaceIdentity, isGoogleMapsUrl, safeFileName, validateCoordinates, validateRootPath, websiteUrl } from '../domain';
import { ASSET_VERSION, baseText, bodyForPlace, bundledAssets, placeProperties } from './assets';
import { hashText, linkPath, readNote, updateNoteProperty, wiki, writeNote } from './markdown';
import { localitySubtree, resolveLocalities, validLocalityName } from '../domain/hierarchy';
import { executeMove, migrationEligible, prepareMove, rewriteLinks, rollbackMove as recoverMove, stripCodexMarkers, validateMovePreview } from './migration';
import { assertPlaceEditComparison, isPlaceEditPreparation, placeDisplayName, placeEditPatch, placeEditReceiptFor, placeEditSnapshot, reviewPlaceEdit, sameGoogleListing, type PlaceEditReview, type PlaceEditSnapshot, type PlaceEditValues } from '../place-edit/model';

interface AreaPlan { town: LocalityRecord; leaf: LocalityRecord; chain: LocalityRecord[]; missing: LocalityRecord[]; creations: string[]; }

export interface SetupReport { created: string[]; updated: string[]; conflicts: string[]; }
export interface ClipperTemplateStatus {
  kind: PlaceKind; name: string; path: string; json: string; fingerprint: string;
  exportState: 'current' | 'missing' | 'edited'; confirmedAt: string | null;
}
export interface ClipperStatus { release: string; fingerprint: string; templates: ClipperTemplateStatus[]; }
const isFile = (value: unknown): value is TFile => !!value && typeof value === 'object' && 'extension' in value;
export interface SourcingStoreOptions {
  mode?: 'live' | 'examples'; coordinator?: MutationCoordinator;
  assertWritable?: () => void | Promise<void>; assertCurrent?: () => void; writeBoundary?: string;
}
export class SourcingStore {
  private coordinator: MutationCoordinator;
  readonly mode: 'live' | 'examples';
  readonly outings: OutingStore;
  readonly visits: VisitStore;
  readonly preparations: PreparationStore;
  get paths(): NotebookPaths { return new NotebookPaths(this.root); }
  constructor(public app: App, public settings: Settings, private saveSettings: () => Promise<void>, private options: SourcingStoreOptions = {}) {
    this.coordinator = options.coordinator ?? new MutationCoordinator(); this.mode = options.mode ?? 'live';
    settings.captureSnapshots ??= {}; settings.previousRoots ??= []; settings.recentLocalities ??= [];
    settings.defaultSourceType ??= 'Charity shop'; settings.areaHints ??= [];
    settings.sourceTypes ??= ['Charity shop', 'Rag house', 'Wholesaler', 'Market', 'Other'];
    const visitHost = { app, root: () => this.root, examples: this.mode === 'examples', exclusive: <T>(action: () => Promise<T>) => this.serial(action), listPlaces: () => this.listPlaces(), folder: (path: string) => this.folder(path), sourceBlocked: async (path: string, operationId?: string) => (await this.outings.list()).some(outing => outing.operation?.sourcePath === path && outing.operation.id !== operationId) };
    this.visits = new VisitStore(visitHost);
    this.preparations = new PreparationStore(visitHost);
    this.outings = new OutingStore({ ...visitHost, visits: this.visits });
  }
  get migrationActive(): boolean { return !!this.settings.migration; }
  private writable(): void { this.options.assertCurrent?.(); if (this.mode === 'examples' && this.options.writeBoundary && this.root !== this.options.writeBoundary) throw new Error('Practice records must remain inside Examples.'); if (this.migrationActive) throw new Error('An interrupted move needs recovery before editing this notebook.'); }
  get root(): string { return validateRootPath(this.settings.root); }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    return this.coordinator.run(async () => { this.writable(); await this.options.assertWritable?.(); return fn(); });
  }
  scoped(path: string): boolean { return path.startsWith(this.root + '/') && (this.mode === 'examples' || !path.startsWith(this.root + '/Examples/')) && !path.split('/').some(p => p === '..' || p === '.'); }
  private guard(path: string): void { this.options.assertCurrent?.(); if (!this.scoped(path) || (path.includes('\\') || hasControlCharacters(path, false))) throw new Error('Path is outside Reseller sourcing.'); }
  private file(path: string): TFile {
    this.guard(path); const file = this.app.vault.getAbstractFileByPath(path);
    if (!isFile(file)) throw new Error('Note no longer exists: ' + path); return file;
  }
  private async folder(path: string): Promise<void> {
    this.options.assertCurrent?.();
    if (path !== this.root) this.guard(path);
    const parts = path.split('/'); let current = '';
    for (const part of parts) {
      current += (current ? '/' : '') + part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (isFile(existing)) throw new Error('A file occupies the folder ' + current);
      if (!existing) { this.options.assertCurrent?.(); await this.app.vault.createFolder(current); }
    }
  }
  private contextBase(text: string, path: string): string {
    if (this.mode !== 'examples') return text;
    const document: unknown = parseYaml(text);
    if (!isRecord(document) || !isUnknownArray(document.views) || !document.views.every(isRecord) || !isRecord(document.filters) || !isUnknownArray(document.filters.and) || !document.filters.and.every(filter => typeof filter === 'string')) throw Error('The generated practice Base has invalid settings.');
    document.filters.and = [...document.filters.and.filter(filter => filter !== 'note.sourcing_example != true'), 'note.sourcing_example == true'];
    for (const view of document.views) { view.notebookRoot = this.root; view.notebookBasePath = path; }
    return stringifyYaml(document, { lineWidth: 0 });
  }
  private moveOptions(): { rawCaptureRoots: string[]; opaqueSubtrees?: string[]; ignoredPaths?: string[]; writeBoundary?: string } {
    if (this.mode === 'examples') return { rawCaptureRoots: [this.root], opaqueSubtrees: [this.root + '/System/Visit operations'], ignoredPaths: [this.root + '/System/Practice state.json'], writeBoundary: this.options.writeBoundary ?? this.root };
    return { rawCaptureRoots: [this.root, ...this.settings.previousRoots].map(root => root + '/Examples'),
      opaqueSubtrees: [this.root + '/Examples/System/Migration backups', this.root + '/System/Visit operations', this.root + '/Examples/System/Visit operations'] };
  }
  async updateMapView(path: string, viewName: string, key: 'center' | 'defaultZoom', value: unknown): Promise<void> {
    return this.serial(async () => {
      if (this.mode !== 'examples') throw new Error('Use the map view controls for the real notebook.');
      this.guard(path);
      if (!path.endsWith('.base') || !viewName || !['center', 'defaultZoom'].includes(key)) throw new Error('Choose a practice Base view.');
      if (key === 'defaultZoom' && (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 22)) throw new Error('Choose a zoom from 1 to 22.');
      if (key === 'center') {
        let coordinates: unknown = value;
        if (typeof value === 'string') { try { coordinates = JSON.parse(value); } catch { throw new Error('Choose a valid map centre.'); } }
        const valid = validateCoordinates(coordinates); if (!valid) throw new Error('Choose a valid map centre.');
        value = JSON.stringify(valid);
      }
      await this.app.vault.process(this.file(path), text => {
        const document: unknown = parseYaml(text);
        if (!isRecord(document) || !isUnknownArray(document.views) || !document.views.every(isRecord)) throw new Error('This Base has invalid views.');
        const views = document.views.filter(view => view.name === viewName);
        if (views.length !== 1 || views[0].notebookRoot !== this.root || views[0].notebookBasePath !== path) throw new Error('This map no longer belongs to the practice notebook.');
        views[0][key] = value;
        return stringifyYaml(document, { lineWidth: 0 });
      });
    });
  }
  private async asset(path: string, content: string, report: SetupReport): Promise<void> {
    if (path.endsWith('.base')) content = this.contextBase(content, path);
    this.guard(path); await this.folder(path.slice(0, path.lastIndexOf('/')));
    const file = this.app.vault.getAbstractFileByPath(path), hash = await hashText(content);
    if (!file) { await this.app.vault.create(path, content); report.created.push(path); }
    else if (isFile(file)) {
      const current = await this.app.vault.read(file);
      if (current === content) { /* Already current. */ }
      else if (this.settings.assets[path]?.hash === await hashText(current)) {
        await this.app.vault.process(file, text => {
          if (text !== current) throw new Error('Generated component changed during repair.'); return content;
        }); report.updated.push(path);
      } else {
        // Marker removal is expressly requested even for edited plugin scaffolding; preserve all enclosed content.
        const stripped = path.endsWith('.md') ? stripCodexMarkers(current) : current;
        if (stripped !== current) {
          await this.app.vault.process(file, text => { if (text !== current) throw new Error('Generated component changed during repair.'); return stripped; });
          report.updated.push(path);
        }
        report.conflicts.push(path); return;
      }
    } else { report.conflicts.push(path); return; }
    this.settings.assets[path] = { hash, version: ASSET_VERSION };
  }
  private async clipperBundle(): Promise<{ release: string; fingerprint: string; templates: Omit<ClipperTemplateStatus, 'exportState' | 'confirmedAt'>[] }> {
    const definitions = createClipperTemplates(this.root, this.app.vault.getName());
    const templates = await Promise.all((['shop', 'parking'] as const).map(async kind => {
      const template = definitions[kind], json = JSON.stringify(template, null, 2) + '\n';
      return { kind, name: template.name, path: this.paths.templates + '/Web Clipper/Capture ' + (kind === 'shop' ? 'source' : kind) + '.json', json, fingerprint: await hashText(json) };
    }));
    return { release: CLIPPER_TEMPLATE_RELEASE, fingerprint: await hashText(JSON.stringify(templates.map(template => [template.kind, template.fingerprint]))), templates };
  }
  async getClipperStatus(): Promise<ClipperStatus> {
    const bundle = await this.clipperBundle();
    const templates = await Promise.all(bundle.templates.map(async template => {
      const file = this.app.vault.getAbstractFileByPath(template.path);
      const exportState = !file ? 'missing' as const : isFile(file) && await this.app.vault.read(file) === template.json ? 'current' as const : 'edited' as const;
      const confirmation = this.settings.clipperImports?.[template.kind];
      return { ...template, exportState, confirmedAt: confirmation?.fingerprint === template.fingerprint ? confirmation.confirmedAt : null };
    }));
    return { ...bundle, templates };
  }
  async refreshClipperTemplates(): Promise<SetupReport> {
    if (this.mode === 'examples') throw new Error('Practice captures are reviewed explicitly. Browser templates belong to the real notebook.');
    return this.serial(async () => {
      if (!this.settings.setupVersion || !this.app.vault.getAbstractFileByPath(this.root)) throw new Error('Set up the sourcing notebook before preparing Web Clipper templates.');
      const bundle = await this.clipperBundle(), report: SetupReport = { created: [], updated: [], conflicts: [] };
      for (const template of bundle.templates) {
        await this.asset(template.path, template.json, report);
        // Record each successful file before another write so interrupted refresh can resume.
        await this.saveSettings();
      }
      return report;
    });
  }
  async confirmClipperImport(kind: PlaceKind, fingerprint: string): Promise<void> {
    if (this.mode === 'examples') throw new Error('Examples does not install browser templates.');
    return this.serial(async () => {
      const status = await this.getClipperStatus();
      const template = status.templates.find(value => value.kind === kind);
      if (!template || template.fingerprint !== fingerprint) throw new Error('The Web Clipper template changed. Review the current template before confirming its import.');
      const previous = this.settings.clipperImports;
      this.settings.clipperImports = { ...previous, [kind]: { fingerprint, release: status.release, confirmedAt: new Date().toISOString() } };
      try { await this.saveSettings(); } catch (error) { this.settings.clipperImports = previous; throw error; }
    });
  }
  async markClipperNoticeSeen(fingerprint: string): Promise<void> {
    if (this.mode === 'examples') throw new Error('Examples does not install browser templates.');
    return this.serial(async () => {
      if ((await this.getClipperStatus()).fingerprint !== fingerprint) throw new Error('The Web Clipper templates changed. Review their current versions.');
      const previous = this.settings.clipperNoticeFingerprint;
      this.settings.clipperNoticeFingerprint = fingerprint;
      try { await this.saveSettings(); } catch (error) { this.settings.clipperNoticeFingerprint = previous; throw error; }
    });
  }
  async inspectExistingNotebook(root: string): Promise<AttachmentPreview> {
    if (this.mode === 'examples') throw new Error('Notebook attachment is illustrated in Examples; it does not change your real notebook.');
    return (await inspectNotebook(this.app, this.settings, root)).preview;
  }
  async attachExistingNotebook(root: string, previewFingerprint: string): Promise<AttachmentPreview> {
    if (this.mode === 'examples') throw new Error('Notebook attachment is illustrated in Examples; it does not change your real notebook.');
    return this.serial(async () => {
      const inspected = await inspectNotebook(this.app, this.settings, root), preview = inspected.preview;
      if (preview.fingerprint !== previewFingerprint) throw new Error('The notebook changed since the preview. Inspect it again before attaching.');
      if (preview.blockers.length) throw new Error(preview.blockers.join('\n'));
      const previous = structuredClone(this.settings);
      this.settings.root = preview.root; this.settings.setupVersion = ASSET_VERSION;
      this.settings.assets = inspected.assets;
      this.settings.captureReceipts = inspected.captureReceipts;
      this.settings.captureSnapshots = inspected.captureSnapshots;
      this.settings.previousRoots = [...new Set(previous.previousRoots ?? [])].filter(value => value !== preview.root);
      this.settings.recentLocalities = (previous.recentLocalities ?? []).filter(path => path.startsWith(preview.root + '/Places/'));
      this.settings.areaHints = (previous.areaHints ?? []).filter(hint => hint.townPath.startsWith(preview.root + '/Places/') && hint.localityPath.startsWith(preview.root + '/Places/'));
      if (this.settings.shortTripDefaults?.startPath && !this.scoped(this.settings.shortTripDefaults.startPath)) delete this.settings.shortTripDefaults.startPath;
      delete this.settings.clipperImports; delete this.settings.clipperNoticeFingerprint;
      try { await this.saveSettings(); }
      catch (error) { for (const key of Object.keys(this.settings)) delete (this.settings as unknown as Record<string, unknown>)[key]; Object.assign(this.settings, previous); throw error; }
      return preview;
    });
  }
  /** Explicit reviewed preferences share this notebook's mutation queue and roll back on failed persistence. */
  async rememberShortTripDefaults(value?: ShortTripDefaults): Promise<void> {
    return this.serial(async () => {
      const next = value === undefined ? undefined : checkedShortTripDefaults(value, this.root);
      if (next?.startPath && !(await this.listPlaces()).some(place => place.path === next.startPath && validateCoordinates(place.coordinates)))
        throw Error('Choose a saved starting place with valid coordinates before remembering these choices.');
      const previous = this.settings.shortTripDefaults;
      if (next === undefined) delete this.settings.shortTripDefaults; else this.settings.shortTripDefaults = structuredClone(next);
      try { await this.saveSettings(); }
      catch (error) {
        if (previous === undefined) delete this.settings.shortTripDefaults; else this.settings.shortTripDefaults = previous;
        throw error;
      }
    });
  }
  async setup(): Promise<SetupReport> {
    if (this.mode === 'examples') throw new Error('Practice components are added explicitly with Add examples; setup and repair cannot recreate them.');
    return this.serial(async () => {
      const root = this.root;
      const contents = this.app.vault.getFiles().filter(f => f.path.startsWith(root + '/'));
      if (!this.settings.setupVersion && contents.length && !Object.keys(this.settings.assets).some(p => p.startsWith(root + '/'))) throw new Error('Choose an empty folder; this folder already contains unrelated files.');
      const report: SetupReport = { created: [], updated: [], conflicts: [] };
      for (const dir of ['', '/Places', '/Visits', '/Outings', '/Capture inbox', '/System', '/System/Capture archive', '/System/Templates/Web Clipper']) await this.folder(root + dir);
      for (const [path, text] of Object.entries(bundledAssets(root, this.app.vault.getName()))) {
        await this.asset(path, text, report);
        // Persist ownership after each file so interrupted setup can resume.
        await this.saveSettings();
      }
      for (const template of (await this.clipperBundle()).templates) {
        await this.asset(template.path, template.json, report);
        await this.saveSettings();
      }
      this.settings.setupVersion = ASSET_VERSION; await this.saveSettings(); return report;
    });
  }
  async listLocalities(): Promise<LocalityRecord[]> {
    const entries: { path: string; name: string; parentPath: string }[] = [];
    const files = notebookFiles(this.app.vault, this.root).filter(f => this.scoped(f.path) && (f.path.startsWith(this.paths.places + '/') || f.path.startsWith(this.root + '/Localities/')));
    for (const file of files) {
      try {
        const { properties } = readNote(await this.app.vault.read(file));
        if ((this.mode === 'examples' || properties.sourcing_example !== true) && Array.isArray(properties.tags) && properties.tags.includes('sourcing-locality')) {
          let parentPath = linkPath(properties.parent_locality);
          if (parentPath && !parentPath.includes('/')) {
            const candidates = files.filter(f => f.basename === parentPath.replace(/\.md$/, ''));
            if (candidates.length === 1) parentPath = candidates[0].path;
          }
          entries.push({ path: file.path, name: typeof properties.area_name === 'string' ? properties.area_name : file.basename, parentPath });
        }
      } catch { /* Invalid user-edited YAML is left untouched. */ }
    }
    return resolveLocalities(entries);
  }
  async ensureLocality(name: string, parentPath = ''): Promise<LocalityRecord> {
    return this.serial(() => this.createLocality(name, parentPath));
  }
  private async createLocality(name: string, parentPath = ''): Promise<LocalityRecord> {
    const clean = validLocalityName(name), localities = await this.listLocalities();
    const parent = parentPath ? localities.find(l => l.path === parentPath) : undefined;
    if (parentPath && !parent) throw new Error('Choose a valid parent area.');
    const existing = localities.find(l => l.parentPath === parentPath && l.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
    if (existing) { await this.localityAssets(existing); return existing; }
    const segments = [...(parent?.segments ?? []), clean];
    const path = this.paths.area(segments);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A note already uses that area name.');
    const locality: LocalityRecord = { path, name: clean, parentPath, segments, label: segments.join(' → ') };
    await this.folder(path.slice(0, path.lastIndexOf('/')));
    await this.app.vault.create(path, writeNote({
      ...(this.mode === 'examples' ? { sourcing_example: true } : {}), tags: ['sourcing-locality'], area_name: clean, parent_locality: parentPath ? wiki(parentPath) : '',
    }, '```charity-sourcing\nview: locality\n```\n\n## Notes\n\n'));
    await this.localityAssets(locality); return locality;
  }
  private async localityAssets(locality: LocalityRecord): Promise<void> {
    await this.folder(this.paths.places + '/' + locality.segments.join('/'));
    await this.saveSettings();
  }
  async listPlaces(): Promise<PlaceRecord[]> {
    const places: PlaceRecord[] = [];
    for (const file of notebookFiles(this.app.vault, this.root).filter(f => this.scoped(f.path) && (f.path.startsWith(this.paths.places + '/') || f.path.startsWith(this.root + '/Sources/') || f.path.startsWith(this.root + '/Shops/') || f.path.startsWith(this.root + '/Parking/')))) {
      try {
        const { properties: p } = readNote(await this.app.vault.read(file));
        if (this.mode === 'live' && p.sourcing_example === true) continue;
        const tags = Array.isArray(p.tags) ? p.tags : [];
        const kind = (tags.includes('sourcing-source') || tags.includes('charity-shop')) ? 'shop' : tags.includes('parking') ? 'parking' : null;
        if (kind) places.push({ path: file.path, name: placeDisplayName(p, file.basename),
          kind, locality: linkPath(p.locality), coordinates: validateCoordinates(p.coordinates), properties: p });
      } catch { /* Ignore invalid notes without modifying them. */ }
    }
    return places;
  }
  isCapturePath(path: string): boolean {
    return [this.root, ...this.settings.previousRoots].some(root => path.startsWith(root + '/Capture inbox/') && migrationEligible(path));
  }
  async captures(): Promise<TFile[]> {
    const result: TFile[] = [];
    const inboxes = [...new Set([this.root, ...this.settings.previousRoots])].flatMap(root => notebookFiles(this.app.vault, root + '/Capture inbox'));
    for (const file of inboxes.filter(f => f.extension === 'md' && this.isCapturePath(f.path))) {
      try { const p = readNote(await this.app.vault.read(file)).properties; if (p.sourcing_capture === 1 && (this.mode === 'examples' || p.sourcing_example !== true)) result.push(file); } catch { /* Keep malformed captures available. */ }
    }
    return result.sort((a, b) => a.stat.ctime - b.stat.ctime);
  }
  async draft(file: TFile): Promise<CaptureDraft> {
    return this.serial(async () => {
      if (!this.isCapturePath(file.path)) throw new Error('Select a note in Capture inbox.');
      const raw = await this.app.vault.read(file), props = readNote(raw).properties;
      if (this.mode === 'live' && props.sourcing_example === true) throw new Error('Fictional captures can only be reviewed inside Examples.');
      const draft = parseCapture(props, file.path), revision = await hashText(raw);
      const previous = this.settings.captureSnapshots[file.path];
      if (previous?.reviewRequired) throw new Error('This pending capture has no verified identity on this device. Review it on the originating desktop before saving; the raw capture has been preserved.');
      draft.captureId = previous?.revision === revision ? previous.captureId : await hashText(file.path + '\n' + raw);
      draft.sourceRevision = revision;
      if (draft.kind === 'shop') draft.sourceType ??= this.settings.defaultSourceType;
      this.settings.captureSnapshots[file.path] = { captureId: draft.captureId, revision };
      await this.saveSettings(); return draft;
    });
  }
  private async captureSource(draft: CaptureDraft): Promise<TFile | null> {
    if (!draft.sourcePath) return null;
    if (this.settings.captureSnapshots[draft.sourcePath]?.reviewRequired) throw new Error('This pending capture needs review on the originating desktop before saving; the raw capture has been preserved.');
    const candidates = [...new Set([
      draft.sourcePath,
      ...Object.entries(this.settings.captureSnapshots).filter(([, v]) => v.captureId === draft.captureId).map(([path]) => path),
      ...[this.root, ...this.settings.previousRoots].flatMap(root => [root + '/System/Capture archive/' + draft.captureId + '.md', root + '/Capture archive/' + draft.captureId + '.md']),
    ])];
    for (const path of candidates) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!isFile(file)) continue;
      if (this.settings.captureSnapshots[path]?.reviewRequired) throw new Error('This pending capture needs review on the originating desktop before saving; the raw capture has been preserved.');
      if (!this.isCapturePath(path) && ![this.root, ...this.settings.previousRoots].some(root => path === root + '/Capture archive/' + draft.captureId + '.md' || path === root + '/System/Capture archive/' + draft.captureId + '.md')) continue;
      const raw = await this.app.vault.read(file), revision = await hashText(raw);
      if (this.mode === 'live' && readNote(raw).properties.sourcing_example === true) throw new Error('Fictional captures can only be reviewed inside Examples.');
      const matches = draft.sourceRevision ? revision === draft.sourceRevision : await hashText(draft.sourcePath + '\n' + raw) === draft.captureId;
      if (!matches) throw new Error('The capture changed. Reopen its review before saving.');
      return file;
    }
    throw new Error('The capture is missing. Reopen its review before saving.');
  }

  private assertFolderSlots(path: string): void {
    this.guard(path + '/placeholder');
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) if (isFile(this.app.vault.getAbstractFileByPath(parts.slice(0, i).join('/')))) throw new Error('A file occupies the required folder: ' + parts.slice(0, i).join('/'));
  }
  private assertDestination(path: string, currentPath = ''): void {
    this.guard(path); this.assertFolderSlots(path.slice(0, path.lastIndexOf('/')));
    const occupied = this.app.vault.getAbstractFileByPath(path);
    if (occupied && path !== currentPath) throw new Error('That note already exists. Open it or choose a different filename.');
    if (this.app.vault.getFiles().some(file => file.path !== currentPath && file.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error('That filename is already in use.');
  }
  private async planArea(selection: string | AreaSelection): Promise<AreaPlan> {
    const localities = await this.listLocalities();
    const rootFor = (leaf: LocalityRecord): LocalityRecord => {
      let town = leaf;
      while (town.parentPath) {
        const parent = localities.find(record => record.path === town.parentPath);
        if (!parent) throw new Error('The selected area has a missing parent. Repair it before saving.');
        town = parent;
      }
      return town;
    };
    let town: LocalityRecord | undefined, leaf: LocalityRecord | undefined;
    const missing: LocalityRecord[] = [];
    if (typeof selection === 'string') {
      leaf = localities.find(record => record.path === selection);
      if (!leaf) throw new Error('Choose an existing locality or create it first.');
      town = rootFor(leaf);
    } else {
      if (!selection.town.trim()) throw new Error('Enter a town or city before saving.');
      const townName = validLocalityName(selection.town);
      if (selection.townPath) {
        town = localities.find(record => record.path === selection.townPath);
        if (!town || town.parentPath || town.name.toLocaleLowerCase() !== townName.toLocaleLowerCase()) throw new Error('Choose the town again; its saved selection no longer matches.');
      } else town = localities.find(record => !record.parentPath && record.name.toLocaleLowerCase() === townName.toLocaleLowerCase());
      if (!town) {
        town = { path: this.paths.area([townName]), name: townName, parentPath: '', segments: [townName], label: townName };
        this.assertDestination(town.path); missing.push(town);
      }
      const localityName = selection.locality.trim();
      if (localityName) {
        validLocalityName(localityName);
        if (selection.localityPath) {
          leaf = localities.find(record => record.path === selection.localityPath);
          if (!leaf || !leaf.parentPath || rootFor(leaf).path !== town.path || leaf.name.toLocaleLowerCase() !== localityName.toLocaleLowerCase()) throw new Error('Choose the smaller locality again; it no longer belongs to the selected town.');
        } else leaf = localities.find(record => record.parentPath === town!.path && record.name.toLocaleLowerCase() === localityName.toLocaleLowerCase());
        if (!leaf) {
          const segments = [...town.segments, localityName];
          leaf = { path: this.paths.area(segments), name: localityName, parentPath: town.path, segments, label: segments.join(' → ') };
          this.assertDestination(leaf.path); missing.push(leaf);
        }
      } else {
        if (selection.localityPath) throw new Error('Clear the smaller locality selection or enter its name.');
        leaf = town;
      }
    }
    const chain: LocalityRecord[] = [leaf];
    while (chain[0].parentPath) {
      const parent = [...localities, ...missing].find(record => record.path === chain[0].parentPath);
      if (!parent) throw new Error('The selected area has a missing parent.');
      chain.unshift(parent);
    }
    const creations = missing.map(record => record.path);
    return { town: town, leaf: leaf, chain, missing, creations };
  }
  private async materializeArea(plan: AreaPlan): Promise<LocalityRecord> {
    for (const record of plan.chain) {
      if (plan.missing.some(value => value.path === record.path)) await this.createLocality(record.name, record.parentPath);
    }
    const actual = (await this.listLocalities()).find(record => record.path === plan.leaf.path);
    if (!actual) throw new Error('The area could not be created. Your capture is still available.');
    return actual;
  }
  private sourceType(value: string | undefined): string {
    const type = (value ?? this.settings.defaultSourceType).trim();
    if (!type || type.length > 80 || /[\r\n]/.test(type)) throw new Error('Enter a source type up to 80 characters.');
    return type;
  }
  private rememberedHint(phrase: string, plan: AreaPlan): AreaHint {
    const clean = phrase.trim().replace(/\s+/g, ' '), normalized = normalizeAreaPhrase(clean);
    if (!normalized || clean.length > 160) throw new Error('Enter a memorable address phrase up to 160 characters.');
    const target = plan.leaf.path;
    const matches = this.settings.areaHints.filter(hint => hint.townPath === plan.town.path && normalizeAreaPhrase(hint.phrase) === normalized);
    if (matches.some(hint => hint.localityPath !== target) || matches.length > 1) throw new Error('This address phrase already has another area mapping. Review it in settings before saving.');
    return { id: matches[0]?.id ?? crypto.randomUUID(), phrase: clean, townPath: plan.town.path, localityPath: target, enabled: true };
  }
  private async applyCaptureChoices(place: PlaceRecord, options: CaptureSaveOptions): Promise<void> {
    const sourceType = options.makeDefaultSourceType && place.kind === 'shop' ? this.sourceType(typeof place.properties.source_type === 'string' ? place.properties.source_type : undefined) : undefined;
    const hint = options.rememberHint ? this.rememberedHint(options.rememberHint.phrase, await this.planArea(place.locality)) : undefined;
    if (sourceType) this.settings.defaultSourceType = sourceType;
    if (hint) this.settings.areaHints = [...this.settings.areaHints.filter(value => value.id !== hint.id), hint];
    await this.saveSettings();
  }
  async saveAreaHint(hint: AreaHint): Promise<void> {
    return this.serial(async () => {
      const clean: AreaHint = { ...hint, id: hint.id.trim() || crypto.randomUUID(), phrase: hint.phrase.trim().replace(/\s+/g, ' '), enabled: hint.enabled === true };
      if (!normalizeAreaPhrase(clean.phrase) || clean.phrase.length > 160) throw new Error('Enter an address phrase up to 160 characters.');
      const old = this.settings.areaHints.find(value => value.id === clean.id);
      const unchangedDisabledTarget = !clean.enabled && old?.townPath === clean.townPath && old?.localityPath === clean.localityPath;
      if (!unchangedDisabledTarget) {
        const records = await this.listLocalities(), town = records.find(record => record.path === clean.townPath), locality = records.find(record => record.path === clean.localityPath);
        if (!town || town.parentPath) throw new Error('Choose an existing town for this address phrase.');
        if (!locality || !localitySubtree(town.path, records).some(record => record.path === locality.path)) throw new Error('Choose this town or a smaller locality within it.');
      }
      if (clean.enabled && this.settings.areaHints.some(value => value.enabled && value.id !== clean.id && value.townPath === clean.townPath && normalizeAreaPhrase(value.phrase) === normalizeAreaPhrase(clean.phrase))) throw new Error('That address phrase already has a mapping in this town. Edit the existing mapping.');
      this.settings.areaHints = [...this.settings.areaHints.filter(value => value.id !== clean.id), clean]; await this.saveSettings();
    });
  }
  async removeAreaHint(id: string): Promise<void> {
    return this.serial(async () => { this.settings.areaHints = this.settings.areaHints.filter(hint => hint.id !== id); await this.saveSettings(); });
  }

  private contactValues(input: { website?: string; telephone?: string }): { website: string; telephone: string } {
    if (input.website !== undefined && typeof input.website !== 'string') throw new Error('Enter a website address as text, or leave it blank.');
    if (input.telephone !== undefined && typeof input.telephone !== 'string') throw new Error('Enter the telephone number as text to preserve its leading zero or plus sign.');
    const rawWebsite = input.website?.trim() ?? '', website = websiteUrl(rawWebsite);
    if (rawWebsite && !website) throw new Error('Enter a valid http or https website address, or leave it blank.');
    return { website, telephone: input.telephone?.trim() ?? '' };
  }
  async updateContact(path: string, input: { website: string; telephone: string }, expected?: { website?: unknown; telephone?: unknown }): Promise<void> {
    return this.serial(async () => {
      const contacts = this.contactValues(input);
      if (!(await this.listPlaces()).some(place => place.path === path)) throw new Error('Choose a source or parking note.');
      await this.app.vault.process(this.file(path), text => {
        const properties = readNote(text).properties;
        if (expected && (['website', 'telephone'] as const).some(key =>
          Object.hasOwn(expected, key) && JSON.stringify(properties[key]) !== JSON.stringify(expected[key])
        )) throw new Error('Contact details changed in another view. Reopen Edit contacts and review the latest values before saving.');
        return updateNoteProperty(updateNoteProperty(text, 'website', contacts.website), 'telephone', contacts.telephone);
      });
    });
  }
  private async refreshDraft(draft: CaptureDraft): Promise<CaptureDraft> {
    if (!draft.sourcePath || !draft.sourceRevision || draft.kind !== 'shop') throw new Error('Reopen a source capture to review its updates.');
    const source = await this.captureSource(draft);
    if (!source) throw new Error('The raw capture is missing. Reopen its review.');
    const raw = await this.app.vault.read(source), revision = await hashText(raw);
    if (revision !== draft.sourceRevision) throw new Error('The capture changed. Reopen its review before saving.');
    const trusted = Object.values(this.settings.captureSnapshots).some(snapshot => !snapshot.reviewRequired && snapshot.captureId === draft.captureId && snapshot.revision === revision);
    if (!trusted && await hashText(draft.sourcePath + '\n' + raw) !== draft.captureId)
      throw new Error('This capture identity could not be verified. Reopen it on the originating desktop.');
    const current = parseCapture(readNote(raw).properties, draft.sourcePath);
    if (current.kind !== 'shop') throw new Error('Parking refresh is not supported.');
    return { ...current, captureId: draft.captureId, sourcePath: draft.sourcePath, sourceRevision: revision };
  }
  async captureRefreshMatches(draft: CaptureDraft): Promise<PlaceRecord[]> {
    if (draft.kind !== 'shop') return [];
    const current = await this.refreshDraft(draft);
    return (await this.listPlaces()).filter(place => place.properties.source_capture_id !== draft.captureId && captureMatchesSource(current, place));
  }
  async previewCaptureRefresh(draft: CaptureDraft, targetPath: string): Promise<CaptureRefreshPreview> {
    const current = await this.refreshDraft(draft);
    const places = await this.listPlaces(), place = places.find(place => place.path === targetPath && place.kind === 'shop');
    if (!place) throw new Error('The source note is no longer available. Reopen the capture review.');
    const raw = await this.app.vault.read(this.file(targetPath)), properties = readNote(raw).properties;
    const blocked = (await this.outings.list()).some(outing => outing.operation?.sourcePath === targetPath);
    const preview = buildCaptureRefreshPreview(current, { ...place, properties }, raw, blocked);
    if (this.settings.migration) preview.blockers.push('An interrupted archive or move needs recovery. Open Reseller sourcing Setup and use the guarded move recovery before finishing this capture. Backups: ' + this.settings.migration.backupRoot);
    const applied = places.filter(value => !!refreshReceiptFor(value.properties, current));
    if (applied.some(value => value.path !== targetPath)) preview.blockers.push('This capture has a refresh receipt in another source note. Inspect the records before retrying.');
    return preview;
  }
  async applyCaptureRefresh(draft: CaptureDraft, preview: CaptureRefreshPreview, selectedFields: CaptureRefreshField[]): Promise<TFile> {
    return this.serial(async () => {
      const current = await this.refreshDraft(draft);
      if (preview.captureId !== current.captureId || preview.captureRevision !== current.sourceRevision) throw new Error('The capture changed. Reopen its review before saving.');
      const fresh = await this.previewCaptureRefresh(current, preview.targetPath);
      if (fresh.blockers.length) throw new Error(fresh.blockers.join('\n'));
      const target = this.file(fresh.targetPath);
      const knownReceipt = this.settings.captureReceipts[current.captureId];
      if (knownReceipt && knownReceipt !== target.path) throw new Error('The capture receipt points to another source note. Inspect both records before applying updates.');
      // An atomically saved portable receipt wins over a stale comparison: recovery only finishes settings/archive.
      if (!fresh.completed) {
        if (fresh.fingerprint !== preview.fingerprint) throw new Error('The source changed. Refresh the comparison and review your selection before saving.');
        const patch = captureRefreshPatch(fresh, selectedFields), appliedAt = new Date().toISOString();
        const before = readNote(await this.app.vault.read(target)).properties;
        const receipt: CaptureRefreshReceipt = { captureId: current.captureId, captureRevision: current.sourceRevision, appliedAt,
          fields: [...selectedFields], captureUrl: current.url, captureIdentity: canonicalPlaceIdentity(current.url), targetSourceCaptureId: propertyText(before.source_capture_id) };
        await this.refreshDraft(current);
        await this.app.vault.process(target, raw => {
          const properties = readNote(raw).properties;
          const record: PlaceRecord = { path: target.path, name: target.basename, kind: 'shop', locality: linkPath(properties.locality), coordinates: validateCoordinates(properties.coordinates), properties };
          const checked = buildCaptureRefreshPreview(current, record, raw);
          if (checked.blockers.length || checked.fingerprint !== fresh.fingerprint) throw new Error('The source changed. Refresh the comparison and review your selection before saving.');
          let updated = raw;
          for (const [key, value] of Object.entries(patch)) updated = updateNoteProperty(updated, key, value);
          return updateNoteProperty(updated, 'source_refresh_receipts', [...captureRefreshReceipts(properties), receipt]);
        });
      }
      const previous = this.settings.captureReceipts[current.captureId];
      if (previous && previous !== target.path) throw new Error('The updates are saved, but the capture receipt points to another note. Inspect both records before retrying.');
      this.settings.captureReceipts[current.captureId] = target.path;
      try { await this.saveSettings(); await this.archiveCapture(current); }
      catch (error) { throw new Error('The source decision is saved. Retry to finish archiving this capture; its updates will not be applied again. ' + (error instanceof Error ? error.message : String(error))); }
      return target;
    });
  }
  async saveCapture(draft: CaptureDraft, localityPath: string | AreaSelection, filename: string, options: CaptureSaveOptions = {}): Promise<TFile> {
    return this.serial(async () => {
      await this.captureSource(draft);
      const receipt = this.settings.captureReceipts[draft.captureId];
      const places = await this.listPlaces();
      if (receipt && isFile(this.app.vault.getAbstractFileByPath(receipt))) {
        const saved = places.find(p => p.path === receipt && p.kind === draft.kind && p.properties.source_capture_id === draft.captureId);
        if (!saved) throw new Error('The saved capture receipt no longer identifies its source note. Inspect both notes before retrying.');
        await this.applyCaptureChoices(saved, options); await this.archiveCapture(draft); return this.file(receipt);
      }
      const matching = places.filter(p => p.properties.source_capture_id === draft.captureId);
      if (matching.length > 1 || (matching.length === 1 && matching[0].kind !== draft.kind)) throw new Error('The capture matches conflicting saved records. Inspect them before retrying.');
      const prior = matching[0];
      if (prior) { this.settings.captureReceipts[draft.captureId] = prior.path; await this.applyCaptureChoices(prior, options); await this.archiveCapture(draft); return this.file(prior.path); }
      const contacts = this.contactValues(draft);
      const unassigned = options.allowUnassigned && !draft.sourcePath && typeof localityPath !== 'string' && !localityPath.town.trim() && !localityPath.locality.trim();
      const area = unassigned ? undefined : await this.planArea(localityPath);
      const locality = area?.leaf ?? { path: '', segments: [] as string[] };
      if (!draft.name.trim()) throw new Error('Enter a place name.');
      if (draft.coordinates !== null && !validateCoordinates(draft.coordinates)) throw new Error('Coordinates are invalid.');
      if (draft.url) {
        let parsed: URL; try { parsed = new URL(draft.url); } catch { throw new Error('Use a valid Google Maps link, or leave it blank.'); }
        if (!isGoogleMapsUrl(draft.url) && !(parsed.protocol === 'https:' && (parsed.hostname === 'maps.app.goo.gl' || (parsed.hostname === 'goo.gl' && parsed.pathname.startsWith('/maps/'))))) throw new Error('Use a Google Maps listing or shared link.');
        const id = canonicalPlaceIdentity(draft.url);
        const duplicate = (await this.listPlaces()).find(p => p.kind === draft.kind && typeof p.properties.google_maps_url === 'string' &&
          (p.properties.google_maps_url === draft.url || (id && canonicalPlaceIdentity(p.properties.google_maps_url) === id)));
        if (duplicate) throw new Error('This Google listing already has a note: ' + duplicate.path + '. Update that note instead.');
      }
      const safe = safeFileName(filename.replace(/\.md$/i, ''));
      if (safe.toLowerCase() === 'area') throw Error('Area.md is reserved for the area record. Choose a different filename.');
      if (!safe || safe !== filename.replace(/\.md$/i, '').trim() || safe.length > 180) throw new Error('Choose a valid filename, up to 180 characters.');
      const path = this.paths.place(locality.segments, safe);
      this.assertDestination(path);
      const sourceType = draft.kind === 'shop' ? this.sourceType(draft.sourceType) : '';
      if (draft.googleRating !== null && (!Number.isFinite(draft.googleRating) || draft.googleRating < 0 || draft.googleRating > 5)) throw new Error('Google score must be from 0 to 5, or blank.');
      if (draft.googleReviewCount !== null && (!Number.isSafeInteger(draft.googleReviewCount) || draft.googleReviewCount < 0)) throw new Error('Review count must be a non-negative whole number, or blank.');
      const hint = options.rememberHint && area ? this.rememberedHint(options.rememberHint.phrase, area) : undefined;
      await this.captureSource(draft);
      if (area) await this.materializeArea(area);
      await this.folder(path.slice(0, path.lastIndexOf('/')));
      await this.captureSource(draft);
      const p = placeProperties(draft.kind, locality.path, sourceType);
      if (this.mode === 'examples') p.sourcing_example = true;
      Object.assign(p, { ...contacts, google_name: draft.name.trim(), google_maps_url: draft.url, address: draft.address,
        coordinates: draft.coordinates ?? [], google_checked: draft.url ? draft.capturedAt.slice(0, 10) : null, source_capture_id: draft.captureId });
      if (draft.kind === 'shop') {
        p.google_rating = draft.googleRating; p.google_review_count = draft.googleReviewCount; p.google_review_topics = draft.topics;
        p.google_hours = draft.hours; p.google_hours_checked = draft.hours.length ? draft.capturedAt.slice(0, 10) : null;
        p.google_review_topics_checked = draft.topics.length ? draft.capturedAt.slice(0, 10) : null;
        const areaSlugs = [...locality.segments, draft.address.match(/,\s*([^,]+?)\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[1] ?? ''].filter(Boolean).map(v => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
        let brand = draft.brandTag.replace(/^(?:charity-shop|source)\//, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        for (const area of areaSlugs) brand = brand.replace(new RegExp('(^|-)' + area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=-|$)', 'g'), '$1');
        brand = brand.replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (brand) (p.tags as string[]).push('source/' + brand);
      }
      const file = await this.app.vault.create(path, writeNote(p, bodyForPlace(draft)));
      this.settings.captureReceipts[draft.captureId] = path;
      if (locality.path) this.settings.recentLocalities = [locality.path, ...this.settings.recentLocalities.filter(path => path !== locality.path)].slice(0, 10);
      if (draft.kind === 'shop' && !this.settings.sourceTypes.includes(sourceType)) this.settings.sourceTypes.push(sourceType);
      if (options.makeDefaultSourceType && draft.kind === 'shop') this.settings.defaultSourceType = sourceType;
      if (hint) this.settings.areaHints = [...this.settings.areaHints.filter(value => value.id !== hint.id), hint];
      await this.saveSettings();
      await this.archiveCapture(draft); return file;
    });
  }
  /** Read-only preflight for a durable manual preparation, before locking its completion. */
  async validatePlacePreparation(draft: CaptureDraft, selection: AreaSelection, filename: string): Promise<void> {
    this.writable();
    this.contactValues(draft);
    if (!draft.name.trim()) throw Error('Enter a place name.');
    if (draft.coordinates !== null && !validateCoordinates(draft.coordinates)) throw Error('Coordinates are invalid.');
    const area = selection.town.trim() || selection.locality.trim() ? await this.planArea(selection) : undefined;
    if (draft.url) {
      let url: URL; try { url = new URL(draft.url); } catch { throw Error('Use a valid Google Maps link, or leave it blank.'); }
      if (!isGoogleMapsUrl(draft.url) && !(url.protocol === 'https:' && (url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')))) throw Error('Use a Google Maps listing or shared link.');
      const id = canonicalPlaceIdentity(draft.url);
      if ((await this.listPlaces()).some(p => p.properties.source_capture_id !== draft.captureId && p.kind === draft.kind && (p.properties.google_maps_url === draft.url || id && canonicalPlaceIdentity(propertyText(p.properties.google_maps_url)) === id))) throw Error('This Google listing already has a note. Update that note instead.');
    }
    if (safeFileName(filename) !== filename || !filename || filename.length > 180) throw Error('Choose a valid filename.');
    if (filename.toLowerCase() === 'area') throw Error('Area.md is reserved for the area record. Choose a different filename.');
    this.assertDestination(this.paths.place(area?.leaf.segments ?? [], filename));
    if (draft.kind === 'shop') this.sourceType(draft.sourceType);
  }
  private async executePlan(preview: MovePreview): Promise<MoveReport> {
    await this.assertPlaceEditMovesAllowed(new Set(preview.entries.filter(entry => entry.from !== entry.to || entry.text !== undefined).map(entry => entry.from)));
    if (this.mode === 'examples') {
      const root = this.options.writeBoundary ?? this.root, state = root + '/System/Practice state.json';
      if (preview.fromRoot !== this.root || preview.toRoot !== this.root || preview.entries.some(entry =>
        ![entry.from, entry.to].every(path => path.startsWith(root + '/') && path !== state)))
        throw new Error('Practice changes cannot write outside Examples or replace its state file.');
      preview = { ...preview, writeBoundary: root };
    }
    return executeMove(this.app, this.settings, () => this.saveSettings(), preview);
  }
  private async archiveCapture(draft: CaptureDraft): Promise<void> {
    const source = await this.captureSource(draft);
    if (!source || !this.isCapturePath(source.path)) return;
    const target = this.paths.archives + '/' + draft.captureId + '.md';
    if (this.app.vault.getAbstractFileByPath(target)) throw new Error('The capture archive destination already exists; inspect both captures before retrying.');
    // FileManager.renameFile also rewrites outbound relative links inside the moved note.
    // A backed-up raw move preserves the evidence bytes while updating ordinary inbound links.
    if (typeof this.app.vault.rename !== 'function') throw new Error('Byte-preserving capture archival is unavailable. The raw capture remains in the inbox.');
    const preview = await prepareMove(this.app, this.settings, { ...this.moveOptions(), kind: 'capture-archive', toRoot: this.root, mapping: new Map([[source.path, target]]) });
    if (preview.conflicts.length) throw new Error(preview.conflicts.join('\n'));
    try { await this.executePlan(preview); }
    catch (error) {
      const journal = this.settings.migration;
      if (!journal || journal.id !== preview.id) throw error;
      try { await recoverMove(this.app, this.settings, () => this.saveSettings()); }
      catch (rollbackError) {
        this.settings.migration ??= journal;
        this.settings.migration.status = 'failed';
        this.settings.migration.error = 'Capture archival needs recovery: ' + String(rollbackError);
        try { await this.saveSettings(); } catch { /* The durable move journal remains the recovery authority. */ }
        throw new Error('Capture archival stopped and needs move recovery. The source decision remains saved; do not replay it. Backups: ' + journal.backupRoot + '. ' + String(rollbackError));
      }
      throw new Error('Capture archival was rolled back to the inbox. The source decision remains saved; retry to finish archiving without reapplying updates. ' + String(error));
    }
  }
  async addVisit(path: string, input: VisitInput): Promise<VisitRecord> { return this.visits.create(path, input); }
  async updateCoordinates(path: string, coords: Coordinates): Promise<void> {
    return this.serial(async () => { const valid = validateCoordinates(coords); if (!valid) throw new Error('Coordinates are invalid.');
      if (!(await this.listPlaces()).some(p => p.path === path)) throw new Error('Choose a place note.');
      await this.app.vault.process(this.file(path), text => { const n = readNote(text); n.properties.coordinates = valid; return writeNote(n.properties, n.body); });
    });
  }
  async placeEditSnapshot(path: string): Promise<PlaceEditSnapshot> {
    const place = (await this.listPlaces()).find(value => value.path === path);
    if (!place) throw Error('This place no longer exists in this notebook.');
    return placeEditSnapshot(place);
  }
  async reviewPlaceEdit(snapshot: PlaceEditSnapshot, values: PlaceEditValues, draftId: string): Promise<PlaceEditReview> {
    const draft = await this.preparations.get(draftId);
    if (!draft || draft.kind !== 'place-edit' || draft.phase !== 'editing') throw Error('Reopen the saved place edit before comparing current values.');
    const current = await this.placeEditSnapshot(snapshot.path), raw = await this.app.vault.read(this.file(snapshot.path));
    if (placeEditReceiptFor(readNote(raw).properties.place_edit_receipts, draftId)) throw Error('This place edit already saved. Finish its saved completion instead of changing the draft.');
    return reviewPlaceEdit(snapshot, values, current);
  }
  /** Read-only preflight. Repeated inside the serial apply and atomic note callback. */
  async validatePlaceEdit(snapshot: PlaceEditSnapshot, values: PlaceEditValues): Promise<void> {
    this.writable();
    if (!isPlaceEditPreparation({ snapshot, values, section: 'basics' }, (path): path is string => typeof path === 'string' && this.scoped(path))) throw Error('Place editor details are invalid or belong to another notebook.');
    const places = await this.listPlaces(), place = places.find(value => value.path === snapshot.path && value.kind === snapshot.kind);
    if (!place) throw Error('This place was removed or changed type. Your entered details are kept.');
    const patch = placeEditPatch(snapshot, values, place.properties);
    assertPlaceEditComparison(snapshot, patch, place.properties, values);
    const listing = patch.google_maps_url;
    if (typeof listing === 'string' && listing && places.some(other => other.path !== place.path && sameGoogleListing(listing, propertyText(other.properties.google_maps_url)))) throw Error('That Google Maps listing already belongs to another place in this notebook. Open that place before changing the link.');
    if ((await this.outings.list()).some(outing => outing.operation?.sourcePath === snapshot.path)) throw Error('Finish the interrupted outing visit save for this place before editing its details.');
  }
  /** One atomic property patch and portable receipt; retry never replays an applied edit. */
  async savePlaceEdit(snapshot: PlaceEditSnapshot, values: PlaceEditValues, operationId: string, expectedDraftRevision?: string): Promise<void> {
    return this.serial(async () => {
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(operationId)) throw Error('Invalid place edit identity.');
      if (!isPlaceEditPreparation({ snapshot, values, section: 'basics' }, (path): path is string => typeof path === 'string' && this.scoped(path))) throw Error('Place editor details are invalid or belong to another notebook.');
      const fingerprint = await hashText(JSON.stringify({ kind: snapshot.kind, properties: snapshot.properties, values }));
      if (expectedDraftRevision !== undefined) {
        const draft = await this.preparations.get(operationId);
        if (!draft || draft.kind !== 'place-edit' || draft.phase !== 'completing' || draft.revision !== expectedDraftRevision || JSON.stringify(draft.data.snapshot) !== JSON.stringify(snapshot) || JSON.stringify(draft.data.values) !== JSON.stringify(values)) throw Error('This place edit draft changed, was discarded or was removed. Your entered details are kept; reopen saved work before applying.');
      }
      const file = this.file(snapshot.path), raw = await this.app.vault.read(file), initial = readNote(raw).properties;
      const previous = placeEditReceiptFor(initial.place_edit_receipts, operationId);
      if (previous) { if (previous.fingerprint !== fingerprint) throw Error('This saved edit already finished with different details. Reopen Edit place before making another change.'); return; }
      await this.validatePlaceEdit(snapshot, values);
      await this.app.vault.process(file, current => {
        this.guard(file.path); if (file.path !== snapshot.path) throw Error('This place moved while saving. Your entered details are kept; reopen Edit place.');
        const properties = readNote(current).properties;
        const receipt = placeEditReceiptFor(properties.place_edit_receipts, operationId);
        if (receipt) { if (receipt.fingerprint !== fingerprint) throw Error('This saved edit already finished with different details.'); return current; }
        if (properties.place_edit_receipts !== undefined && !isUnknownArray(properties.place_edit_receipts)) throw Error('Saved place edit receipts need review before another edit can be recorded.');
        const tags = isUnknownArray(properties.tags) ? properties.tags : [];
        const kind = tags.includes('sourcing-source') || tags.includes('charity-shop') ? 'shop' : tags.includes('parking') ? 'parking' : null;
        if (kind !== snapshot.kind) throw Error('This place changed type. Reopen Edit place.');
        const patch = placeEditPatch(snapshot, values, properties);
        assertPlaceEditComparison(snapshot, patch, properties, values);
        for (const [key, value] of Object.entries(patch)) current = updateNoteProperty(current, key, value);
        const receipts = isUnknownArray(properties.place_edit_receipts) ? properties.place_edit_receipts : [];
        return updateNoteProperty(current, 'place_edit_receipts', [...receipts, { id: operationId, fingerprint, appliedAt: new Date().toISOString(), fields: Object.keys(patch) }]);
      });
    });
  }
  async updateAssessment(path: string, update: { rating?: number; comments?: string; shortlist?: boolean }): Promise<void> {
    return this.serial(async () => {
      if (!(await this.listPlaces()).some(p => p.path === path && p.kind === 'shop')) throw new Error('Choose a shop note.');
      if (update.rating !== undefined && (!Number.isFinite(update.rating) || update.rating < 0 || update.rating > 5 || !Number.isInteger(update.rating * 2))) throw new Error('Rating must use half-star steps from 0 to 5.');
      await this.app.vault.process(this.file(path), text => { const n = readNote(text); Object.assign(n.properties, update); return writeNote(n.properties, n.body); });
    });
  }
  async updatePlaceDetails(path: string, patch: Record<string, string | boolean>): Promise<void> {
    return this.serial(async () => {
      const place = (await this.listPlaces()).find(p => p.path === path); if (!place) throw Error('Place no longer exists.');
      const allowed = place.kind === 'shop' ? ['parking_on_site', 'on_site_parking_cost', 'on_site_parking_availability', 'shop_closed', 'address'] : ['parking_cost', 'parking_availability', 'address'];
      for (const [key, value] of Object.entries(patch)) if (!allowed.includes(key) || (key === 'shop_closed' ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 1000)) throw Error('Invalid place detail.');
      await this.app.vault.process(this.file(path), raw => { for (const [key, value] of Object.entries(patch)) raw = updateNoteProperty(raw, key, value); return raw; });
    });
  }
  async linkParking(parkingPath: string, shopPath: string, preferred = false): Promise<void> {
    return this.serial(async () => {
      const places = await this.listPlaces();
      if (!places.some(p => p.path === parkingPath && p.kind === 'parking') || !places.some(p => p.path === shopPath && p.kind === 'shop')) throw new Error('Choose a shop and a parking note.');
      await this.app.vault.process(this.file(parkingPath), text => { const n = readNote(text); const old = isUnknownArray(n.properties.parking_for) ? n.properties.parking_for : [];
        n.properties.parking_for = [...old.filter(v => linkPath(v) !== shopPath), wiki(shopPath)]; return writeNote(n.properties, n.body); });
      if (preferred) await this.prefer(shopPath, parkingPath);
    });
  }
  private async prefer(shopPath: string, parkingPath: string): Promise<void> {
    const places = await this.listPlaces();
    if (!places.some(p => p.path === shopPath && p.kind === 'shop') || (parkingPath && !places.some(p => p.path === parkingPath && p.kind === 'parking'))) throw new Error('Choose a valid shop and parking note.');
    await this.app.vault.process(this.file(shopPath), text => { const n = readNote(text); n.properties.parking_location = parkingPath ? wiki(parkingPath) : ''; return writeNote(n.properties, n.body); });
  }
  async setPreferredParking(shopPath: string, parkingPath: string): Promise<void> { return this.serial(() => this.prefer(shopPath, parkingPath)); }

  async unlinkParking(parkingPath: string, shopPath: string): Promise<void> {
    return this.serial(async () => {
      const places = await this.listPlaces();
      const parking = places.find(p => p.path === parkingPath && p.kind === 'parking');
      const source = places.find(p => p.path === shopPath && p.kind === 'shop');
      if (!parking || !source) throw new Error('Choose a source and a parking note.');
      await this.app.vault.process(this.file(parkingPath), text => {
        const note = readNote(text), links = Array.isArray(note.properties.parking_for) ? note.properties.parking_for : [];
        note.properties.parking_for = links.filter(value => linkPath(value) !== shopPath);
        return writeNote(note.properties, note.body);
      });
      if (linkPath(source.properties.parking_location) === parkingPath) await this.prefer(shopPath, '');
    });
  }
  private async assertPlaceEditMovesAllowed(affected?: ReadonlySet<string>): Promise<void> {
    for (const draft of (await this.preparations.inspect()).drafts) {
      if (draft.kind !== 'place-edit') continue;
      const draftPath = this.paths.drafts + '/' + draft.id + '.json';
      if (affected && !affected.has(draft.data.snapshot.path) && !affected.has(draftPath)) continue;
      const file = this.app.vault.getAbstractFileByPath(draft.data.snapshot.path);
      if (!isFile(file)) continue;
      if (placeEditReceiptFor(readNote(await this.app.vault.read(file)).properties.place_edit_receipts, draft.id)) throw Error('Finish the saved place edit for ' + draft.data.snapshot.name + ' before moving its record or affected links. Reopen Edit place and choose Save place to finish without replaying its changes.');
    }
  }
  private async movable(affected?: ReadonlySet<string>): Promise<void> {
    this.writable();
    if ((await this.outings.list()).some(outing => outing.operation)) throw new Error('Resume the unfinished outing visit save before moving notes.');
    if ((await this.visits.pendingOperations()).length) throw new Error('Finish the saved visit operation before moving notes.');
    if ((await this.preparations.inspect()).drafts.some(draft => draft.phase === 'completing' && draft.kind !== 'place-edit')) throw new Error('Finish the saved preparation before moving notes.');
    await this.assertPlaceEditMovesAllowed(affected);
  }
  async previewNotebookMove(newRoot: string): Promise<MovePreview> {
    if (this.mode === 'examples') throw new Error('Notebook moves are shown as worked examples; practice records stay together inside Examples.');
    await this.movable();
    const root = this.root, targetRoot = validateRootPath(newRoot);
    if (targetRoot === root) throw new Error('The notebook already uses that folder.');
    if (targetRoot.toLocaleLowerCase().startsWith(root.toLocaleLowerCase() + '/') || root.toLocaleLowerCase().startsWith(targetRoot.toLocaleLowerCase() + '/')) throw new Error('Choose a separate folder, outside the current notebook.');
    const allFiles = this.app.vault.getFiles();
    const mapping = new Map<string, string>();
    const canonical = (suffix: string) => suffix
      .replace(/^\/Shops\//, '/Sources/')
      .replace(/^\/Shops\.md$/, '/Sources.md')
      .replace(/^\/System\/Shops\.base$/, '/System/Sources.base')
      .replace(/^\/Templates\/Shop\.md$/, '/Templates/Source.md')
      .replace(/^\/Templates\/Web Clipper\/Capture shop\.json$/, '/Templates/Web Clipper/Capture source.json');
    for (const file of allFiles.filter(f => f.path.startsWith(root + '/') && (migrationEligible(f.path) || f.path.startsWith(root + '/Examples/System/Migration backups/')))) mapping.set(file.path, targetRoot + canonical(file.path.slice(root.length)));
    const generated = bundledAssets(targetRoot, this.app.vault.getName());
    for (const [kind, template] of Object.entries(createClipperTemplates(targetRoot, this.app.vault.getName()))) generated[targetRoot + '/System/Templates/Web Clipper/Capture ' + (kind === 'shop' ? 'source' : kind) + '.json'] = JSON.stringify(template, null, 2) + '\n';
    const content: Record<string, string> = {};
    for (const [from, to] of mapping) {
      const asset = this.settings.assets[from];
      if (asset && generated[to] !== undefined && asset.hash === await hashText(await this.app.vault.read(this.file(from)))) content[from] = generated[to]!;
    }
    const prefixes: [string, string][] = [
      [root + '/Shops/', targetRoot + '/Sources/'], [root + '/Shops', targetRoot + '/Sources'],
      [root + '/System/Shops.base', targetRoot + '/System/Sources.base'],
      [root, targetRoot],
    ];
    const preview = await prepareMove(this.app, this.settings, { ...this.moveOptions(), kind: 'notebook', toRoot: targetRoot, mapping, prefixes, content });
    const practiceStatePath = examplesStatePath(root + '/Examples'), practiceState = this.app.vault.getAbstractFileByPath(practiceStatePath);
    if (isFile(practiceState)) {
      try {
        const raw = await this.app.vault.read(practiceState);
        const state = parseExamplesState(raw, root + '/Examples');
        if (state.phase !== 'ready' || state.settings.migration) throw new Error('Finish Examples installation or practice recovery before moving the notebook.');
        const practice = new SourcingStore(this.app, state.settings, async () => {}, { mode: 'examples' });
        if ((await practice.outings.list()).some(outing => outing.operation)) throw new Error('Resume the unfinished practice outing visit before moving the notebook.');
        if ((await practice.visits.pendingOperations()).length) throw new Error('Finish the saved practice visit operation before moving the notebook.');
        await practice.assertPlaceEditMovesAllowed();
        const entry = preview.entries.find(entry => entry.from === practiceStatePath);
        if (!entry) throw new Error('The practice state is missing from this move.');
        const content = remapExamplesState(raw, root + '/Examples', targetRoot + '/Examples', preview.entries);
        entry.text = content; entry.afterHash = await hashText(content);
        if (!preview.rewrites.includes(practiceStatePath)) preview.rewrites.push(practiceStatePath);
      } catch (error) { preview.conflicts.push('Examples cannot be moved safely: ' + (error instanceof Error ? error.message : String(error))); }
    }
    if (allFiles.some(file => file.path.toLocaleLowerCase().startsWith(targetRoot.toLocaleLowerCase() + '/'))) preview.conflicts.push('Choose an empty destination folder; ' + targetRoot + ' already contains files.');
    if (!mapping.size) preview.conflicts.push('The current notebook folder contains no movable files.');
    return preview;
  }
  async moveNotebook(newRoot: string, preview?: MovePreview): Promise<MoveReport> {
    const report = await this.serial(async () => {
      await this.movable();
      const plan = preview ?? await this.previewNotebookMove(newRoot);
      if (plan.kind !== 'notebook' || plan.toRoot !== validateRootPath(newRoot)) throw new Error('Preview this folder move again.');
      return this.executePlan(plan);
    });
    await this.setup();
    return report;
  }
  async previewLocalityMove(path: string, newName: string, parentPath = ''): Promise<MovePreview> {
    await this.movable(new Set());
    const name = validLocalityName(newName), localities = await this.listLocalities(), current = localities.find(l => l.path === path);
    if (!current) throw new Error('Choose an existing area.');
    const descendants = localitySubtree(path, localities);
    if (descendants.some(l => l.path === parentPath)) throw new Error('An area cannot become its own parent or a child of its descendants.');
    const parent = parentPath ? localities.find(l => l.path === parentPath) : undefined;
    if (parentPath && !parent) throw new Error('Choose an existing parent area.');
    const newSegments = [...(parent?.segments ?? []), name];
    if (JSON.stringify(current.segments) === JSON.stringify(newSegments) && current.parentPath === parentPath) throw new Error('The area already has that name and parent.');
    const duplicate = localities.find(l => l.path !== path && l.parentPath === parentPath && l.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) throw new Error('That parent already has an area named ' + name + '.');
    const mapping = new Map<string, string>(), prefixes: [string, string][] = [], content: Record<string, string> = {};
    const allFiles = this.app.vault.getFiles().filter(file => migrationEligible(file.path));
    const destinationSegments = new Map(descendants.map(locality => [locality.path, [...newSegments, ...locality.segments.slice(current.segments.length)]]));
    for (const locality of descendants) {
      const segments = destinationSegments.get(locality.path)!;
      mapping.set(locality.path, this.paths.area(segments));
    }
    prefixes.push([this.paths.places + '/' + current.segments.join('/'), this.paths.places + '/' + newSegments.join('/')]);
    const [fromPlaces, toPlaces] = prefixes[0];
    for (const file of allFiles) if (file.path.startsWith(fromPlaces + '/')) mapping.set(file.path, toPlaces + file.path.slice(fromPlaces.length));
    for (const branch of ['Sources', 'Shops', 'Parking']) {
      const fromPrefix = this.root + '/' + branch + '/' + current.segments.join('/');
      const toPrefix = this.root + '/' + (branch === 'Shops' ? 'Sources' : branch) + '/' + newSegments.join('/');
      prefixes.push([fromPrefix, toPrefix]);
      for (const file of allFiles) if (file.path.startsWith(fromPrefix + '/')) mapping.set(file.path, toPrefix + file.path.slice(fromPrefix.length));
    }
    // Explicit locality links remain authoritative when a user previously moved a note by hand.
    for (const place of await this.listPlaces()) {
      const segments = destinationSegments.get(place.locality);
      if (segments) mapping.set(place.path, this.paths.place(segments, place.path.split('/').pop()!.replace(/\.md$/, '')));
    }
    const currentText = await this.app.vault.read(this.file(path));
    const note = readNote(rewriteLinks(this.app, stripCodexMarkers(currentText), path, mapping.get(path)!, mapping, allFiles));
    note.properties.parent_locality = parentPath ? wiki(parentPath) : '';
    note.properties.area_name = name;
    content[path] = writeNote(note.properties, note.body);
    for (const locality of descendants) for (const branch of ['Sources', 'Shops', 'Parking']) {
      const from = this.root + '/' + branch + '/' + locality.segments.join('/') + '/Area map.base';
      const asset = this.settings.assets[from], file = this.app.vault.getAbstractFileByPath(from);
      if (asset && isFile(file) && asset.hash === await hashText(await this.app.vault.read(file))) content[from] = this.contextBase(baseText(this.root, undefined, mapping.get(locality.path), this.app.vault.getName()), mapping.get(from) ?? from);
    }
    const preview = await prepareMove(this.app, this.settings, { ...this.moveOptions(), kind: 'locality', toRoot: this.root, mapping, prefixes, content, locality: { path, name, parentPath } });
    await this.assertPlaceEditMovesAllowed(new Set(preview.entries.filter(entry => entry.from !== entry.to || entry.text !== undefined).map(entry => entry.from)));
    return preview;
  }
  async moveLocality(path: string, newName: string, parentPath = '', preview?: MovePreview): Promise<MoveReport> {
    return this.serial(async () => {
      await this.movable(new Set());
      const plan = preview ?? await this.previewLocalityMove(path, newName, parentPath);
      if (plan.kind !== 'locality' || plan.locality?.path !== path || plan.locality.name !== validLocalityName(newName) || plan.locality.parentPath !== parentPath) throw new Error('Preview this area move again.');
      return this.executePlan(plan);
    });
  }

  private areaSelectionKey(selection: AreaSelection): string {
    return JSON.stringify({ town: selection.town.trim(), locality: selection.locality.trim(), townPath: selection.townPath || '', localityPath: selection.localityPath || '' });
  }
  async previewPlaceAreaChange(path: string, selection: AreaSelection): Promise<MovePreview> {
    await this.movable(new Set());
    const place = (await this.listPlaces()).find(record => record.path === path);
    if (!place) throw new Error('Choose a saved source or parking note.');
    const area = await this.planArea(selection);
    const target = this.paths.place(area.leaf.segments, path.split('/').pop()!.replace(/\.md$/, ''));
    this.assertDestination(target, path);
    if (target === path && place.locality === area.leaf.path) throw new Error('This place already belongs to the selected area.');
    const mapping = new Map([[path, target]]), allFiles = this.app.vault.getFiles().filter(file => migrationEligible(file.path));
    const original = await this.app.vault.read(this.file(path));
    const content = updateNoteProperty(rewriteLinks(this.app, original, path, target, mapping, allFiles), 'locality', wiki(area.leaf.path));
    const preview = await prepareMove(this.app, this.settings, { ...this.moveOptions(),
      kind: 'place-area', toRoot: this.root, mapping, content: { [path]: content },
      prefixes: [[path, target], [path.replace(/\.md$/, ''), target.replace(/\.md$/, '')]],
    });
    await this.assertPlaceEditMovesAllowed(new Set(preview.entries.filter(entry => entry.from !== entry.to || entry.text !== undefined).map(entry => entry.from)));
    preview.areaChange = { sourcePath: path, selection: structuredClone(selection), targetLocalityPath: area.leaf.path, creations: area.creations };
    preview.creations = area.creations;
    if (area.creations.length) preview.warnings.push('Missing areas and their maps will be created on Apply. If the file move later fails, those new areas remain available.');
    return preview;
  }
  async changePlaceArea(path: string, selection: AreaSelection, preview?: MovePreview): Promise<MoveReport> {
    return this.serial(async () => {
      await this.movable(new Set());
      const approved = preview ?? await this.previewPlaceAreaChange(path, selection);
      if (approved.kind !== 'place-area' || approved.areaChange?.sourcePath !== path || this.areaSelectionKey(approved.areaChange.selection) !== this.areaSelectionKey(selection)) throw new Error('Preview this area change again.');
      await validateMovePreview(this.app, this.settings, approved);
      const area = await this.planArea(selection);
      if (area.leaf.path !== approved.areaChange.targetLocalityPath || JSON.stringify(area.creations) !== JSON.stringify(approved.areaChange.creations)) throw new Error('The proposed area changed. Preview this area change again.');
      await this.materializeArea(area);
      const fresh = await this.previewPlaceAreaChange(path, selection);
      const beforeInventory = new Set(approved.inventory), afterInventory = new Set(fresh.inventory), created = new Set(area.creations);
      if (approved.inventory.some(file => !afterInventory.has(file)) || fresh.inventory.some(file => !beforeInventory.has(file) && !created.has(file))) throw new Error('Files changed while creating the area. Preview this area change again.');
      for (const [file, hash] of Object.entries(approved.observed)) if (fresh.observed[file] !== hash) throw new Error('A file changed while creating the area: ' + file);
      const summary = (plan: MovePreview) => JSON.stringify(plan.entries.map(entry => [entry.from, entry.to, entry.beforeHash, entry.afterHash]));
      if (summary(fresh) !== summary(approved)) throw new Error('The affected links changed. Preview this area change again.');
      const result = await this.executePlan(fresh);
      this.settings.recentLocalities = [area.leaf.path, ...this.settings.recentLocalities.filter(value => value !== area.leaf.path)].slice(0, 10);
      await this.saveSettings();
      return { ...result, created: area.creations };
    });
  }

  async rollbackMove(): Promise<MoveReport> {
    // Recovery is an explicit operation and bypasses the ordinary write lock.
    return this.coordinator.run(async () => { await this.options.assertWritable?.();
      if (this.mode === 'examples' && this.settings.migration) this.settings.migration.writeBoundary = this.options.writeBoundary ?? this.root;
      return recoverMove(this.app, this.settings, () => this.saveSettings()); });
  }

}
