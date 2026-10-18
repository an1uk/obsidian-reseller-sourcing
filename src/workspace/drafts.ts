import type { App, TFile } from 'obsidian';
import type { PreparationDraft } from './types';
import { hashText, linkPath, wiki } from '../storage/markdown';
import { NotebookPaths } from '../storage/paths';
interface Host { app: App; root(): string; exclusive<T>(run: () => Promise<T>): Promise<T>; folder(path: string): Promise<void>; }
const fileLike = (v: unknown): v is TFile => !!v && typeof v === 'object' && 'extension' in v;
const validId = (id: string) => /^[a-zA-Z0-9-]{8,100}$/.test(id);
/** Preparation shares the notebook's mutation queue and context boundary. */
export class PreparationStore {
  constructor(private host: Host) {}
  private path(id: string) { if (!validId(id)) throw Error('Invalid preparation identity.'); return new NotebookPaths(this.host.root()).drafts + '/' + id + '.json'; }
  private parse(raw: string): PreparationDraft {
    const d = JSON.parse(raw);
    const decode = (value: unknown): unknown => Array.isArray(value) ? value.map(decode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, decode(v)])) : typeof value === 'string' && value.startsWith('[[') && value.endsWith(']]') ? linkPath(value) : value;
    if (d?.data) d.data = decode(d.data); if (d?.resultPath) d.resultPath = linkPath(d.resultPath);
    if (!d || d.schema !== 1 || !validId(d.id) || d.root !== this.host.root() || !['outing', 'place'].includes(d.kind) || !['editing', 'completing', 'complete', 'discarded'].includes(d.phase) || !d.data || typeof d.data !== 'object' || !Number.isFinite(Date.parse(d.updatedAt))) throw Error('This preparation draft needs review.');
    const inside = (p: string) => typeof p === 'string' && p.startsWith(d.root + '/') && !/[\\\x00-\x1f]/.test(p) && !p.split('/').some(v => !v || v === '..' || v === '.') && !p.startsWith(d.root + '/Examples/');
    if (d.kind === 'outing') {
      if (typeof d.data.name !== 'string' || !Array.isArray(d.data.groups) || ![1, 2, 3].includes(d.data.step) || !Array.isArray(d.data.unresolved) || !d.data.unresolved.every(inside) || !d.data.filter || typeof d.data.filter.text !== 'string' || typeof d.data.filter.area !== 'string' || d.data.filter.area && !inside(d.data.filter.area) || !['list','map'].includes(d.data.filter.view)) throw Error('This outing preparation needs review.');
      for (const group of d.data.groups) {
        if (!group || !Array.isArray(group.stops) || (group.parkingPath && !inside(group.parkingPath))) throw Error('Draft parking belongs to another notebook.');
        for (const stop of group.stops) if (!stop || !inside(stop.sourcePath)) throw Error('A draft source belongs to another notebook.');
      }
      if (d.data.existingPath && !inside(d.data.existingPath)) throw Error('Draft outing belongs to another notebook.');
    } else if (!d.data.capture || !['shop', 'parking'].includes(d.data.capture.kind) || !['name','address','url','captureId'].every(k => typeof d.data.capture[k] === 'string') || !d.data.area || typeof d.data.area.town !== 'string' || typeof d.data.area.locality !== 'string' || typeof d.data.filename !== 'string' || ![1, 2].includes(d.data.step) || d.data.linkedSource && !inside(d.data.linkedSource)) throw Error('This place preparation needs review.');
    if (d.resultPath && !inside(d.resultPath)) throw Error('Preparation result belongs to another notebook.');
    return d;
  }
  async get(id: string): Promise<PreparationDraft | undefined> {
    const file = this.host.app.vault.getAbstractFileByPath(this.path(id)); if (!file) return;
    if (!fileLike(file)) throw Error('A folder occupies the preparation file.');
    const raw = await this.host.app.vault.read(file), draft = this.parse(raw); if (draft.id !== id) throw Error('Preparation identity changed.');
    return { ...draft, revision: await hashText(raw) };
  }
  async inspect(): Promise<{ drafts: PreparationDraft[]; warnings: { path: string; message: string }[] }> {
    const drafts: PreparationDraft[] = [], warnings: { path: string; message: string }[] = [];
    for (const f of this.host.app.vault.getFiles().filter(f => f.path.startsWith(new NotebookPaths(this.host.root()).drafts + '/') && f.extension === 'json')) {
      try { const draft = await this.get(f.basename); if (draft && !['complete', 'discarded'].includes(draft.phase)) drafts.push(draft); } catch (e) { warnings.push({ path: f.path, message: String(e) }); }
    }
    return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
  }
  async save<T>(draft: PreparationDraft<T>, expected: string): Promise<PreparationDraft<T>> {
    return this.host.exclusive(async () => {
      const current = await this.get(draft.id);
      if ((current?.revision ?? '') !== expected) throw Error('This draft changed in another view. Your entered details remain here; reopen the saved draft to compare.');
      if (current && current.phase !== 'editing') throw Error('This draft is completing or has closed. Reopen saved work.');
      if (current && current.kind !== draft.kind) throw Error('Preparation kind changed.');
      return this.write({ ...draft, root: this.host.root(), updatedAt: new Date().toISOString(), phase: 'editing' }, expected);
    });
  }
  private async write<T>(draft: PreparationDraft<T>, expected: string): Promise<PreparationDraft<T>> {
    const { revision: _revision, ...data } = structuredClone(draft);
    const encode = (value: unknown, key = ''): unknown => Array.isArray(value) ? value.map(v => encode(v, key)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, encode(v,k)])) : typeof value === 'string' && value.startsWith(draft.root + '/') && (key.endsWith('Path') || ['area','path','unresolved','linkedSource'].includes(key)) ? wiki(value) : value;
    data.data = encode(data.data) as T; if (data.resultPath) data.resultPath = wiki(data.resultPath);
    const raw = JSON.stringify(data, null, 2) + '\n'; this.parse(raw);
    const path = this.path(draft.id), file = this.host.app.vault.getAbstractFileByPath(path);
    if (!file) { if (expected) throw Error('The preparation draft was removed.'); await this.host.folder(new NotebookPaths(this.host.root()).drafts); await this.host.app.vault.create(path, raw); }
    else {
      if (!fileLike(file)) throw Error('Preparation path is occupied.');
      const before = await this.host.app.vault.read(file); if (await hashText(before) !== expected) throw Error('Preparation draft changed.');
      await this.host.app.vault.process(file, current => { if (current !== before) throw Error('Preparation draft changed.'); return raw; });
    }
    return { ...draft, revision: await hashText(raw) };
  }
  async transition(id: string, expected: string, phase: PreparationDraft['phase'], resultPath?: string): Promise<PreparationDraft> {
    return this.host.exclusive(async () => {
      const draft = await this.get(id); if (!draft || draft.revision !== expected) throw Error('Preparation changed. Reopen it before continuing.');
      if (draft.phase === 'complete' || draft.phase === 'discarded') throw Error('This preparation has already closed.');
      if (draft.phase === 'completing' && phase !== 'complete' && phase !== 'completing') throw Error('Finish the saved completion before changing this draft.');
      return this.write({ ...draft, phase, ...(resultPath ? { resultPath } : {}), updatedAt: new Date().toISOString() }, expected);
    });
  }
  async defer(id: string, expected: string): Promise<void> {
    const draft = await this.get(id); if (!draft || draft.revision !== expected) throw Error('Preparation changed.');
    await this.save({ ...draft, deferred: true }, expected);
  }
}
