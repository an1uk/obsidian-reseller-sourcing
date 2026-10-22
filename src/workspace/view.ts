import { propertyText } from '../domain/guards';
import { Component, ItemView, MarkdownRenderer, Menu, Notice, Platform, Setting, TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { NotebookContext, NotebookUiHost } from '../notebook-context';
import type { PlaceRecord } from '../types';
import type { OutingPreparation, PreparationDraft, WorkspaceRoute, WorkspaceViewState } from './types';
import { OutingPreparationModal } from './outing-preparation';
import { PlacePreparationModal } from './place-preparation';
import { button, ChangeAreaModal, CreditsModal, details, errorText, external, LocalityModal, manualDraft, PickModal, SetupModal, VisitModal } from '../ui';
import { inspectHome } from '../home/overview';
import { chooseVisitSource, resume } from '../ui/home';
import { renderOuting, renderOutingsHome, OutingVisitModal } from '../ui/outings';
import { renderOutingCatchup } from '../ui/outing-catchup';
import { openShortTripPreparation } from '../ui/outing-shortcuts';
import { renderVisitsHub } from '../ui/visit-history';
import { renderVisitHistory, renderVisitNote } from '../ui/visits';
import { VisitInsightsModal } from '../ui/visit-insights';
import { formatRating, googleMapsUrl, navigationUrl, resolveParking, telephoneUrl, websiteUrl } from '../domain';
import { mountPlaceMap, type PlaceMap } from '../map';
import { readNote } from '../storage/markdown';
import { routeForPath } from './routes';
import { workspaceContext } from './context';
import { isUnknownArray } from '../domain/guards';
import { renderPlacesBrowser } from './places-browser';
import { defaultPlaceQuery, normalisePlaceQuery, normalisePlaceSort, serialisePlaceQuery } from './place-query';
import { renderPlaceSummary } from '../ui/place-summary';
import { detailMapPlaces } from '../map/detail';
import { openPlaceEditor, resumePlaceEditor } from '../place-edit/editor';
import { checkedViewState, remapWorkspacePaths } from './view-state';
export { routeForPath } from './routes';

export const WORKSPACE_VIEW = 'reseller-sourcing-workspace';
const elementTarget = (value: EventTarget | null): value is Element => !!value && 'nodeType' in value && value.nodeType === 1;
export async function openSourcingWorkspace(host: NotebookUiHost, context: NotebookContext, route: WorkspaceRoute = { screen: 'home' }): Promise<void> {
  const leaves = host.app.workspace.getLeavesOfType(WORKSPACE_VIEW);
  const active = host.app.workspace.getActiveViewOfType(SourcingWorkspace);
  const existing = active?.root === context.root ? active.leaf : leaves.find(l => (l.view as SourcingWorkspace).root === context.root);
  const leaf = existing ?? host.app.workspace.getLeaf('tab');
  if (!existing) await leaf.setViewState({ type: WORKSPACE_VIEW, state: { root: context.root, route } });
  else await (leaf.view as SourcingWorkspace).navigate(route);
  await host.app.workspace.revealLeaf(leaf);
  host.app.workspace.setActiveLeaf(leaf, { focus: true });
}

export class SourcingWorkspace extends ItemView {
  private state: WorkspaceViewState = { root: '', route: { screen: 'home' } };
  context?: NotebookContext;
  private owner = new Component(); private generation = 0; private timer?: number; private closed = false;
  private body?: HTMLElement; private shell?: HTMLElement; private nav?: HTMLElement; private map?: PlaceMap;
  private history: WorkspaceRoute[] = []; private moreCount = 0;
  private pendingRefresh = false;
  private navigationRevision = 0;
  get root() { return this.state.root; }
  get currentPlacePath() { return this.state.route.screen === 'place' ? this.state.route.path : undefined; }
  constructor(leaf: WorkspaceLeaf, private host: NotebookUiHost) { super(leaf); }
  getViewType() { return WORKSPACE_VIEW; }
  getDisplayText() { return this.context?.kind === 'examples' ? 'Sourcing practice' : 'Reseller sourcing'; }
  getIcon() { return 'store'; }
  getState(): Record<string, unknown> {
    this.remember(); const state = structuredClone(this.state);
    if (state.places?.criteria) state.places.criteria = serialisePlaceQuery(state.places.criteria);
    return state as unknown as Record<string, unknown>;
  }
  async setState(raw: unknown, result: ViewStateResult) {
    this.navigationRevision++;
    const state = checkedViewState(raw);
    if (state) { this.body = undefined; this.state = state; }
    await this.bindContext(); await this.render(); await super.setState(raw, result);
  }
  private async bindContext() {
    const original = await this.host.contextForPath(this.root + '/Home.md');
    if (!original) throw Error('This notebook is unavailable. Open its Home after setup or attachment.');
    const open = async (path: string) => { const route = routeForPath(this.root, path); if (route) await this.navigate(route); else await this.openNote(path); };
    this.context = workspaceContext(original, {
      openFile: open,
      home: () => this.navigate({ screen: 'home' }),
      newOuting: () => { if (this.context) new OutingPreparationModal(this.context).open(); },
      newPlace: (kind, coordinates = null, source) => { if (this.context) new PlacePreparationModal(this.context, manualDraft(kind, coordinates), source).open(); },
    });
  }
  async onOpen() {
    this.owner.load();
    if (Platform.isMobileApp) {
      const measure = () => this.mobileInsets();
      this.registerDomEvent(this.contentEl.win, 'resize', measure);
      this.contentEl.win.visualViewport?.addEventListener('resize', measure);
      const bar = this.containerEl.ownerDocument.querySelector('.mobile-navbar');
      const resize = new ResizeObserver(measure), changes = new MutationObserver(measure);
      resize.observe(this.contentEl);
      if (bar) { resize.observe(bar); changes.observe(bar, { attributes: true, attributeFilter: ['class', 'style'] }); }
      this.register(() => { resize.disconnect(); changes.disconnect(); this.contentEl.win.visualViewport?.removeEventListener('resize', measure); });
    }
    this.registerDomEvent(this.contentEl, 'click', event => {
      const link = elementTarget(event.target) ? event.target.closest<HTMLAnchorElement>('a.internal-link') : null;
      const target = link?.getAttribute('data-href');
      if (!target) return;
      const file = this.app.metadataCache.getFirstLinkpathDest(target.split('#')[0], this.root + '/Home.md');
      const route = file && routeForPath(this.root, file.path);
      if (route) { event.preventDefault(); event.stopPropagation(); void this.navigate(route); }
    }, { capture: true });
    const update = (file: { path: string }) => {
      if (!file.path.startsWith(this.root + '/') || file.path.startsWith(this.root + '/Examples/')) return;
      this.contentEl.win.clearTimeout(this.timer); this.timer = this.contentEl.win.setTimeout(() => {
        if (this.closed) return;
        if (this.body?.contains(this.containerEl.ownerDocument.activeElement) && this.containerEl.ownerDocument.activeElement?.matches('input,textarea,select')) { this.pendingRefresh = true; return; }
        this.pendingRefresh = false;
        if (this.context && this.map && this.state.route.screen === 'area') { void this.refreshMap(); return; }
        void this.render().catch(e => this.showError(e));
      }, 180);
    };
    this.registerEvent(this.app.vault.on('modify', update)); this.registerEvent(this.app.vault.on('create', update)); this.registerEvent(this.app.vault.on('delete', update));
    this.registerDomEvent(this.contentEl, 'focusout', () => { if (this.pendingRefresh) update({ path: this.root + '/Home.md' }); });
    this.registerEvent(this.app.vault.on('rename', (file, old) => {
      if (old === this.root + '/Home.md') {
        const before = this.root; this.state.root = file.path.slice(0,-'/Home.md'.length);
        remapWorkspacePaths(this.state, this.history, before, this.root, true);
        this.context = undefined;
      } else remapWorkspacePaths(this.state, this.history, old, file.path);
      this.app.workspace.requestSaveLayout();
      update(file);
    }));
  }
  async onClose() { this.closed = true; ++this.generation; this.contentEl.win.clearTimeout(this.timer); this.owner.unload(); }
  private mobileInsets() {
    if (!Platform.isMobileApp || !this.shell || this.closed) return;
    const rect = this.contentEl.getBoundingClientRect(), bar = this.containerEl.ownerDocument.querySelector<HTMLElement>('.mobile-navbar');
    const overlap = bar?.checkVisibility() ? Math.max(0, Math.min(rect.height / 3, rect.bottom - bar.getBoundingClientRect().top + 8)) : 0;
    this.shell.style.setProperty('--charity-mobile-obstruction', overlap + 'px');
  }
  private key() { return JSON.stringify(this.state.route); }
  private remember() {
    if (!this.body) return;
    const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
    (this.state.positions ??= {})[this.key()] = { scroll: this.body.scrollTop, focus: this.body.contains(active) ? active?.getAttribute('data-workspace-focus') ?? undefined : undefined,
      expanded: Array.from(this.body.querySelectorAll<HTMLDetailsElement>('details[open]')).map(d => d.querySelector('summary')?.textContent ?? '') };
  }
  async navigate(route: WorkspaceRoute, back = false) {
    this.navigationRevision++;
    this.remember(); if (!back && JSON.stringify(route) !== this.key()) this.history.push(structuredClone(this.state.route));
    if (this.history.length > 40) this.history.shift(); this.state.route = route;
    await this.render(false); this.app.workspace.requestSaveLayout();
  }
  private async openNote(path: string, edit = false) {
    const file = path.split('#')[0];
    if (!file.startsWith(this.root + '/') || file.startsWith(this.root + '/Examples/') || !this.context?.store.scoped(file)) throw Error('Choose a note in this notebook.');
    const record = this.app.vault.getAbstractFileByPath(file);
    if (!(record instanceof TFile)) throw Error('This note no longer exists.');
    if (edit) await this.app.workspace.getLeaf('tab').openFile(record, { state: { mode: 'source' } });
    else await this.app.workspace.openLinkText(path, this.root + '/Home.md', true);
  }
  private showError(error: unknown) { if (!this.closed) { this.body?.createEl('p', { text: errorText(error), cls: 'charity-error' }); } }
  private async refreshMap() {
    if (!this.context || !this.map) return;
    const map = this.map, route = this.state.route, places = await this.context.store.listPlaces();
    if (this.closed || this.map !== map) return;
    if (route.screen === 'area') { const folder = route.path.replace(/\/Area\.md$/, '/'); map.setRecords(places.filter(p => p.locality === route.path || p.path.startsWith(folder))); }
    else if (route.screen === 'place' && !places.some(p => p.path === route.path)) await this.render();
    else if (route.screen === 'place') {
      const focus = places.find(p => p.path === route.path);
      if (focus) map.setRecords(detailMapPlaces(focus, places, this.context.mapHost));
    } else map.setRecords(places);
  }
  private async render(remember = true) {
    if (this.closed || !this.root) return;
    if (remember) this.remember(); const token = ++this.generation; this.owner.unload(); this.owner = new Component(); this.owner.load(); this.map = undefined;
    if (!this.context || this.context.root !== this.root) await this.bindContext(); if (token !== this.generation) return;
    const c = this.context!;
    // Keep the displayed screen until its replacement is ready, avoiding blank flashes during vault updates.
    const shell = this.contentEl.createDiv({ cls: 'charity-workspace' }); shell.detach(); this.shell = shell; shell.toggleClass('is-mobile', Platform.isMobileApp);
    this.nav = this.shell.createEl('nav', { cls: 'charity-workspace-nav', attr: { 'aria-label': 'Sourcing navigation' } });
    const current = ['place', 'area'].includes(this.state.route.screen) ? 'places' : ['outing', 'outing-catchup'].includes(this.state.route.screen) ? 'outings' : this.state.route.screen === 'visit' ? 'history' : this.state.route.screen;
    for (const [screen, label] of [['home', 'Home'], ['places', 'Places'], ['outings', 'Outings'], ['history', 'History']] as const) {
      const b = button(this.nav, label, () => this.navigate({ screen })); b.setAttribute('aria-current', current === screen ? 'page' : 'false'); b.toggleClass('is-current', current === screen);
    }
    const main = this.shell.createDiv('charity-workspace-main'), header = main.createDiv('charity-workspace-header');
    if (this.history.length) button(header, 'Back', async () => { const route = this.history.pop(); if (route) await this.navigate(route, true); });
    header.createSpan({ text: c.kind === 'examples' ? 'Practice notebook · fictional' : c.root === 'Reseller sourcing' ? '' : c.root, cls: 'charity-workspace-context' });
    button(header, this.moreCount ? 'More (' + this.moreCount + ')' : 'More', () => this.navigate({ screen: 'more' }));
    this.body = main.createEl('main', { cls: 'charity-workspace-body', attr: { tabindex: '-1' } });
    const el = this.body, route = this.state.route, active = () => !this.closed && token === this.generation;
    try {
      if (route.screen === 'home') await this.renderHome(el);
      else if (route.screen === 'places') await this.renderPlaces(el);
      else if (route.screen === 'outings') { el.createEl('h1', { text: 'Outings' }); await renderOutingsHome(c, this.owner, el, active); }
      else if (route.screen === 'history') { el.createEl('h1', { text: 'History' }); const content = el.createDiv(); await renderVisitsHub(c, this.owner, content, this.state.history ??= {}, active); }
      else if (route.screen === 'more') await this.renderMore(el);
      else if (route.screen === 'place') await this.renderPlace(el, route.path, route.section ?? 'overview');
      else if (route.screen === 'outing') {
        const record = await c.store.outings.get(route.path); el.createEl('h1', { text: record.name });
        const navigationRevision = this.navigationRevision, outingPath = route.path;
        const actionCurrent = () => !this.closed && navigationRevision === this.navigationRevision && this.root === c.root && this.state.route.screen === 'outing' && this.state.route.path === outingPath;
        await renderOuting(c, this.owner, el, outingPath, active, () => this.navigate({ screen: 'outing-catchup', path: outingPath }), actionCurrent);
      }
      else if (route.screen === 'outing-catchup') {
        el.createEl('h1', { text: 'Catch up on visits' });
        button(el.createDiv('charity-actions'), 'Back to outing', () => this.navigate({ screen: 'outing', path: route.path }));
        const catchupContent = el.createDiv(), navigationRevision = this.navigationRevision, catchupPath = route.path;
        const actionCurrent = () => !this.closed && navigationRevision === this.navigationRevision && this.root === c.root && this.state.route.screen === 'outing-catchup' && this.state.route.path === catchupPath;
        await renderOutingCatchup(c, this.owner, catchupContent, route.path, stopId => {
          new OutingVisitModal(c, catchupPath, stopId, async () => { if (actionCurrent()) await this.render(); }).open();
        }, active, actionCurrent);
      }
      else if (route.screen === 'visit') { await renderVisitNote(c, this.owner, el, route.path, active); }
      else if (route.screen === 'area') await this.renderArea(el, route.path);
    } catch (e) { if (active()) this.showError(e); }
    if (!active()) return;
    this.contentEl.replaceChildren(this.shell); this.mobileInsets();
    header.querySelector('button:last-child')?.setText(this.moreCount ? 'More (' + this.moreCount + ')' : 'More');
    if ('path' in route) button(el.createDiv('charity-workspace-note-link'), 'Open note', () => this.openNote(route.path));
    Array.from(el.querySelectorAll<HTMLElement>('button,input,textarea,summary')).forEach((n, i) => n.setAttribute('data-workspace-focus', n.getAttribute('data-workspace-focus') ?? n.getAttribute('aria-label') ?? n.textContent?.trim().slice(0, 70) ?? String(i)));
    const position = this.state.positions?.[this.key()];
    if (position) {
      for (const d of el.querySelectorAll<HTMLDetailsElement>('details')) if (position.expanded?.includes(d.querySelector('summary')?.textContent ?? '')) d.open = true;
      el.scrollTop = position.scroll;
      if (position.focus) Array.from(el.querySelectorAll<HTMLElement>('[data-workspace-focus]')).find(n => n.checkVisibility() && n.getAttribute('data-workspace-focus') === position.focus)?.focus({ preventScroll: true });
    }
  }
  private openPreparation(draft: PreparationDraft) {
    if (draft.kind === 'outing') { if (draft.data.shortTrip) openShortTripPreparation(this.context!, draft.id); else new OutingPreparationModal(this.context!, undefined, draft.id).open(); }
    else if (draft.kind === 'place-edit') void resumePlaceEditor(this.context!, draft.id).catch(e => new Notice(errorText(e)));
    else new PlacePreparationModal(this.context!, manualDraft('shop'), undefined, draft.id).open();
  }
  private async renderHome(el: HTMLElement) {
    const c = this.context!, [overview, prep] = await Promise.all([inspectHome(c), c.store.preparations.inspect()]);
    if (this.closed || this.body !== el) return;
    this.moreCount = overview.captures;
    const active = overview.outings.find(o => o.status === 'active' && !(c.kind === 'examples' && o.exampleBackground));
    const planning = prep.drafts.find((d): d is PreparationDraft<OutingPreparation> => d.kind === 'outing' && !d.deferred && d.phase === 'editing');
    el.createEl('h1', { text: active ? 'Continue your outing' : planning ? 'Your plan is saved' : !overview.sources.length ? 'Start with one place' : 'Where would you like to go?' });
    const lead = el.createDiv('charity-workspace-lead');
    if (!overview.sources.length) { lead.createEl('p', { text: 'Add a place you know. A name is enough to start.' }); button(lead, 'Add your first place', () => c.newPlace('shop'), true); }
    else if (active) { lead.createEl('p', { text: active.name }); button(lead, 'Continue outing', () => this.navigate({ screen: 'outing', path: active.path }), true); }
    else if (planning) {
      lead.createEl('p', { text: planning.data.name || (planning.data.shortTrip ? 'Your short-trip preferences are saved.' : 'Continue choosing places and reviewing the journey.') });
      button(lead, 'Continue planning', () => this.openPreparation(planning), true);
      button(lead, 'Not now', async () => { await c.store.preparations.defer(planning.id, planning.revision); await this.render(); });
    } else { lead.createEl('p', { text: 'Start with an area or your shortlist.' }); button(lead, 'Choose where to go', () => c.newOuting(), true); button(lead, 'I have about an hour', () => openShortTripPreparation(c)); }
    const quick = el.createDiv('charity-actions'); button(quick, 'Record a visit', () => chooseVisitSource(c)); button(quick, 'Find a place', () => this.navigate({ screen: 'places' }));
    const saved = details(el, 'Saved for later');
    for (const d of prep.drafts) { const row = saved.createDiv('charity-compact-row'); row.createSpan({ text: d.kind === 'outing' ? d.data.name || (d.data.shortTrip ? 'Short trip' : 'Outing preparation') : d.kind === 'place-edit' ? 'Edit ' + (d.data.snapshot.values.displayName || d.data.snapshot.path.split('/').pop()?.replace(/\.md$/, '') || 'place') : d.data.capture.name || 'Place preparation' }); button(row, d.phase === 'completing' ? 'Review saved completion' : 'Resume', () => this.openPreparation(d)); }
    for (const item of [overview.primary, ...overview.others].filter((v): v is NonNullable<typeof v> => !!v && v.outingPath !== active?.path)) {
      const row = saved.createDiv('charity-compact-row'); row.createSpan({ text: item.sourceName || item.label }); button(row, item.kind.endsWith('operation') ? 'Review save' : 'Resume', () => resume(c, item));
    }
    for (const outing of overview.outings.filter(o => o.status === 'planned' || o.status === 'active' && o !== active)) button(saved, outing.name, () => this.navigate({ screen: 'outing', path: outing.path }));
    if (!saved.querySelector('button')) saved.createEl('p', { text: 'No saved work waiting here.', cls: 'charity-hint' });
    for (const warning of [...overview.warnings, ...prep.warnings]) { const row = el.createDiv('charity-workspace-warning'); row.createEl('p', { text: warning.message, cls: 'charity-error' }); if (warning.path) button(row, 'Review saved file', () => this.openNote(warning.path!)); }
  }
  private async renderPlaces(el: HTMLElement) {
    const c = this.context!;
    el.createEl('h1', { text: 'Places' });
    const controls = el.createDiv('charity-actions');
    button(controls, 'Add a place', () => c.newPlace('shop')); button(controls, 'Add parking', () => c.newPlace('parking'));
    const f = this.state.places ??= { query: '', area: '', kind: 'shop', shortlist: false, view: 'list' };
    const browser = {
      query: f.criteria ?? normalisePlaceQuery({ text: f.query, area: f.area, kind: f.kind || 'all', shortlist: f.shortlist }),
      sort: normalisePlaceSort(f.sort), view: f.view,
    };
    const areas = await c.store.listLocalities();
    if (this.closed || this.body !== el) return;
    await renderPlacesBrowser(c, this.owner, el, browser, {
      open: path => this.navigate({ screen: 'place', path }),
      changed: () => {
        f.criteria = browser.query; f.sort = browser.sort; f.view = browser.view;
        f.query = browser.query.text; f.area = browser.query.area; f.kind = browser.query.kind === 'all' ? '' : browser.query.kind; f.shortlist = browser.query.shortlist;
        this.app.workspace.requestSaveLayout();
      },
      plan: (query, sort) => new OutingPreparationModal(c, undefined, undefined, { query, sort }).open(),
      more: parent => {
        button(parent, 'Source tables and comparisons', () => this.openNote(c.root + '/System/Sources.base'));
        button(parent, 'Parking tables', () => this.openNote(c.root + '/System/Parking.base'));
        button(parent, 'Manage areas', () => new PickModal(c, areas, a => a.label, a => this.navigate({ screen: 'area', path: a.path }), 'Choose area').open());
      },
    });
  }
  private async renderPlace(el: HTMLElement, path: string, section: 'overview' | 'map' | 'visits' | 'details') {
    const c = this.context!, [places, areas] = await Promise.all([c.store.listPlaces(), c.store.listLocalities()]); const p = places.find(v => v.path === path);
    if (this.closed || this.body !== el) return;
    if (!p) throw Error('This place no longer exists. Choose another from Places.');
    el.createEl('h1', { text: p.name }); el.createEl('p', { text: areas.find(a => a.path === p.locality)?.label ?? 'Unassigned', cls: 'charity-hint' });
    if (p.kind === 'shop') el.createEl('p', { text: formatRating(p.properties.rating) + (p.properties.comments ? ' · ' + propertyText(p.properties.comments) : '') });
    const edit = (section?: 'location' | 'assessment') => openPlaceEditor(c, path, {
      section, afterSave: () => this.render(),
      changeArea: () => new ChangeAreaModal(c, path).open(),
      manageParking: () => this.navigate({ screen: 'place', path, section: 'details' }),
    });
    const actions = el.createDiv('charity-actions'); button(actions, 'Edit place', () => edit());
    button(actions, 'Edit notes', () => this.openNote(path, true));
    if (p.kind === 'shop') button(actions, 'Record visit', () => new VisitModal(c, path).open(), true);
    const parking = p.kind === 'shop' ? resolveParking(p, places) : { status: 'single', destination: p, choices: [] as PlaceRecord[] };
    const directions = button(actions, 'Directions', () => {
      const menu = new Menu();
      if (parking.status === 'choice') menu.addItem(i => i.setTitle('Choose parking to drive to').onClick(() => new PickModal(c, parking.choices, v => v.name, v => { const url = navigationUrl(v.coordinates, 'driving'); if (!url) throw Error('Parking needs coordinates.'); return c.openExternal(url, 'Drive to parking'); }, 'Choose parking').open()));
      else if (parking.destination?.coordinates) { const destination = parking.destination; menu.addItem(i => i.setTitle(destination.kind === 'parking' ? 'Drive to ' + destination.name : 'Drive here').onClick(() => c.openExternal(navigationUrl(destination.coordinates, 'driving'), 'Driving directions'))); }
      if (p.coordinates) menu.addItem(i => i.setTitle('Walk here').onClick(() => c.openExternal(navigationUrl(p.coordinates, 'walking'), 'Walking directions')));
      if (googleMapsUrl(p)) menu.addItem(i => i.setTitle('Google Maps listing').onClick(() => c.openExternal(googleMapsUrl(p), 'Google Maps')));
      const box = directions.getBoundingClientRect(); menu.showAtPosition({ x: box.left, y: box.bottom });
    });
    if (p.kind === 'shop') new Setting(el).setName('Shortlist').addToggle(t => t.setValue(p.properties.shortlist === true).onChange(v => void c.store.updateAssessment(path, { shortlist: v }).catch(e => new Notice(errorText(e)))));
    const tabs = el.createDiv('charity-actions');
    for (const key of ['overview', 'map', 'visits', 'details'] as const) { if (key === 'visits' && p.kind === 'parking') continue; const b = button(tabs, key[0].toUpperCase() + key.slice(1), () => this.navigate({ screen: 'place', path, section: key })); b.setAttribute('aria-pressed', String(key === section)); }
    if (section === 'map') {
      if (!p.coordinates) { await renderPlaceSummary(c, this.owner, el, path, { showActions: false, showAssessment: false, onEdit: () => edit('location') }); return; }
      this.map = mountPlaceMap(this.owner, el, c.mapHost, { records: detailMapPlaces(p, places, c.mapHost), focusPath: p.path }); return;
    }
    if (section === 'visits') { button(el, 'Visit insights', () => new VisitInsightsModal(c, path).open()); await renderVisitHistory(c, this.owner, el, path); const list = el.querySelector('details'); if (list) list.open = true; return; }
    if (section === 'overview') {
      this.map = await renderPlaceSummary(c, this.owner, el, path, { showActions: false, showAssessment: false, isCurrent: () => !this.closed && this.body === el, onEdit: () => edit('location') });
      if (this.closed || this.body !== el) return;
      if (p.kind === 'shop') {
        const visits = await c.store.visits.list(path), reminder = visits.find(v => v.nextTime.trim());
        if (this.closed || this.body !== el) return;
        if (reminder) { el.createEl('h2', { text: 'Remember next time' }); el.createEl('p', { text: reminder.nextTime }); }
        el.createEl('p', { text: 'Last visit: ' + propertyText(p.properties.last_visited, 'No date recorded'), cls: 'charity-hint' });
        button(el, 'Update assessment', () => edit('assessment'));
      }
      const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile) {
        const body = readNote(await this.app.vault.read(file)).body.replace(/```charity-sourcing[\s\S]*?```/g, '').trim();
        if (this.closed || this.body !== el) return;
        if (body && body !== '## Notes') await MarkdownRenderer.render(this.app, body, details(el, 'Notes'), path, this.owner);
      }
      return;
    }
    external(c, el, 'Website', websiteUrl(p.properties.website)); external(c, el, 'Call', telephoneUrl(propertyText(p.properties.telephone)));
    button(el, 'Edit contacts', () => openPlaceEditor(c, path, { section: 'contacts', afterSave: () => this.render() })); button(el, 'Change area', () => new ChangeAreaModal(c, path).open());
    el.createEl('p', { text: 'Address: ' + propertyText(p.properties.address, 'Not set') });
    if (p.properties.opening_notes) el.createEl('p', { text: 'Opening notes: ' + propertyText(p.properties.opening_notes) });
    if (p.kind === 'shop') {
      if (p.properties.shop_closed) el.createEl('p', { text: 'Permanently closed', cls: 'charity-hint' });
      const links = details(el, 'Parking');
      links.createEl('p', { text: 'On site: ' + propertyText(p.properties.parking_on_site, 'unknown') + ' · ' + propertyText(p.properties.on_site_parking_cost, 'cost unknown') + ' · ' + propertyText(p.properties.on_site_parking_availability, 'availability unknown') });
      button(links, 'Edit parking details', () => openPlaceEditor(c, path, { section: 'parking', afterSave: () => this.render() }));
      button(links, 'Link parking', () => new PickModal(c, places.filter(v => v.kind === 'parking'), v => v.name, v => c.store.linkParking(v.path, path), 'Choose shared parking').open());
      button(links, 'Add parking', () => c.newPlace('parking', p.coordinates, path));
      for (const option of parking.choices) {
        const row = links.createDiv('charity-compact-row'); button(row, option.name, () => c.openFile(option.path));
        button(row, parking.destination?.path === option.path && parking.status === 'preferred' ? 'Preferred' : 'Use as preferred', () => c.store.setPreferredParking(path, option.path));
        button(row, 'Unlink', () => c.store.unlinkParking(option.path, path));
      }
      button(links, 'No preferred parking', () => c.store.setPreferredParking(path, ''));
    } else {
      el.createEl('p', { text: 'Parking: ' + propertyText(p.properties.parking_cost, 'cost unknown') + ' · ' + propertyText(p.properties.parking_availability, 'availability unknown') });
      const links = details(el, 'Sources served by this parking');
      button(links, 'Link a source', () => new PickModal(c, places.filter(v => v.kind === 'shop'), v => v.name, v => c.store.linkParking(path, v.path), 'Choose source').open());
      for (const source of places.filter(v => v.kind === 'shop' && resolveParking(v,places).choices.some(q => q.path === path))) {
        const row = links.createDiv('charity-compact-row'); button(row, source.name, () => c.openFile(source.path)); button(row, 'Unlink', () => c.store.unlinkParking(path, source.path));
      }
    }
    const captured = details(el, 'Captured Google details');
    captured.createEl('p', { text: 'Google ' + propertyText(p.properties.google_rating, 'unknown') + ' / 5 · ' + propertyText(p.properties.google_review_count, 'unknown') + ' reviews · checked ' + propertyText(p.properties.google_checked, 'unknown') });
    for (const [label, key, checked] of [['Opening hours', 'google_hours', 'google_hours_checked'], ['Review topics', 'google_review_topics', 'google_review_topics_checked']]) {
      captured.createEl('h3', { text: label }); captured.createEl('p', { text: 'Checked ' + propertyText(p.properties[checked], 'unknown'), cls: 'charity-hint' });
      const list = captured.createEl('ul'); for (const value of isUnknownArray(p.properties[key]) ? p.properties[key] : []) list.createEl('li', { text: propertyText(value) });
    }
  }
  private async renderArea(el: HTMLElement, path: string) {
    const c = this.context!, area = (await c.store.listLocalities()).find(a => a.path === path); if (!area) throw Error('Area no longer exists.');
    if (this.closed || this.body !== el) return;
    el.createEl('h1', { text: area.label }); button(el, 'Choose places here', () => { this.state.places = { query: '', area: path, kind: 'shop', shortlist: false, view: 'list', criteria: { ...defaultPlaceQuery(), area: path } }; return this.navigate({ screen: 'places' }); }, true);
    button(el, 'Rename or change parent', () => new LocalityModal(c, area).open());
    const places = (await c.store.listPlaces()).filter(p => p.locality === path || p.path.startsWith(c.root + '/Places/' + area.segments.join('/') + '/'));
    if (this.closed || this.body !== el) return;
    this.map = mountPlaceMap(this.owner, el, c.mapHost, { records: places, locality: true });
  }
  private async renderMore(el: HTMLElement) {
    const c = this.context!; el.createEl('h1', { text: 'More' });
    button(el, 'Review captures' + (this.moreCount ? ' (' + this.moreCount + ')' : ''), () => c.reviewCaptures(true));
    button(el, 'Web Clipper templates', () => c.openClipperSetup()); button(el, 'Guide', () => this.openNote(c.root + '/System/Guide.md'));
    button(el, c.kind === 'examples' ? 'Practice settings' : 'Settings', () => { if (c.kind === 'examples') return this.openNote(c.root + '/Settings.md'); (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.open(); (this.app as unknown as { setting: { openTabById(id: string): void } }).setting.openTabById('charity-sourcing'); });
    if (c.kind === 'real') { button(el, this.host.examplesAvailable ? 'Open examples' : 'Add examples', () => this.host.showExamples()); button(el, 'Setup and notebook tools', () => new SetupModal(c).open()); }
    else { if (c.tourPath && this.app.vault.getAbstractFileByPath(c.tourPath)) button(el, 'Optional guided tour', () => this.openNote(c.tourPath!)); if (c.referencePath) button(el, 'Worked illustrations', () => this.openNote(c.referencePath!)); button(el, 'Open real notebook', async () => { const real = await this.host.contextForPath(c.root.slice(0, -'/Examples'.length) + '/Home.md'); if (real) await openSourcingWorkspace(this.host, real); }); }
    button(el, 'About / Credits', () => new CreditsModal(c).open());
  }
}
