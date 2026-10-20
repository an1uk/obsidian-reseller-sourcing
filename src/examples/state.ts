import { normaliseDistanceUnit } from '../units';
import type { App, TFile } from 'obsidian';
import type { MoveEntry, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { validateRootPath } from '../domain';
import { hashText } from '../storage/markdown';
import { SourcingStore } from '../storage/store';
import { MutationCoordinator } from '../storage/coordinator';
import { buildExamplePack, EXAMPLES_PACK_VERSION } from './pack';
import { hasControlCharacters } from '../domain/guards';
import { parseSettings } from '../platform/settings-data';
import { notebookFiles } from '../storage/files';

export const EXAMPLES_STATE_FORMAT = 'reseller-sourcing-examples';
export const examplesRoot = (liveRoot: string): string => validateRootPath(liveRoot) + '/Examples';
export const examplesStatePath = (root: string): string => validateRootPath(root) + '/System/Practice state.json';
export interface ExamplesState {
  format: typeof EXAMPLES_STATE_FORMAT; schema: 1; instanceId: string; packVersion: number;
  phase: 'installing' | 'ready'; settings: Settings; files: Record<string, string>;
}
export interface ExamplesStatus {
  state: 'missing' | 'partial' | 'ready' | 'conflict'; root: string; path: string;
  message: string; instanceId?: string; packVersion?: number;
}
export interface ExamplesSession {
  id: string; contextId: string; root: string; settings: Settings; store: SourcingStore;
  assertCurrent(): void; validate(): Promise<void>; save(): Promise<void>;
}
const fileLike = (value: unknown): value is TFile => !!value && typeof value === 'object' && 'extension' in value;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const inside = (path: unknown, root: string): path is string => typeof path === 'string' && path.startsWith(root + '/') &&
  !path.includes('\\') && !hasControlCharacters(path, false) && !path.split('/').some(part => !part || part === '.' || part === '..');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function checkedSettings(value: unknown, root: string): Settings {
  if (!object(value) || value.root !== root) throw new Error('The practice state belongs to a different folder.');
  const settings = parseSettings(value);
  if (!Number.isFinite(settings.suggestionKm) || !Array.isArray(settings.tileSets) || !Array.isArray(settings.sourceTypes) ||
    settings.sourceTypes.some(type => typeof type !== 'string' || !type.trim()) || typeof settings.defaultSourceType !== 'string' ||
    !object(settings.assets) || !object(settings.captureReceipts) || !object(settings.captureSnapshots) ||
    !Array.isArray(settings.previousRoots) || settings.previousRoots.length || !Array.isArray(settings.recentLocalities) || !Array.isArray(settings.areaHints))
    throw new Error('The practice settings are invalid. Preserve the folder and review its state file.');
  for (const [path, asset] of Object.entries(settings.assets)) if (!inside(path, root) || !object(asset) || !hash(asset.hash) || typeof asset.version !== 'number') throw new Error('Practice component ownership is outside Examples or invalid.');
  for (const path of Object.values(settings.captureReceipts)) if (!inside(path, root)) throw new Error('A practice capture receipt is outside Examples.');
  for (const [path, snapshot] of Object.entries(settings.captureSnapshots)) if (!inside(path, root) || !object(snapshot) || !hash(snapshot.revision) || typeof snapshot.captureId !== 'string') throw new Error('A practice capture snapshot is invalid.');
  const areaInside = (path: unknown) => inside(path, root + '/Places') || inside(path, root + '/Localities');
  if (settings.recentLocalities.some(path => !areaInside(path))) throw new Error('A recent practice area is outside Examples.');
  for (const hint of settings.areaHints) if (!object(hint) || typeof hint.id !== 'string' || typeof hint.phrase !== 'string' || typeof hint.enabled !== 'boolean' ||
    !areaInside(hint.townPath) || !areaInside(hint.localityPath)) throw new Error('A practice address hint is invalid.');
  const journal = settings.migration;
  if (journal && (!object(journal) || journal.fromRoot !== root || journal.toRoot !== root || !inside(journal.backupRoot, root) ||
    !Array.isArray(journal.entries) || journal.entries.some(entry => !inside(entry.from, root) || !inside(entry.to, root) || entry.backupPath !== undefined && !inside(entry.backupPath, root))))
    throw new Error('Practice recovery would affect files outside Examples.');
  if (journal) {
    if (!object(journal.settingsBefore) || journal.settingsBefore.root !== root) throw new Error('The practice rollback settings are outside Examples.');
    checkedSettings({ ...settings, ...journal.settingsBefore, migration: undefined }, root);
  }
  return settings;
}
export function parseExamplesState(raw: string, root: string): ExamplesState {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.format !== EXAMPLES_STATE_FORMAT || data.schema !== 1 || typeof data.instanceId !== 'string' || !data.instanceId ||
    typeof data.packVersion !== 'number' || !Number.isSafeInteger(data.packVersion) || data.phase !== 'installing' && data.phase !== 'ready' || !object(data.files) ||
    Object.entries(data.files).some(([path, digest]) => !inside(path, root) || !hash(digest))) throw new Error('This Examples state is invalid or uses an unsupported format.');
  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(data.files)) if (typeof digest === 'string') files[path] = digest;
  return { format: EXAMPLES_STATE_FORMAT, schema: 1, instanceId: data.instanceId, packVersion: data.packVersion,
    phase: data.phase, settings: checkedSettings(data.settings, root), files };
}
export function encodeExamplesState(state: ExamplesState): string { return JSON.stringify(state, null, 2) + '\n'; }
/** The parent move owns this state-file edit and backs it up alongside every practice file. */
export function remapExamplesState(raw: string, fromRoot: string, toRoot: string, entries: readonly MoveEntry[]): string {
  const state = parseExamplesState(raw, fromRoot);
  if (state.phase !== 'ready' || state.settings.migration) throw new Error('Finish the Examples installation or practice recovery before moving the notebook.');
  const remap = (path: string) => path === fromRoot || path.startsWith(fromRoot + '/') ? toRoot + path.slice(fromRoot.length) : path;
  const byPath = new Map(entries.map(entry => [entry.from, entry]));
  const settings = state.settings; settings.root = toRoot;
  settings.assets = Object.fromEntries(Object.entries(settings.assets).map(([path, asset]) => {
    const entry = byPath.get(path);
    return [remap(path), entry && asset.hash === entry.beforeHash ? { ...asset, hash: entry.afterHash } : asset];
  }));
  settings.captureReceipts = Object.fromEntries(Object.entries(settings.captureReceipts).map(([id, path]) => [id, remap(path)]));
  settings.captureSnapshots = Object.fromEntries(Object.entries(settings.captureSnapshots).map(([path, snapshot]) => [remap(path), { ...snapshot, revision: byPath.get(path)?.afterHash ?? snapshot.revision }]));
  settings.recentLocalities = settings.recentLocalities.map(remap);
  if (settings.shortTripDefaults?.startPath) settings.shortTripDefaults.startPath = remap(settings.shortTripDefaults.startPath);
  settings.areaHints = settings.areaHints.map(hint => ({ ...hint, townPath: remap(hint.townPath), localityPath: remap(hint.localityPath) }));
  state.files = Object.fromEntries(Object.entries(state.files).map(([path, digest]) => {
    const entry = byPath.get(path); return [remap(path), entry && digest === entry.beforeHash ? entry.afterHash : digest];
  }));
  return encodeExamplesState(state);
}
interface CachedSession { session: ExamplesSession; state: ExamplesState; raw: string; valid: boolean; }
export class ExamplesManager {
  private cached?: CachedSession; private generation = 0;
  constructor(private app: App, private liveRoot: () => string, private coordinator = new MutationCoordinator(), private defaults: () => Settings = () => DEFAULT_SETTINGS) {}
  get root(): string { return examplesRoot(this.liveRoot()); }
  invalidate(): void { if (this.cached) this.cached.valid = false; this.cached = undefined; }
  private stateFile(root: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(examplesStatePath(root));
    return fileLike(file) ? file : null;
  }
  async inspect(): Promise<ExamplesStatus> {
    const root = this.root, path = examplesStatePath(root), file = this.stateFile(root);
    if (!file) {
      const occupied = this.app.vault.getAbstractFileByPath(root) && notebookFiles(this.app.vault, root).length > 0;
      return { state: occupied ? 'conflict' : 'missing', root, path, message: occupied ? 'Examples already contains files without a recognised practice state. Nothing will be overwritten.' : 'Examples have not been added. Add examples creates a separate fictional practice notebook.' };
    }
    try {
      const state = parseExamplesState(await this.app.vault.read(file), root);
      return { state: state.phase === 'ready' ? 'ready' : 'partial', root, path, instanceId: state.instanceId, packVersion: state.packVersion,
        message: state.phase === 'ready' ? 'Fictional examples are available. Your practice changes are kept; upgrades do not repair or recreate these files.' : 'An explicit Add examples operation was interrupted. Resume it to create only missing, unchanged example components.' };
    } catch (error) { return { state: 'conflict', root, path, message: error instanceof Error ? error.message : String(error) }; }
  }
  private async folder(path: string, root: string, initial = false): Promise<void> {
    const live = validateRootPath(this.liveRoot()), parent = this.app.vault.getAbstractFileByPath(live);
    if (this.root !== root || !parent || fileLike(parent)) throw new Error('Create or reopen the real notebook before adding Examples. Its parent will not be recreated.');
    if (path !== root && !inside(path, root)) throw new Error('Examples installation cannot write outside its folder.');
    let current = live;
    for (const part of path.slice(live.length + 1).split('/')) {
      if (!initial && !this.stateFile(root)) throw new Error('Examples were removed. The interrupted action cannot recreate them.');
      current += '/' + part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (fileLike(existing)) throw new Error('A file occupies an Examples folder: ' + current);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }
  async add(): Promise<ExamplesStatus> {
    return this.coordinator.run(async () => {
      const root = this.root, path = examplesStatePath(root), status = await this.inspect();
      if (status.state === 'ready') return status;
      if (status.state === 'conflict') throw new Error(status.message);
      const partialState = status.state === 'partial' ? parseExamplesState(await this.app.vault.read(this.stateFile(root)!), root) : null;
      const pack = await buildExamplePack(root, this.app.vault.getName(), partialState?.packVersion ?? EXAMPLES_PACK_VERSION);
      if (Object.keys(pack.files).some(path => !inside(path, root) || path === examplesStatePath(root))) throw new Error('The example pack contains an unsafe path.');
      const expected = Object.fromEntries(await Promise.all(Object.entries(pack.files).map(async ([path, text]): Promise<[string, string]> => [path, await hashText(text)])));
      let state: ExamplesState, raw: string;
      if (status.state === 'partial') {
        const existing = this.stateFile(root)!; raw = await this.app.vault.read(existing); state = parseExamplesState(raw, root);
        if (JSON.stringify(state.files) !== JSON.stringify(expected)) throw new Error('The partial pack differs from this version. Preserve its files; it will not be overwritten.');
      } else {
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error('The practice state path is already occupied.');
        const supplied = this.defaults();
        const settings = checkedSettings({ ...pack.settings, suggestionKm: supplied.suggestionKm, distanceUnit: normaliseDistanceUnit(supplied.distanceUnit), tileSets: structuredClone(supplied.tileSets) }, root);
        state = { format: EXAMPLES_STATE_FORMAT, schema: 1, instanceId: crypto.randomUUID(), packVersion: EXAMPLES_PACK_VERSION, phase: 'installing', settings, files: expected };
        raw = encodeExamplesState(state); await this.folder(root + '/System', root, true); await this.app.vault.create(path, raw);
      }
      // Preflight every existing payload before creating a single missing example file.
      for (const [path, digest] of Object.entries(expected)) {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing && (!fileLike(existing) || await hashText(await this.app.vault.read(existing)) !== digest)) throw new Error('An example component was edited or occupied: ' + path + '. Your changes have been kept.');
      }
      for (const [path, text] of Object.entries(pack.files)) {
        if (this.root !== root || !this.stateFile(root)) throw new Error('Examples were removed or the notebook moved. Explicitly add examples again if wanted.');
        if (this.app.vault.getAbstractFileByPath(path)) continue;
        await this.folder(path.slice(0, path.lastIndexOf('/')), root);
        if (this.root !== root || !this.stateFile(root)) throw new Error('Examples were removed. The interrupted action cannot recreate them.');
        await this.app.vault.create(path, text);
      }
      state.phase = 'ready'; const next = encodeExamplesState(state), file = this.stateFile(root);
      if (!file) throw new Error('The Examples state was removed. Nothing will be recreated automatically.');
      await this.app.vault.process(file, current => { if (current !== raw) throw new Error('The Examples state changed during installation. Review it before resuming.'); return next; });
      this.invalidate(); return this.inspect();
    });
  }
  async open(): Promise<ExamplesSession | null> {
    const root = this.root, file = this.stateFile(root);
    if (!file) { this.invalidate(); return null; }
    const raw = await this.app.vault.read(file), state = parseExamplesState(raw, root);
    if (state.phase !== 'ready') { this.invalidate(); return null; }
    if (this.cached?.valid && this.cached.session.root === root && this.cached.raw === raw) return this.cached.session;
    this.invalidate();
    const cache = {} as CachedSession;
    const assertCurrent = () => {
      if (!cache.valid || this.root !== root || cache.session.settings.root !== root || !this.app.vault.getAbstractFileByPath(validateRootPath(this.liveRoot())) || !this.stateFile(root)) throw new Error('This practice notebook changed or was deleted. Reopen Examples; it will not be recreated automatically.');
    };
    const validate = async () => {
      assertCurrent(); const file = this.stateFile(root)!;
      if (await this.app.vault.read(file) !== cache.raw) { cache.valid = false; throw new Error('Practice settings changed on another view or device. Reopen Examples before saving.'); }
    };
    const save = async () => {
      assertCurrent();
      const settings = checkedSettings(cache.session.settings, root), nextState = { ...cache.state, settings }, next = encodeExamplesState(nextState), file = this.stateFile(root);
      if (!file) throw new Error('Examples were deleted. The stale form cannot recreate them.');
      await this.app.vault.process(file, current => { if (current !== cache.raw) { cache.valid = false; throw new Error('Practice settings changed elsewhere. Reopen Examples before saving.'); } return next; });
      cache.raw = next; cache.state = nextState;
    };
    const settings = state.settings;
    const store = new SourcingStore(this.app, settings, save, { mode: 'examples', coordinator: this.coordinator, assertCurrent, assertWritable: validate, writeBoundary: root });
    const session: ExamplesSession = { id: state.instanceId + ':' + (++this.generation), contextId: state.instanceId, root, settings, store, assertCurrent, validate, save };
    Object.assign(cache, { session, state, raw, valid: true }); this.cached = cache; return session;
  }
}
