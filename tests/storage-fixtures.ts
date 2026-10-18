import type { App, TFile } from 'obsidian';
import { SourcingStore } from '../src/storage/store';
import { DEFAULT_SETTINGS } from '../src/types';
import type { CaptureDraft, Settings } from '../src/types';
export class MemoryVault {
  entries = new Map<string, { path: string; extension?: string; basename?: string; stat?: { ctime: number }; text?: string }>();
  counter = 0; failRename = false; beforeProcess?: (path: string, text: string) => string;
  getName = () => 'Empty test vault';
  getAbstractFileByPath = (path: string) => this.entries.get(path) ?? null;
  getFiles = () => [...this.entries.values()].filter(f => f.extension !== undefined) as TFile[];
  getMarkdownFiles = () => this.getFiles().filter(f => f.extension === 'md');
  async createFolder(path: string) { if (this.entries.has(path)) throw Error('Already exists'); this.entries.set(path, { path }); }
  async create(path: string, text: string) {
    if (this.entries.has(path)) throw Error('Already exists');
    const ext = path.split('.').at(-1)!;
    const file = { path, extension: ext, basename: path.split('/').at(-1)!.slice(0, -ext.length - 1), stat: { ctime: ++this.counter }, text };
    this.entries.set(path, file); return file as unknown as TFile;
  }
  async read(file: TFile) { const text = this.entries.get(file.path)?.text; if (text === undefined) throw Error('Missing file'); return text; }
  async process(file: TFile, callback: (text: string) => string) {
    const entry = this.entries.get(file.path)!;
    if (this.beforeProcess) { entry.text = this.beforeProcess(file.path, entry.text!); this.beforeProcess = undefined; }
    const next = callback(entry.text!); entry.text = next; return next;
  }
  async renameFile(file: TFile, nextPath: string) {
    if (this.failRename) { this.failRename = false; throw Error('Simulated archive error'); }
    if (this.entries.has(nextPath)) throw Error('Already exists');
    const entry = this.entries.get(file.path)!; this.entries.delete(file.path);
    entry.path = nextPath; entry.basename = nextPath.split('/').at(-1)!.replace(/\.md$/, ''); this.entries.set(nextPath, entry);
  }
}
export function fixture(settings: Settings = structuredClone(DEFAULT_SETTINGS)) {
  const vault = new MemoryVault();
  let persisted: Settings | undefined;
  const app = { vault, fileManager: { renameFile: vault.renameFile.bind(vault) } } as unknown as App;
  const save = async () => { persisted = structuredClone(settings); };
  return { vault, app, settings, store: new SourcingStore(app, settings, save), save, persisted: () => persisted };
}
export const newDraft = (captureId = 'manual-one', kind: CaptureDraft['kind'] = 'shop'): CaptureDraft => ({ captureId, kind, name: 'Fixture Charity', address: '1 Main St, Exampletown AB1 1AA', url: '', coordinates: [12.3, 45.6], googleRating: 4.3, googleReviewCount: 20, topics: ['helpful staff (4)'], hours: [], capturedAt: '2026-10-14T12:00:00+01:00', street: '1 Main St', postcode: 'AB1 1AA', brandTag: 'fixture-charity' });
