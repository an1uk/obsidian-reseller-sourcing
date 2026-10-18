import { renderHome, chooseVisitSource } from './ui/home';
import { renderNotebookNavigation } from './ui/navigation';
import { rememberRenderState } from './ui/render-state';
import { renderVisitsHub, embeddedVisitsHubState } from './ui/visit-history';
import { renderVisitInsights } from './ui/visit-insights';
import { embeddedInsightsState } from './ui/insights-state';
import { renderVisitNote, renderVisitRecovery } from './ui/visits';
import { FileSystemAdapter, MarkdownRenderChild, Modal, Notice, Platform, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, type Coordinates, type PlaceKind, type Settings } from './types';
import { SourcingStore } from './storage/store';
import { createMapRegistration, MAP_VIEW_TYPE, shutdownMapRuntime, type MapHost, type PlaceMap } from './map';
import { CaptureModal, LocalityModal, NotebookMoveModal, SetupModal, VisitModal, button, errorText, manualDraft, pickCapture, pickPlace, renderPlace, renderPracticeSettings, releasePracticeSettingsOwner } from './ui';
import { googleMapsUrl, navigationUrl, resolveParking, validateRootPath } from './domain';
import { registerPlacePropertiesDefault } from './ui/properties';
import { ClipperSetupModal, showClipperUpdateNotice } from './ui/clipper-setup';
import { openChromeClipperSettings } from './platform/clipper-browser';
import { SourcingSettings } from './ui/settings';
import { showSelectableText } from './platform/clipboard';
import { handleNotebookNavigationClick } from './platform/notebook-links';
import { NewOutingModal, renderOuting, renderOutingsHome } from './ui/outings';
import { CaptureRefreshModal } from './ui/capture-refresh';
import type { NotebookContext, NotebookUiHost } from './notebook-context';
import { ExamplesManager } from './examples/state';
import { ExamplesContext } from './examples/context';
import { MutationCoordinator } from './storage/coordinator';
import { SourcingWorkspace, WORKSPACE_VIEW, openSourcingWorkspace, routeForPath } from './workspace/view';
import { PlacePreparationModal } from './workspace/place-preparation';
import { parseSettings } from './platform/settings-data';

export default class CharitySourcingPlugin extends Plugin implements NotebookContext, NotebookUiHost {
  readonly kind = 'real' as const;
  readonly externalActions = 'open' as const;
  readonly label = 'Reseller sourcing';
  get root() { return this.store.root; }
  get host(): NotebookUiHost { return this; }
  private readonly coordinator = new MutationCoordinator();
  examples!: ExamplesManager;
  private exampleContext?: ExamplesContext;
  get examplesAvailable() { return !!this.app.vault.getAbstractFileByPath(this.store.root + '/Examples/System/Practice state.json'); }
  contextRootForPath(path:string): string | undefined {
    if (path.startsWith(this.store.root + '/Examples/')) return this.store.root + '/Examples';
    return this.store.scoped(path) ? this.store.root : undefined;
  }
  async contextForPath(path:string): Promise<NotebookContext | undefined> {
    const root = this.contextRootForPath(path);
    if (!root) return;
    if (root === this.store.root) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && this.app.metadataCache.getFileCache(file)?.frontmatter?.sourcing_example === true) return;
      return this;
    }
    const session = await this.examples.open();
    if (!session) return;
    if (this.exampleContext?.session.id !== session.id) this.exampleContext = new ExamplesContext(this,session);
    return this.exampleContext;
  }
  private async inCurrentContext(run:(context:NotebookContext)=>void|Promise<void>): Promise<void> {
    try {
      const path = this.app.workspace.getActiveFile()?.path;
      const context = this.app.workspace.getActiveViewOfType(SourcingWorkspace)?.context ?? (path && this.contextRootForPath(path) ? await this.contextForPath(path) : this);
      if (!context) throw new Error('This example notebook was removed or is unavailable.');
      await run(context);
    } catch(error) { new Notice(errorText(error)); }
  }
  openExternal(url:string,_title?:string): void { if (url) window.open(url,'_blank','noopener,noreferrer'); }
  showExamples(): void {
    if (!this.settings.setupVersion) { new SetupModal(this).open(); return; }
    new ExamplesModal(this).open();
  }
  confirmContextMove(context:NotebookContext,path:string,coordinates:Coordinates): void { new ConfirmLocation(context,path,coordinates).open(); }

  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  store!: SourcingStore;
  basesReady = false;
  mapHost!: MapHost;
  private reviewOpen = false;
  private rootOperation = false;
  private editors = 0;
  private seen = new Set<string>();
  private captureTimer?: number;
  private clipperListeners = new Set<() => void>();
  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = parseSettings(saved);
    validateRootPath(this.settings.root);
    this.store = new SourcingStore(this.app, this.settings, () => this.saveSettings(), {coordinator:this.coordinator});
    this.examples = new ExamplesManager(this.app, () => this.store.root,this.coordinator,() => this.settings);
    this.registerView(WORKSPACE_VIEW, leaf => new SourcingWorkspace(leaf, this));
    this.register(()=>this.examples.invalidate());
    this.mapHost = { app: this.app, settings: this.settings, mode:'real', reportError:error=>new Notice(errorText(error)),
      ownsPath: path => this.store.scoped(path) && this.app.metadataCache.getCache(path)?.frontmatter?.sourcing_example !== true,
      openExternal: (url,title) => this.openExternal(url,title),
      resolveNotebook: async root => root === this.store.root ? this.mapHost : root === this.store.root + '/Examples' ? (await this.contextForPath(root + '/Home.md'))?.mapHost : undefined,
      openParking: (coords, shopPath) => this.newPlace('parking', coords, shopPath),
      confirmMove: (path, coords) => { new ConfirmLocation(this, path, coords).open(); },
      openFile: path => this.openFile(path), getPlaces: () => this.store.listPlaces() };
    this.basesReady = this.registerBasesView(MAP_VIEW_TYPE, createMapRegistration(this.mapHost));
    this.register(shutdownMapRuntime);
    registerPlacePropertiesDefault(this);
    this.addSettingTab(new SourcingSettings(this.app, this));
    this.registerObsidianProtocolHandler('charity-sourcing', params => { void this.navigate(params.path ?? '', params.action ?? '').catch(e => new Notice(errorText(e))); });
    if (typeof document !== 'undefined') {
      const documents = new WeakSet<Document>();
      const registerDocument = (doc: Document) => {
        if (documents.has(doc)) return; documents.add(doc);
        const navigate = (event: Event) => { handleNotebookNavigationClick(event, {
          root: () => this.store.root, rootForPath: path => this.contextRootForPath(path), navigate: (path, action) => this.navigate(path, action),
          onError: error => new Notice(errorText(error)),
        }); };
        this.registerDomEvent(doc, 'click', navigate, { capture: true });
        this.registerDomEvent(doc, 'auxclick', navigate, { capture: true });
      };
      registerDocument(document);
      this.registerEvent(this.app.workspace.on('window-open', (_win, win) => registerDocument(win.document)));
      this.app.workspace.onLayoutReady(() => this.app.workspace.iterateAllLeaves(leaf => registerDocument(leaf.view.containerEl.ownerDocument)));
    }
    this.addRibbonIcon('store', 'Reseller sourcing: Home', () => void this.inCurrentContext(c => c.home()));
    this.addCommand({ id: 'open-notebook', name: 'Open sourcing workspace', callback: () => void this.inCurrentContext(c=>c.home()) });
    this.addCommand({ id: 'clipper-setup', name: Platform.isMobileApp ? 'Desktop capture help' : 'Set up / update Web Clipper', callback: () => void this.inCurrentContext(c=>c.openClipperSetup()) });
    this.addCommand({ id: 'setup', name: 'Set up / repair notebook', callback: () => void this.inCurrentContext(c=>new SetupModal(c).open()) });
    this.addCommand({ id: 'new-shop', name: 'New source', callback: () => void this.inCurrentContext(c=>c.newPlace('shop')) });
    this.addCommand({ id: 'new-parking', name: 'New parking', callback: () => void this.inCurrentContext(c=>c.newPlace('parking')) });
    this.addCommand({ id: 'review-captures', name: 'Review captures', callback: () => void this.inCurrentContext(c=>c.reviewCaptures(true)) });
    this.addCommand({ id: 'add-visit', name: 'Add visit to current source', checkCallback: checking => {
      const workspace = this.app.workspace.getActiveViewOfType(SourcingWorkspace);
      const path = workspace ? workspace.currentPlacePath : this.app.workspace.getActiveFile()?.path;
      const file = path ? this.app.vault.getAbstractFileByPath(path) : undefined;
      const props = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
      const valid = !!path && !!this.contextRootForPath(path) && Array.isArray(props?.tags) && props.tags.some((tag: unknown) => tag === 'sourcing-source' || tag === 'charity-shop');
      if (valid && !checking) void this.inCurrentContext(c=>new VisitModal(c,path).open()); return valid;
    } });
    this.addCommand({ id: 'record-visit', name: 'Record a visit', callback: () => void this.inCurrentContext(c => chooseVisitSource(c)) });
    this.addCommand({ id: 'new-outing', name: 'New outing', callback: () => void this.inCurrentContext(c=>c.newOuting()) });
    this.addCommand({ id: 'resume-outing', name: 'Resume outing', callback: () => void this.inCurrentContext(async c=>{ const active=(await c.store.outings.list()).find(o=>o.status==='active'); await c.openFile(active?.path??c.root+'/Outings.md'); }) });
    this.addCommand({ id: 'open-outings', name: 'Browse outings', callback: () => void this.inCurrentContext(c=>c.openFile(c.root+'/Outings.md')) });
    this.addCommand({ id: 'new-locality', name: 'New locality', callback: () => void this.inCurrentContext(c=>c.newLocality()) });
    this.addCommand({ id: 'move-notebook', name: 'Move notebook', callback: () => void this.inCurrentContext(c=>new NotebookMoveModal(c).open()) });
    this.addCommand({id:'examples',name:'Add / open fictional examples',callback:()=>this.showExamples()});
    this.registerMarkdownCodeBlockProcessor('charity-sourcing', (source, el, ctx) => {
      const child = new NotebookBlock(el, this, source, ctx.sourcePath); ctx.addChild(child);
    });
    const schedule = () => { window.clearTimeout(this.captureTimer); this.captureTimer = window.setTimeout(() => void this.reviewCaptures(false), 800); };
    const isInbox = (path: string) => [this.store.root, ...(this.settings.previousRoots ?? [])].some(root => path.startsWith(root + '/Capture inbox/'));
    this.registerEvent(this.app.vault.on('create', file => { if (isInbox(file.path)) schedule(); }));
    this.registerEvent(this.app.metadataCache.on('changed', file => { if (isInbox(file.path)) schedule(); }));
    this.register(() => window.clearTimeout(this.captureTimer));
    this.app.workspace.onLayoutReady(() => {
      if (this.store.migrationActive) new Notice('Reseller sourcing needs organisation recovery. Open setup / help to restore the previous organisation.', 15000);
      else if (!this.settings.setupVersion) new Notice('Reseller sourcing is ready. Open setup to create a notebook or use one already synced to this vault.', 10000);
      else if (Platform.isMobileApp) schedule();
      else void this.prepareClipperGuidance().finally(schedule);
    });
  }
  onClipperStatusChanged(callback: () => void): () => void {
    this.clipperListeners.add(callback); return () => { this.clipperListeners.delete(callback); };
  }
  notifyClipperStatusChanged(): void { for (const callback of this.clipperListeners) callback(); }
  openClipperSetup(): void {
    if (!this.settings.setupVersion) { new SetupModal(this).open(); return; }
    new ClipperSetupModal(this).open();
  }
  private async prepareClipperGuidance(): Promise<void> {
    if (Platform.isMobileApp || this.rootOperation || this.editors || this.reviewOpen || this.store.migrationActive) return;
    try {
      await this.runRootOperation(() => this.store.refreshClipperTemplates());
      await showClipperUpdateNotice(this);
    } catch (error) { new Notice('Web Clipper templates need review. Open Set up / update Web Clipper: ' + errorText(error), 12000); }
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
  beginEditing(): (() => void) | undefined {
    if (this.rootOperation || this.store.migrationActive) { new Notice('Editing is paused while the notebook is moving or awaiting recovery. Open setup / help.'); return; }
    this.editors++; let ended = false;
    return () => { if (!ended) { ended = true; this.editors--; } };
  }
  async runRootOperation<T>(run: () => Promise<T>, recovery = false): Promise<T> {
    if (this.rootOperation) throw Error('An organisation change is already running.');
    if (this.editors || this.reviewOpen) throw Error('Save or close open capture and visit forms before changing organisation. Your draft has been kept.');
    if (this.store.migrationActive && !recovery) throw Error('Restore the previous organisation in Setup / help before starting another change.');
    this.rootOperation = true; window.clearTimeout(this.captureTimer);
    try { return await run(); }
    finally { this.rootOperation = false; }
  }
  async navigate(path: string, action: string): Promise<void> {
    if (!['drive','walk','listing'].includes(action)) return;
    const context = await this.contextForPath(path); if (!context) return;
    const places = await context.store.listPlaces(), place = places.find(p=>p.path===path); if (!place) return;
    const open = (coordinates:Coordinates|null) => {
      const url=navigationUrl(coordinates,action==='walk'?'walking':'driving');
      if (url) void context.openExternal(url,action==='walk'?'Walk here':'Drive here');
      else new Notice('Add valid coordinates before navigating.');
    };
    if(action==='listing') { const url=googleMapsUrl(place); if(url) await context.openExternal(url,'Google Maps'); return; }
    if(action==='walk'||place.kind==='parking') {open(place.coordinates);return;}
    const parking=resolveParking(place,places);
    if(parking.status==='choice') pickPlace(context,parking.choices,p=>open(p.coordinates),'Choose parking for this trip');
    else open(parking.destination?.coordinates??null);
  }
  async openFile(path: string): Promise<void> { const route = routeForPath(this.root, path); if (route) await openSourcingWorkspace(this, this, route); else await this.app.workspace.openLinkText(path, '', false); }
  async home(): Promise<void> {
    if (!this.settings.setupVersion || this.store.migrationActive) new SetupModal(this).open();
    else await this.openFile(this.store.root + '/Home.md');
  }
  newPlace(kind: PlaceKind, coords: Coordinates | null = null, shopPath?: string): void {
    if (!this.settings.setupVersion) { new SetupModal(this).open(); return; }
    new PlacePreparationModal(this, manualDraft(kind, coords), shopPath).open();
  }
  newOuting(): void {
    if (!this.settings.setupVersion) { new SetupModal(this).open(); return; }
    new NewOutingModal(this).open();
  }
  async resumeOuting(): Promise<void> {
    try {
      const outings = await this.store.outings.list();
      const active = outings.find(outing => outing.status === 'active');
      await this.openFile(active?.path ?? this.store.root + '/Outings.md');
    } catch (error) { new Notice(errorText(error)); }
  }
  newLocality(): void {
    if (this.rootOperation || this.store.migrationActive) { new Notice('Finish organisation recovery before creating an area.'); return; }
    new LocalityModal(this).open();
  }
  async reviewCaptures(explicit = true): Promise<void> { return this.reviewContextCaptures(this,explicit); }
  async reviewContextCaptures(context:NotebookContext,explicit = true): Promise<void> {
    if (!explicit) return;
    if (this.reviewOpen || this.rootOperation || context.store.migrationActive || !context.settings.setupVersion) return;
    try {
      const captures = await context.store.captures();
      if (explicit && captures.length > 1) { pickCapture(context, captures, file => this.reviewCapture(file,context)); return; }
      const file = captures.find(f => explicit || !this.seen.has(f.path));
      if (!file) { if (explicit) new Notice('No pending captures.'); return; }
      await this.reviewCapture(file,context);
    } catch (e) { new Notice('Capture kept for review: ' + errorText(e), 10000); }
  }
  private async reviewCapture(file: TFile, context:NotebookContext = this): Promise<void> {
    if (this.reviewOpen || this.rootOperation || context.store.migrationActive) return;
    this.reviewOpen = true;
    try {
      this.seen.add(file.path); const draft = await context.store.draft(file);
      const done = () => { this.reviewOpen = false; };
      const matches = draft.kind === 'shop' && draft.sourcePath ? await context.store.captureRefreshMatches(draft) : [];
      if (matches.length) new CaptureRefreshModal(context, draft, matches, done).open();
      else new CaptureModal(context, draft, undefined, done).open();
    } catch (e) { this.reviewOpen = false; throw e; }
  }
  async openClipperImportTools(): Promise<boolean> {
    if (!Platform.isDesktopApp) return false;
    await this.revealTemplates();
    return openChromeClipperSettings();
  }
  async revealTemplates(kind: PlaceKind = 'shop'): Promise<void> {
    const path = this.store.paths.templates + '/Web Clipper', adapter = this.app.vault.adapter;
    if (Platform.isDesktopApp && adapter instanceof FileSystemAdapter) {
      const { shell } = await import('electron');
      shell.showItemInFolder(adapter.getBasePath() + '/' + path + '/Capture ' + (kind === 'shop' ? 'source' : 'parking') + '.json');
    } else showSelectableText(this.app, path, 'Templates folder in this vault');
  }
}

class NotebookBlock extends MarkdownRenderChild {
  private generation = 0;
  private rendered?: MarkdownRenderChild;
  private timer?: number;
  private pendingRefresh = false;
  private map?: PlaceMap;
  private context?: NotebookContext;
  constructor(el: HTMLElement, private plugin: CharitySourcingPlugin, private source: string, private path: string) { super(el); }
  onload(): void {
    void this.render();
    if ((this.source.match(/view:\s*(\w+)/)?.[1] ?? 'place') === 'home') this.register(this.plugin.onClipperStatusChanged(() => void this.render()));
    const changed = (file: { path: string }) => {
      const ownRoot = this.plugin.contextRootForPath(this.path);
      const changedRoot = this.plugin.contextRootForPath(file.path);
      const examplesStatus = file.path === this.plugin.store.root + '/Examples/System/Practice state.json' && this.source.includes('view: home');
      if (!examplesStatus && ownRoot !== changedRoot && !(this.plugin.settings.previousRoots ?? []).some(r => file.path.startsWith(r + '/Capture inbox/'))) return;
      (this.containerEl.ownerDocument.defaultView ?? window).clearTimeout(this.timer); this.timer = (this.containerEl.ownerDocument.defaultView ?? window).setTimeout(() => {
        const focused = this.containerEl.ownerDocument.activeElement;
        if (focused && this.containerEl.contains(focused) && focused.matches('input,textarea,select,[contenteditable=true]')) { this.pendingRefresh = true; return; }
        this.pendingRefresh = false; void this.render();
      }, 180);
    };
    this.registerEvent(this.plugin.app.vault.on('modify', changed));
    this.registerEvent(this.plugin.app.vault.on('create', changed));
    this.registerEvent(this.plugin.app.vault.on('delete', changed));
    this.registerEvent(this.plugin.app.vault.on('rename', (f, old) => { changed(f); changed({ path: old }); }));
    this.registerDomEvent(this.containerEl, 'focusout', () => { if (this.pendingRefresh) { (this.containerEl.ownerDocument.defaultView ?? window).clearTimeout(this.timer); this.timer = (this.containerEl.ownerDocument.defaultView ?? window).setTimeout(() => { const focused = this.containerEl.ownerDocument.activeElement; if (focused && this.containerEl.contains(focused) && focused.matches('input,textarea,select,[contenteditable=true]')) return; this.pendingRefresh = false; void this.render(); }, 180); } });
    this.register(() => { rememberRenderState(this.containerEl, this.path); this.generation++; (this.containerEl.ownerDocument.defaultView ?? window).clearTimeout(this.timer); });
  }
  private disposeRendered():void {
    releasePracticeSettingsOwner(this);
    if(this.rendered) this.removeChild(this.rendered);
    this.rendered=undefined; this.map=undefined; this.context=undefined;
  }
  private async render(): Promise<void> {
    const generation = ++this.generation, view = this.source.match(/view:\s*(\w+)/)?.[1] ?? 'place';
    let context:NotebookContext | undefined;
    try { context = await this.plugin.contextForPath(this.path); } catch(error) {
      if(generation === this.generation) { this.disposeRendered(); this.containerEl.empty(); this.containerEl.createEl('p',{text:errorText(error),cls:'charity-error'}); } return;
    }
    if(generation !== this.generation) return;
    if(!context) { this.disposeRendered(); this.containerEl.empty(); this.containerEl.createEl('p',{text:'This notebook is unavailable. Deleted examples are not recreated automatically.',cls:'charity-empty-state'}); return; }
    if(this.context !== context) { this.disposeRendered(); this.context=context; }
    const restoreState = rememberRenderState(this.containerEl, this.path);
    if (['home', 'place', 'outing', 'outings', 'visit', 'visits', 'locality', 'localities'].includes(view)) {
      if (this.rendered) this.removeChild(this.rendered);
      this.rendered = undefined; this.map = undefined; this.containerEl.empty();
      button(this.containerEl, view === 'home' ? 'Open Sourcing workspace' : 'Open in Sourcing workspace', () => context.openFile(this.path), true);
      return;
    }
    if (view === 'place' && this.rendered && this.map) {
      try { await renderPlace(context, this.rendered, this.rendered.containerEl, this.path, this.map, () => generation === this.generation); } catch (e) { new Notice(errorText(e)); } finally { if (generation === this.generation) restoreState(); }
      return;
    }
    if (this.rendered) this.removeChild(this.rendered);
    this.containerEl.empty();
    const wrapper = this.containerEl.createDiv('charity-sourcing');
    const owner = this.rendered = new MarkdownRenderChild(wrapper); this.addChild(owner);
    try {
      if (view !== 'home') renderNotebookNavigation(context, wrapper);
      if (view === 'navigation') return;
      if (view === 'home') {
        await renderHome(context, owner, wrapper, () => generation === this.generation);
      } else if (view === 'visits') {
        const history = wrapper.createDiv();
        await renderVisitsHub(context, owner, history, embeddedVisitsHubState(this.containerEl, this.path), () => generation === this.generation);
      } else if (view === 'insights') {
        await renderVisitRecovery(context, wrapper, () => generation === this.generation);
        const results = wrapper.createDiv();
        await renderVisitInsights(context, owner, results, embeddedInsightsState(this.containerEl, this.path), () => generation === this.generation);
      } else if (view === 'visit') {
        await renderVisitNote(context, owner, wrapper, this.path, () => generation === this.generation);
      } else if(view === 'settings') {
        await renderPracticeSettings(context,wrapper,this);
      } else if (view === 'outings') {
        await renderOutingsHome(context, owner, wrapper, () => generation === this.generation);
      } else if (view === 'outing') {
        await renderOuting(context, owner, wrapper, this.path, () => generation === this.generation);
      } else if (view === 'localities' || view === 'locality') {
        const values = await context.store.listLocalities(); if (generation !== this.generation) return;
        if (view === 'locality') {
          const locality = values.find(l => l.path === this.path);
          if (locality) {
            wrapper.createEl('p', { text: locality.label, cls: 'charity-hint' });
            button(wrapper, 'Rename area / Change parent', () => new LocalityModal(context, locality).open());
          }
        } else {
          button(wrapper, 'New locality', () => context.newLocality(), true);
          if (!values.length) wrapper.createEl('p', { text: 'Create a town first, then choose it as the parent of nearby areas.', cls: 'charity-empty-state' });
          const search = wrapper.createEl('input', { type: 'search', placeholder: 'Search town or area', attr: { 'aria-label': 'Search areas' } });
          const list = wrapper.createEl('ul', { cls: 'charity-locality-list' });
          const renderList = () => {
            list.empty();
            for (const locality of values.filter(l => l.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
              const row = list.createEl('li'); button(row, locality.label, () => context.openFile(locality.path));
              button(row, 'Manage', () => new LocalityModal(context, locality).open());
            }
          };
          search.oninput = renderList; renderList();
        }
      } else {
        const map = await renderPlace(context, owner, wrapper, this.path, undefined, () => generation === this.generation);
        if (generation === this.generation) this.map = map;
      }
    } catch (e) { if (generation === this.generation) wrapper.createEl('p', { text: errorText(e), cls: 'charity-error' }); }
    finally { if (generation === this.generation) restoreState(); }
  }
}
class ConfirmLocation extends Modal {
  constructor(private plugin: NotebookContext, private path: string, private coordinates: Coordinates) { super(plugin.app); }
  onOpen(): void {
    this.titleEl.setText('Move this location?');
    this.contentEl.createEl('p', { text: this.path.split('/').at(-1) + ' → ' + this.coordinates.join(', ') });
    button(this.contentEl, 'Save location', async () => {
      const finish = this.plugin.beginEditing(); if (!finish) return;
      try { await this.plugin.store.updateCoordinates(this.path, this.coordinates); this.close(); } finally { finish(); }
    }, true);
  }
}
class ExamplesModal extends Modal {
  private closed = false;
  constructor(private plugin:CharitySourcingPlugin) {super(plugin.app);}
  onOpen():void {
    this.titleEl.setText('Fictional examples'); this.modalEl.addClass('charity-examples-modal');
    void this.render().catch(error=>{if(!this.closed)this.contentEl.createEl('p',{text:errorText(error),cls:'charity-error'});});
  }
  onClose():void {this.closed=true;}
  private async render():Promise<void> {
    const status=await this.plugin.examples.inspect(); if(this.closed)return;
    const el=this.contentEl;el.empty();
    el.createEl('p',{text:'A separate, editable sample notebook: 24 fictional sources, 8 parking places, 40 visits, 4 outings and 6 prepared captures.'});
    el.createEl('p',{text:status.root,cls:'charity-hint'});
    el.createEl('p',{text:status.message});
    if(status.state==='ready') {
      button(el,'Open examples',async()=>{this.close(); const context=await this.plugin.contextForPath(status.root+'/Home.md'); await context?.home();},true);
      return;
    }
    if(status.state==='conflict') return;
    el.createEl('p',{text:'All shop details and observations are invented. You can delete individual examples, the optional tour or the entire example notebook; repairs and updates never restore them.'});
    const progress=el.createDiv({attr:{role:'status','aria-live':'polite'}});
    const create=button(el,status.state==='partial'?'Continue adding examples':'Add examples',async()=>{
      progress.setText('Adding the fictional example notebook...'); progress.removeClass('charity-error');
      try {
        await this.plugin.runRootOperation(()=>this.plugin.examples.add());
        if(this.closed)return;
        this.close();const context=await this.plugin.contextForPath(status.root+'/Home.md');await context?.home();
      } catch(error) {
        if(this.closed)return;
        progress.setText('Examples were not completed: '+errorText(error)); progress.addClass('charity-error');
        create.setText('Continue adding examples');
      }
    },true);
  }
}
