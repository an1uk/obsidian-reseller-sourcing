import { Component, Modal, Notice, Setting, TFile } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { PlaceRecord } from '../types';
import type { OutingGroup, OutingRecord, OutingStop, OutingVisitInput, OutingPlanningOptions } from '../outings/types';
import { proposeOutingGroups, suggestOutingOrder, suggestWalkingOrder, extractSourceContext } from '../outings/domain';
import { formatRating, googleMapsUrl, navigationUrl, resolveParking } from '../domain';
import { localDate } from '../storage/markdown';
import { mountPlaceMap } from '../map';
import { button, details, errorText, external, renderContextBanner } from '../ui';
import { OutingRouteModal } from './outing-route';
import { OutingPlannerModal } from './outing-planner';
import { StructuredVisitModal, renderVisitFields, visitDateSuggestion, visitInputFromRecord, visitSummary, renderVisitRecordDetails, type VisitEditor } from './visits';
import type { VisitRecord } from '../visits/types';
export { OutingPreparationModal as NewOutingModal } from '../workspace/outing-preparation';
import { OutingPreparationModal as NewOutingModal } from '../workspace/outing-preparation';

const clone = <T>(value: T): T => structuredClone(value);
const stopsOf = (record: { groups: OutingGroup[] }): OutingStop[] => record.groups.flatMap(group => group.stops);
const placeName = (path: string, places: PlaceRecord[]): string => places.find(place => place.path === path)?.name ?? path.split('/').pop()?.replace(/\.md$/, '') ?? 'Missing source';
const progress = (record: OutingRecord): string => {
  const stops = stopsOf(record);
  return stops.filter(stop => stop.status === 'visited').length + ' visited · ' +
    stops.filter(stop => stop.status === 'skipped').length + ' skipped · ' +
    stops.filter(stop => stop.status === 'pending').length + ' remaining';
};
async function editing<T>(plugin: NotebookContext, run: () => Promise<T>): Promise<T | undefined> {
  const finish = plugin.beginEditing(); if (!finish) return;
  try { return await run(); } finally { finish(); }
}
function move<T>(values: T[], index: number, direction: number): void {
  const target = index + direction;
  if (target < 0 || target >= values.length) return;
  [values[index], values[target]] = [values[target]!, values[index]!];
}
function warningList(el: HTMLElement, warnings: string[]): void {
  if (!warnings.length) return;
  const list = el.createEl('ul', { cls: 'charity-hint' });
  for (const warning of warnings) list.createEl('li', { text: warning });
}
function stopLabel(stop: OutingStop, places: PlaceRecord[]): string {
  return placeName(stop.sourcePath, places) + (stop.status === 'pending' ? '' : ' · ' + stop.status);
}

class LegacyOutingModal extends Modal {
  private places: PlaceRecord[] = [];
  private groups: OutingGroup[] = [];
  private record?: OutingRecord;
  private planning?: OutingPlanningOptions;
  private name = 'Sourcing ' + localDate();
  private unresolved = new Set<string>();
  private finishEditing?: () => void;
  private closed = false;
  private selectedEl!: HTMLElement;
  private candidateEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private candidateFilter = { text: '', area: '', type: '' };
  constructor(private plugin: NotebookContext, private existingPath?: string) { super(plugin.app); }
  onOpen(): void {
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.modalEl.addClass('charity-outing-modal'); this.titleEl.setText(this.existingPath ? 'Edit outing' : 'New outing');
    void this.load().catch(error => this.contentEl.createEl('p', { text: errorText(error), cls: 'charity-error' }));
  }
  private async load(): Promise<void> {
    const [places, areas] = await Promise.all([this.plugin.store.listPlaces(), this.plugin.store.listLocalities()]);
    if (this.closed) return; this.places = places;
    if (this.existingPath) {
      this.record = await this.plugin.store.outings.get(this.existingPath);
      if (this.closed) return;
      this.name = this.record.name; this.groups = clone(this.record.groups); this.planning = this.record.planning ? clone(this.record.planning) : undefined;
      if (this.record.operation || this.record.draft) {
        this.contentEl.createEl('p', { text: 'Finish, resume or discard the saved visit draft before editing this outing.', cls: 'charity-hint' });
        button(this.contentEl, 'Open outing', async () => { this.close(); await this.plugin.openFile(this.existingPath!); }); return;
      }
    }
    const el = this.contentEl; renderContextBanner(this.plugin, el);
    el.createEl('p', { text: 'Choose sources and parking for this outing. Shop shortlists and preferred parking stay as you set them.', cls: 'charity-hint' });
    new Setting(el).setName('Outing name').addText(text => { text.inputEl.setAttribute('aria-label', 'Outing name'); text.setValue(this.name).onChange(value => this.name = value); });
    const filters = el.createDiv('charity-outing-filters');
    const search = filters.createEl('input', { type: 'search', placeholder: 'Search sources', attr: { 'aria-label': 'Search outing sources' } });
    search.oninput = () => { this.candidateFilter.text = search.value; this.renderCandidates(); };
    const area = filters.createEl('select', { attr: { 'aria-label': 'Filter outing area' } }); area.createEl('option', { value: '', text: 'All areas' });
    for (const item of areas) area.createEl('option', { value: item.path, text: item.label });
    area.onchange = () => { this.candidateFilter.area = area.value; this.renderCandidates(); };
    const type = filters.createEl('select', { attr: { 'aria-label': 'Filter outing source type' } }); type.createEl('option', { value: '', text: 'All source types' });
    for (const item of [...new Set(places.filter(place => place.kind === 'shop').map(place => String(place.properties.source_type || 'Charity shop')))].sort()) type.createEl('option', { value: item, text: item });
    type.onchange = () => { this.candidateFilter.type = type.value; this.renderCandidates(); };
    const actions = el.createDiv('charity-actions');
    button(actions, 'Add shortlist', () => {
      for (const place of this.available().filter(place => place.properties.shortlist === true)) this.addSource(place);
      this.changed();
    });
    this.candidateEl = el.createDiv('charity-outing-candidates');
    this.selectedEl = el.createDiv('charity-outing-selected');
    this.previewEl = el.createDiv('charity-outing-order-preview'); this.previewEl.hide();
    const footer = el.createDiv('charity-modal-footer');
    const status = footer.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    button(footer, 'Save outing', async () => {
      if (!this.name.trim()) throw Error('Give this outing a name.');
      if (!stopsOf({ groups: this.groups }).length) throw Error('Add at least one source.');
      if (this.unresolved.size) throw Error('Choose parking or On foot for each source with several parking options.');
      status.setText('Saving…');
      try {
        const input = { name: this.name.trim(), groups: clone(this.groups), ...(this.planning ? { planning: clone(this.planning) } : {}) };
        const saved = this.record
          ? await this.plugin.store.outings.updatePlan(this.record.path, input, this.record.revision)
          : await this.plugin.store.outings.create(input);
        this.close(); await this.plugin.openFile(saved.path); new Notice('Outing saved');
      } catch (error) { status.setText('Not saved: ' + errorText(error)); status.addClass('charity-error'); }
    }, true);
    this.changed();
  }
  private available(): PlaceRecord[] {
    return this.places.filter(place => place.kind === 'shop' && place.properties.shop_closed !== true &&
      (!this.candidateFilter.area || place.locality === this.candidateFilter.area ||
        place.locality.startsWith(this.candidateFilter.area.replace(/\.md$/, '') + '/')) &&
      (!this.candidateFilter.type || String(place.properties.source_type || 'Charity shop') === this.candidateFilter.type) &&
      (!this.candidateFilter.text || [place.name, place.properties.address, place.properties.comments].join(' ').toLocaleLowerCase().includes(this.candidateFilter.text.toLocaleLowerCase())));
  }
  private addSource(place: PlaceRecord): void {
    if (stopsOf({ groups: this.groups }).some(stop => stop.sourcePath === place.path)) return;
    const proposed = proposeOutingGroups([place], this.places);
    const parking = resolveParking(place, this.places);
    if (proposed.issues.length || parking.status === 'choice' || parking.status === 'invalid') this.unresolved.add(place.path);
    const group = proposed.groups[0] ?? { id: crypto.randomUUID(), parkingPath: '', stops: [] };
    const stop = group.stops[0] ?? { id: crypto.randomUUID(), sourcePath: place.path, status: 'pending' as const };
    const existing = group.parkingPath ? this.groups.find(item => item.parkingPath === group.parkingPath) : undefined;
    if (existing) existing.stops.push(stop); else this.groups.push({ ...group, id: crypto.randomUUID(), stops: [stop] });
  }
  private changed(): void {
    if (this.planning) {
      const ids = new Set(stopsOf({ groups: this.groups }).map(stop => stop.id));
      this.planning.stopOverrides = Object.fromEntries(Object.entries(this.planning.stopOverrides).filter(([id]) => ids.has(id)));
    }
    this.previewEl?.hide(); this.previewEl?.empty(); this.renderCandidates(); this.renderSelected();
  }
  private renderCandidates(): void {
    if (!this.candidateEl) return; this.candidateEl.empty();
    const selected = new Set(stopsOf({ groups: this.groups }).map(stop => stop.sourcePath));
    const places = this.available().filter(place => !selected.has(place.path));
    if (!places.length) this.candidateEl.createEl('p', { text: 'No more matching sources.', cls: 'charity-hint' });
    for (const place of places) {
      const row = new Setting(this.candidateEl).setName(place.name).setDesc(String(place.properties.comments || formatRating(place.properties.rating)));
      row.addButton(b => {
        b.setButtonText('Add'); b.buttonEl.setAttribute('aria-label', 'Add ' + place.name);
        b.onClick(() => { this.addSource(place); this.changed(); });
      });
    }
  }
  private chooseParking(stop: OutingStop, old: OutingGroup, path: string): void {
    this.unresolved.delete(stop.sourcePath); old.stops = old.stops.filter(item => item.id !== stop.id);
    const target = path ? this.groups.find(group => group.parkingPath === path && group.id !== old.id) : undefined;
    if (target) target.stops.push(stop);
    else if (!old.stops.length) { old.parkingPath = path; old.stops.push(stop); }
    else this.groups.push({ id: crypto.randomUUID(), parkingPath: path, stops: [stop] });
    this.groups = this.groups.filter(group => group.stops.length); this.changed();
  }
  private renderSelected(): void {
    if (!this.selectedEl) return; this.selectedEl.empty();
    this.selectedEl.createEl('h3', { text: 'Selected stops (' + stopsOf({ groups: this.groups }).length + ')' });
    if (!this.groups.length) { this.selectedEl.createEl('p', { text: 'Add a source or your shortlist to begin.', cls: 'charity-hint' }); return; }
    const planningActions = this.selectedEl.createDiv('charity-actions');
    button(planningActions, 'Plan journey', () => {
      if (this.unresolved.size) throw Error('Choose parking or On foot for each source with several parking options before planning.');
      new OutingPlannerModal(this.plugin, {
        draft: () => {
          if (this.closed) throw Error('The outing draft is closed.');
          return { ...(this.record ?? { id: 'unsaved-outing', path: '', status: 'planned' as const, createdAt: '', revision: '' }),
            name: this.name, groups: clone(this.groups), planning: this.planning ? clone(this.planning) : undefined };
        },
        onApplyDraft: (groups, options) => {
          if (this.closed) throw Error('The outing draft is closed.');
          this.groups = clone(groups); this.planning = clone(options); this.changed();
        },
      }).open();
    });
    const order = new Setting(this.selectedEl).setName('First parking / walking group');
    let firstGroup = this.groups.find(group => group.stops.some(stop => stop.status === 'pending'))?.id ?? '';
    order.addDropdown(d => {
      for (const group of this.groups) if (group.stops.some(stop => stop.status === 'pending')) d.addOption(group.id, this.groupName(group));
      d.setValue(firstGroup).onChange(value => firstGroup = value);
    });
    order.addButton(b => b.setButtonText('Preview suggested order').onClick(() => {
      const suggestion = suggestOutingOrder(clone(this.groups), this.places, firstGroup);
      this.previewOrder(suggestion.groups, suggestion.warnings);
    }));
    this.selectedEl.createEl('p', { text: 'Suggested order uses straight-line distance. Review it for roads, entrances and walking access; it is not a route or travel-time estimate.', cls: 'charity-hint' });
    this.groups.forEach((group, index) => {
      const section = this.selectedEl.createDiv('charity-outing-group');
      section.createEl('h4', { text: (index + 1) + '. ' + this.groupName(group) });
      const controls = section.createDiv('charity-outing-stop-actions');
      const hasCompleted = group.stops.some(stop => stop.status !== 'pending');
      const up = button(controls, 'Move group up', () => { move(this.groups, index, -1); this.changed(); });
      up.disabled = index === 0 || hasCompleted || this.groups[index - 1]?.stops.some(stop => stop.status !== 'pending') === true;
      const down = button(controls, 'Move group down', () => { move(this.groups, index, 1); this.changed(); });
      down.disabled = index === this.groups.length - 1 || hasCompleted || this.groups[index + 1]?.stops.some(stop => stop.status !== 'pending') === true;
      let firstStop = '';
      const walking = new Setting(section).setName('Walking order');
      walking.addDropdown(d => {
        d.addOption('', group.parkingPath ? 'Start from parking' : 'Choose a first source');
        for (const stop of group.stops.filter(stop => stop.status === 'pending')) d.addOption(stop.id, placeName(stop.sourcePath, this.places));
        d.onChange(value => firstStop = value);
      });
      walking.addButton(b => b.setButtonText('Preview walking order').onClick(() => {
        const suggestion = suggestWalkingOrder(clone(group), this.places, firstStop || undefined);
        this.previewOrder(this.groups.map(value => value.id === group.id ? suggestion.group : clone(value)), suggestion.warnings);
      }));
      group.stops.forEach((stop, stopIndex) => {
        const row = section.createDiv('charity-outing-stop');
        row.createEl('p', { text: (stopIndex + 1) + '. ' + stopLabel(stop, this.places) });
        const place = this.places.find(value => value.path === stop.sourcePath);
        if (!place) row.createEl('p', { text: 'This source note is missing. Remove this pending stop or restore the note.', cls: 'charity-error' });
        if (place && stop.status === 'pending') {
          const choices = resolveParking(place, this.places).choices;
          new Setting(row).setName('Parking for this outing').addDropdown(d => {
            d.selectEl.setAttribute('aria-label', 'Parking for ' + place.name);
            if (this.unresolved.has(place.path)) d.addOption('__choose__', 'Choose parking…');
            d.addOption('', 'On foot / source location');
            for (const option of choices) d.addOption(option.path, option.name + (!option.coordinates ? ' (needs coordinates)' : ''));
            if (group.parkingPath && !choices.some(option => option.path === group.parkingPath)) d.addOption(group.parkingPath, placeName(group.parkingPath, this.places));
            d.setValue(this.unresolved.has(place.path) ? '__choose__' : group.parkingPath);
            d.onChange(value => { if (value !== '__choose__') this.chooseParking(stop, group, value); });
          });
        }
        const actions = row.createDiv('charity-outing-stop-actions');
        const up = button(actions, 'Move up', () => { move(group.stops, stopIndex, -1); this.changed(); });
        up.disabled = stop.status !== 'pending' || stopIndex === 0 || group.stops[stopIndex - 1]?.status !== 'pending';
        const down = button(actions, 'Move down', () => { move(group.stops, stopIndex, 1); this.changed(); });
        down.disabled = stop.status !== 'pending' || stopIndex === group.stops.length - 1 || group.stops[stopIndex + 1]?.status !== 'pending';
        if (stop.status === 'pending') button(actions, 'Remove stop', () => {
          group.stops = group.stops.filter(value => value.id !== stop.id); this.groups = this.groups.filter(value => value.stops.length);
          this.unresolved.delete(stop.sourcePath); this.changed();
        });
      });
    });
  }
  private groupName(group: OutingGroup): string { return group.parkingPath ? 'Park at ' + placeName(group.parkingPath, this.places) : 'On foot · ' + placeName(group.stops[0]?.sourcePath ?? '', this.places); }
  private previewOrder(groups: OutingGroup[], warnings: string[]): void {
    this.previewEl.empty(); this.previewEl.show();
    this.previewEl.createEl('h4', { text: 'Suggested order preview' }); warningList(this.previewEl, warnings);
    const list = this.previewEl.createEl('ol');
    for (const group of groups) {
      const row = list.createEl('li', { text: this.groupName(group) });
      row.createEl('p', { text: group.stops.map(stop => stopLabel(stop, this.places)).join(' → ') });
    }
    button(this.previewEl, 'Use suggested order', () => { this.groups = clone(groups); this.changed(); });
    button(this.previewEl, 'Keep current order', () => this.previewEl.hide());
  }
  onClose(): void { this.closed = true; this.finishEditing?.(); this.contentEl.empty(); }
}

export async function renderOutingsHome(plugin: NotebookContext, owner: Component, el: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const outings = await plugin.store.outings.list(); if (!isCurrent()) return;
  renderContextBanner(plugin, el); el.addClass('charity-outing');
  const actions = el.createDiv('charity-actions'); button(actions, 'New outing', () => new NewOutingModal(plugin).open(), true);
  if (!outings.length) { el.createEl('p', { text: 'Create an outing from your shortlist or choose sources by area. Progress belongs to the outing; your shop shortlist is independent.', cls: 'charity-empty-state' }); return; }
  for (const state of ['active', 'planned', 'finished'] as const) {
    const values = outings.filter(record => record.status === state); if (!values.length) continue;
    const section = state === 'finished' ? details(el, 'Finished outings (' + values.length + ')') : el.createDiv();
    if (state !== 'finished') section.createEl('h3', { text: state === 'active' ? 'Current outing' : 'Planned outings' });
    for (const record of values) {
      const row = section.createDiv('charity-outing-history-row');
      row.createEl('strong', { text: record.name }); row.createEl('p', { text: progress(record), cls: 'charity-outing-summary' });
      const actions = row.createDiv('charity-actions');
      button(actions, state === 'active' ? 'Continue outing' : 'Open outing', () => plugin.openFile(record.path), state === 'active');
      if (state !== 'active') button(actions, state === 'finished' ? 'Resume unfinished stops' : 'Start outing', async () => {
        await editing(plugin, async () => { await plugin.store.outings.start(record.path, record.revision); await plugin.openFile(record.path); });
      });
    }
  }
}
export class OutingHistoryModal extends Modal {
  private owner = new Component();
  constructor(private plugin: NotebookContext) { super(plugin.app); }
  onOpen(): void {
    this.titleEl.setText('Outings'); this.modalEl.addClass('charity-outing-modal'); this.owner.load();
    void renderOutingsHome(this.plugin, this.owner, this.contentEl).catch(error => this.contentEl.createEl('p', { text: errorText(error), cls: 'charity-error' }));
  }
  onClose(): void { this.owner.unload(); this.contentEl.empty(); }
}

function mapRecords(record: OutingRecord, places: PlaceRecord[]): PlaceRecord[] {
  const result: PlaceRecord[] = [], parking = new Map<string, PlaceRecord>();
  for (const group of record.groups) {
    const savedParking = places.find(place => place.path === group.parkingPath && place.kind === 'parking');
    if (savedParking && !parking.has(savedParking.path)) parking.set(savedParking.path, { ...savedParking, properties: { ...savedParking.properties, parking_for: [] } });
    for (const stop of group.stops) {
      const source = places.find(place => place.path === stop.sourcePath); if (!source) continue;
      result.push({ ...source, properties: { ...source.properties, parking_location: group.parkingPath ? '[[' + group.parkingPath.replace(/\.md$/, '') + ']]' : '' } });
      const option = parking.get(group.parkingPath);
      if (option) (option.properties.parking_for as string[]).push('[[' + stop.sourcePath.replace(/\.md$/, '') + ']]');
    }
  }
  return [...result, ...parking.values()];
}
async function sourceContext(plugin: NotebookContext, el: HTMLElement, place: PlaceRecord, isCurrent: () => boolean): Promise<void> {
  const file = plugin.app.vault.getAbstractFileByPath(place.path); if (!(file instanceof TFile)) return;
  const text = await plugin.app.vault.read(file); if (!isCurrent()) return;
  const context = extractSourceContext(text);
  const visits = await plugin.store.visits.list(place.path); if (!isCurrent()) return;
  const latest = visits.filter(visit => visit.nextTime.trim()).sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.recordedAt.localeCompare(a.recordedAt))[0];
  if (latest && (!context.reminder || latest.visitDate >= context.reminderDate)) { context.reminder = latest.nextTime; context.reminderDate = latest.visitDate; }
  if (context.reminder) {
    const long = context.reminder.length > 180 || context.reminder.split('\n').length > 3;
    const reminder = long ? details(el, 'Remember next time') : el;
    if (!long) reminder.createEl('strong', { text: 'Remember next time' });
    reminder.createEl('p', { text: context.reminder, cls: 'charity-outing-context' });
    if (context.reminderDate) reminder.createEl('p', { text: 'From visit ' + context.reminderDate, cls: 'charity-hint' });
  }
  if (context.hours.length) {
    const hours = details(el, 'Saved opening hours' + (context.hoursChecked ? ' · checked ' + context.hoursChecked : ''));
    hours.createEl('p', { text: context.hours.join('\n'), cls: 'charity-outing-context' });
    hours.createEl('p', { text: 'A saved snapshot. Check the listing if timing matters.', cls: 'charity-hint' });
  }
}
export async function renderOuting(plugin: NotebookContext, owner: Component, el: HTMLElement, path: string, isCurrent: () => boolean = () => true): Promise<void> {
  const [record, places, visits] = await Promise.all([plugin.store.outings.get(path), plugin.store.listPlaces(), plugin.store.visits.list()]); if (!isCurrent()) return;
  const visitRecords = new Map(visits.map(visit => [visit.path, visit]));
  el.addClass('charity-outing'); el.createEl('p', { text: record.status + ' · ' + progress(record), cls: 'charity-outing-summary' });
  const act = (run: () => Promise<unknown>) => editing(plugin, run);
  const primary = el.createDiv('charity-actions charity-outing-primary');
  if (record.exampleBackground) button(primary, 'Resume outing', () => act(() => plugin.store.outings.start(path, record.revision)), true);
  if (record.status === 'finished') button(primary, 'Review visits', () => new OutingVisitsModal(plugin, path).open(), true);
  const tools = details(el, 'Outing tools'); tools.setAttribute('data-charity-section', 'outing-tools');
  const actions = tools.createDiv('charity-actions');
  if (record.status !== 'finished') button(actions, 'Review visits', () => new OutingVisitsModal(plugin, path).open());
  const route = button(actions, plugin.externalActions === 'preview' ? 'Preview route in Google Maps' : 'Open route in Google Maps', () => new OutingRouteModal(plugin, path).open());
  const planner = button(actions, 'Plan journey', () => new OutingPlannerModal(plugin, { path }).open());
  planner.disabled = !!record.operation || !!record.draft;
  if (planner.disabled) planner.title = 'Finish, resume or discard the saved visit draft before planning.';
  route.disabled = !!record.operation;
  if (record.operation) route.title = 'Complete or resolve the unfinished visit save before exporting a route.';
  if (record.status !== 'active' && !record.operation) button(record.status === 'planned' ? primary : actions, record.status === 'finished' ? 'Resume unfinished stops' : 'Start outing', () => act(() => plugin.store.outings.start(path, record.revision)), record.status === 'planned');
  if (!record.operation && !record.draft) button(actions, 'Edit stops and order', () => new NewOutingModal(plugin, path).open());
  if (record.status === 'active' && !record.operation) button(actions, 'Finish outing', () => new FinishOutingModal(plugin, record).open());
  if (record.operation) {
    const recovery = el.createDiv('charity-empty-state');
    recovery.createEl('p', { text: 'A visit save needs completion. Its saved input is retained; retry completion before changing outing progress.', cls: 'charity-error' });
    button(recovery, 'Retry completion', () => act(() => plugin.store.outings.resumeVisit(path)), true);
    recovery.createEl('p', { text: 'Cancel unsaved attempt keeps the draft. It is available only before a visit has been written; saved visits are retained.', cls: 'charity-hint' });
    button(recovery, 'Cancel unsaved attempt', () => act(() => plugin.store.outings.cancelPendingVisit(path)));
  }
  if (record.draft && !record.operation) {
    const draft = el.createDiv('charity-empty-state');
    draft.createEl('p', { text: 'Unfinished visit for ' + placeName(stopsOf(record).find(stop => stop.id === record.draft!.stopId)?.sourcePath ?? '', places) + ' · saved ' + record.draft.updatedAt });
    if (record.status !== 'active') draft.createEl('p', { text: 'Saving these visit details keeps the outing status as it is.', cls: 'charity-hint' });
    button(draft, 'Resume visit draft', async () => {
      new OutingVisitModal(plugin, path, record.draft!.stopId).open();
    }, true);
    button(details(draft, 'More'), 'Discard visit draft', () => new DiscardDraftModal(plugin, record).open());
  }
  const currentGroup = record.groups.find(group => group.stops.some(stop => stop.status === 'pending'));
  const current = currentGroup?.stops.find(stop => stop.status === 'pending');
  const lastCompleted = record.groups.flatMap(group => group.stops
    .filter(stop => stop.status !== 'pending' && stop.completedAt)
    .map(stop => ({ group, completedAt: stop.completedAt! })))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0]?.group;
  if (lastCompleted?.parkingPath && lastCompleted.id !== currentGroup?.id) {
    const parking = places.find(place => place.path === lastCompleted.parkingPath);
    const back = el.createDiv('charity-empty-state');
    back.createEl('p', { text: 'Parking for the last completed group: ' + placeName(lastCompleted.parkingPath, places), cls: 'charity-hint' });
    const url = navigationUrl(parking?.coordinates ?? null, 'walking');
    if (url) external(plugin, back.createDiv('charity-actions'), 'Return to parking · ' + placeName(lastCompleted.parkingPath, places), url);
    else back.createEl('p', { text: 'Add valid coordinates to this parking note for walking directions.', cls: 'charity-hint' });
  }
  if (current && currentGroup) {
    const card = el.createDiv('charity-outing-current'), place = places.find(value => value.path === current.sourcePath);
    card.createEl('h3', { text: (record.status === 'finished' ? 'Unfinished stop · ' : 'Next stop · ') + placeName(current.sourcePath, places) });
    if (record.status === 'active' && !record.operation) {
      const actions = card.createDiv('charity-actions charity-outing-progress-actions');
      if (place && (!record.draft || record.draft.stopId === current.id)) button(actions, record.draft ? 'Resume visit draft' : 'Record visit', () => new OutingVisitModal(plugin, path, current.id).open(), true);
      if (!record.draft) {
        button(actions, 'Visited without notes', () => act(() => plugin.store.outings.completeStop(path, current.id, 'visited', record.revision)));
        button(actions, 'Skip stop', () => new SkipStopModal(plugin, record, current).open());
      }
    }
    if (place) {
      card.createEl('p', { text: formatRating(place.properties.rating) + (place.properties.comments ? ' · ' + String(place.properties.comments) : ''), cls: 'charity-outing-summary' });
      const lastVisited = String(place.properties.last_visited ?? '').trim();
      card.createEl('p', { text: lastVisited ? 'Last visit: ' + lastVisited : 'No visit recorded', cls: 'charity-hint' });
      const parking = places.find(value => value.path === currentGroup.parkingPath);
      card.createEl('p', { text: currentGroup.parkingPath ? 'Parking: ' + placeName(currentGroup.parkingPath, places) : 'On foot / source location', cls: 'charity-hint' });
      const links = card.createDiv('charity-actions');
      external(plugin, links, 'Google Maps', googleMapsUrl(place));
      external(plugin, links, currentGroup.parkingPath ? 'Drive to parking' : 'Drive to source', navigationUrl(currentGroup.parkingPath ? parking?.coordinates ?? null : place.coordinates, 'driving'));
      external(plugin, links, 'Walk to source', navigationUrl(place.coordinates, 'walking'));
      if (currentGroup.parkingPath) external(plugin, links, 'Return to parking · ' + placeName(currentGroup.parkingPath, places), navigationUrl(parking?.coordinates ?? null, 'walking'));
      if (currentGroup.parkingPath && !parking?.coordinates) card.createEl('p', { text: 'Chosen parking needs valid coordinates before driving directions are available.', cls: 'charity-hint' });
      button(links, 'Open place', () => plugin.openFile(place.path));
      await sourceContext(plugin, card, place, isCurrent); if (!isCurrent()) return;
    } else card.createEl('p', { text: 'This source note is missing. You can skip this stop or restore the note.', cls: 'charity-error' });

  } else el.createEl('p', { text: record.status === 'finished' ? 'This outing is finished. Its visits remain available to review.' : 'All stops have an outcome. Finish the outing when you are ready.', cls: 'charity-empty-state' });
  el.appendChild(tools);
  const list = details(el, 'All stops (' + stopsOf(record).length + ')');
  for (const group of record.groups) {
    const section = list.createDiv('charity-outing-group');
    section.createEl('h4', { text: group.parkingPath ? 'Park at ' + placeName(group.parkingPath, places) : 'On foot / source location' });
    for (const stop of group.stops) {
      const row = section.createDiv('charity-outing-stop');
      const heading = row.createDiv('charity-outing-stop-heading');
      heading.createSpan({ text: placeName(stop.sourcePath, places) }); heading.createSpan({ text: stop.status, cls: 'charity-outing-status' });
      if (stop.skipReason) row.createEl('p', { text: stop.skipReason });
      const actions = row.createDiv('charity-outing-stop-actions');
      button(actions, 'Open source', () => plugin.openFile(stop.sourcePath));
      renderStopVisitActions(plugin, row, actions, record, stop, visitRecords);
      if (stop.status !== 'pending' && !record.operation && !record.draft) button(actions, 'Undo', () => act(() => plugin.store.outings.undo(path, stop.id, record.revision)));
    }
  }
  list.createEl('p', { text: 'Undo restores a pending stop. Saved visit notes and earlier inline logs are retained.', cls: 'charity-hint' });
  const map = details(el, 'Outing map'); const canvas = map.createDiv('charity-outing-map'); let mounted = false;
  map.ontoggle = () => {
    if (!map.open || mounted || !isCurrent()) return; mounted = true;
    const records = mapRecords(record, places);
    mountPlaceMap(owner, canvas, { ...plugin.mapHost, getPlaces: async () => records,
      openParking: () => { new Notice('Open the source note to add parking, then edit this outing.'); },
      confirmMove: () => { new Notice('Open the place note to change its saved location.'); } }, { records, locality: true, readOnly: true });
  };
}


function renderStopVisitActions(context: NotebookContext, row: HTMLElement, actions: HTMLElement, outing: OutingRecord, stop: OutingStop, visits: Map<string, VisitRecord>): void {
  const visit = stop.visitPath ? visits.get(stop.visitPath) : undefined;
  if (visit) {
    row.createEl('p', { text: 'Visit ' + visit.visitDate + ' · ' + visitSummary(visit), cls: 'charity-visit-summary' });
    const more = details(row, 'Visit details'); renderVisitRecordDetails(more, visit);
    button(actions, 'Open visit', () => context.openFile(visit.path));
    if (!outing.operation && !outing.draft) button(actions, 'Edit visit', () => new StructuredVisitModal(context, stop.sourcePath, visit.path).open());
    return;
  }
  if (stop.visitPath) {
    row.createEl('p', { text: 'The linked visit note is unavailable. Restore it before editing these details.', cls: 'charity-error' }); return;
  }
  if (outing.operation || outing.draft) return;
  if (stop.status === 'visited') {
    row.createEl('p', { text: 'No separate visit details yet. Earlier inline notes are retained in the source.', cls: 'charity-hint' });
    button(actions, 'Add visit details', () => new OutingVisitModal(context, outing.path, stop.id).open());
  } else if (stop.status === 'skipped') button(actions, 'Record visit instead', () => new OutingVisitModal(context, outing.path, stop.id).open());
  else if (outing.status === 'active' || outing.status === 'finished') button(actions, 'Record visit', () => new OutingVisitModal(context, outing.path, stop.id).open());
}
export class OutingVisitsModal extends Modal {
  private closed = false;
  private owner = new Component();
  private generation = 0;
  private timer?: number;
  constructor(private context: NotebookContext, private path: string) { super(context.app); }
  onOpen(): void {
    this.titleEl.setText('Review outing visits'); this.modalEl.addClass('charity-outing-modal'); this.owner.load();
    const refresh = () => { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => { void this.load().catch(error => { if (!this.closed) new Notice(errorText(error)); }); }, 150); };
    for (const event of ['create', 'modify', 'delete', 'rename'] as const) this.owner.registerEvent(this.context.app.vault.on(event as 'modify', refresh));
    void this.load().catch(error => { if (!this.closed) this.contentEl.createEl('p', { text: errorText(error), cls: 'charity-error' }); });
  }
  private async load(): Promise<void> {
    const generation = ++this.generation;
    const [record, places, visits] = await Promise.all([this.context.store.outings.get(this.path), this.context.store.listPlaces(), this.context.store.visits.list()]);
    if (this.closed || generation !== this.generation) return;
    this.contentEl.empty(); renderContextBanner(this.context, this.contentEl);
    this.contentEl.createEl('p', { text: record.name + ' · ' + record.status + ' · ' + progress(record), cls: 'charity-hint' });
    this.contentEl.createEl('p', { text: 'Add or edit the linked visit details here. Finished outings stay finished; changing a skipped outcome needs confirmation.', cls: 'charity-hint' });
    const records = new Map(visits.map(visit => [visit.path, visit]));
    for (const stop of stopsOf(record)) {
      const row = this.contentEl.createDiv('charity-visit-history-row');
      row.createEl('strong', { text: placeName(stop.sourcePath, places) + ' · ' + stop.status });
      const actions = row.createDiv('charity-actions'); button(actions, 'Open source', () => this.context.openFile(stop.sourcePath));
      renderStopVisitActions(this.context, row, actions, record, stop, records);
    }
  }
  close(): void { this.closed = true; super.close(); }
  onClose(): void { this.closed = true; this.generation++; window.clearTimeout(this.timer); this.owner.unload(); this.contentEl.empty(); }
}

class FinishOutingModal extends Modal {
  private finishEditing?: () => void;
  constructor(private plugin: NotebookContext, private record: OutingRecord) { super(plugin.app); }
  onOpen(): void {
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.titleEl.setText('Finish outing'); renderContextBanner(this.plugin, this.contentEl);
    this.contentEl.createEl('p', { text: progress(this.record) + '. Unfinished stops and any visit draft are kept so you can resume later.' });
    button(this.contentEl, 'Finish outing', async () => { await editing(this.plugin, () => this.plugin.store.outings.finish(this.record.path, this.record.revision)); this.close(); }, true);
  }
  onClose(): void { this.finishEditing?.(); }
}
class DiscardDraftModal extends Modal {
  private finishEditing?: () => void;
  constructor(private plugin: NotebookContext, private record: OutingRecord) { super(plugin.app); }
  onOpen(): void {
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.titleEl.setText('Discard visit draft?'); renderContextBanner(this.plugin, this.contentEl);
    this.contentEl.createEl('p', { text: 'This removes only the unfinished draft. Saved visits and outing progress are kept.' });
    button(this.contentEl, 'Discard draft', async () => { await editing(this.plugin, () => this.plugin.store.outings.discardDraft(this.record.path, this.record.revision)); this.close(); });
  }
  onClose(): void { this.finishEditing?.(); }
}
class SkipStopModal extends Modal {
  private finishEditing?: () => void;
  constructor(private plugin: NotebookContext, private record: OutingRecord, private stop: OutingStop) { super(plugin.app); }
  onOpen(): void {
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.titleEl.setText('Skip stop'); renderContextBanner(this.plugin, this.contentEl); let reason = '';
    new Setting(this.contentEl).setName('Reason (optional)').addTextArea(text => { text.inputEl.setAttribute('aria-label', 'Skip reason'); text.onChange(value => reason = value); });
    button(this.contentEl, 'Skip stop', async () => { await this.plugin.store.outings.completeStop(this.record.path, this.stop.id, 'skipped', this.record.revision, reason); this.close(); }, true);
  }
  onClose(): void { this.finishEditing?.(); }
}

export class OutingVisitModal extends Modal {
  private record!: OutingRecord;
  private input: OutingVisitInput = { observations: '', finds: '', nextTime: '', visitDate: localDate(), updateLastVisited: false };
  private finishEditing?: () => void;
  private timer?: number;
  private queue: Promise<void> = Promise.resolve();
  private persisted = '';
  private changed = false;
  private closed = false;
  private completed = false;
  private closing = false;
  private saving = false;
  private status!: HTMLElement;
  private form!: HTMLElement;
  private fields?: VisitEditor;
  private visitRevision?: string;
  private confirmSkipped = false;
  private background = () => { if (this.contentEl.ownerDocument?.hidden) void this.flush().catch(error => this.draftFailure(error)); };
  constructor(private plugin: NotebookContext, private path: string, private stopId: string) { super(plugin.app); }
  onOpen(): void {
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.titleEl.setText('Record visit'); this.modalEl.addClass('charity-outing-visit-modal');
    this.contentEl.ownerDocument?.addEventListener('visibilitychange', this.background);
    void this.load().catch(error => this.contentEl.createEl('p', { text: errorText(error), cls: 'charity-error' }));
  }
  private async load(): Promise<void> {
    this.fields?.dispose?.();
    this.record = await this.plugin.store.outings.get(this.path); if (this.closed) return;
    if (this.record.operation) { this.showRecovery(); return; }
    if (this.record.draft && this.record.draft.stopId !== this.stopId) throw Error('Resume or discard the existing visit draft before starting another.');
    const stop = stopsOf(this.record).find(stop => stop.id === this.stopId); if (!stop) throw Error('This outing stop is no longer available.');
    const suggestion = visitDateSuggestion(this.record, stop);
    const [places, visits, linked] = await Promise.all([this.plugin.store.listPlaces(), this.plugin.store.visits.list(stop.sourcePath), stop.visitPath ? this.plugin.store.visits.get(stop.visitPath) : Promise.resolve(undefined)]); if (this.closed) return;
    if (linked && (linked.id !== stop.visitId || linked.sourcePath !== stop.sourcePath || linked.outingId !== this.record.id || linked.stopId !== stop.id)) throw Error('This stop points to another visit. Review its links before editing.');
    if (this.record.draft) { this.input = clone(this.record.draft.input); this.visitRevision = this.record.draft.visitRevision; }
    else if (linked) { this.input = visitInputFromRecord(linked); this.visitRevision = linked.revision; }
    else this.input.visitDate = suggestion.date;
    this.persisted = this.record.draft ? JSON.stringify(this.input) : '';
    const source = places.find(place => place.path === stop.sourcePath);
    const el = this.contentEl; renderContextBanner(this.plugin, el);
    if (linked && this.record.draft && !this.visitRevision) {
      el.createEl('p', { text: 'This older draft has no saved visit comparison. Its input is kept below. Review the saved visit, then explicitly discard this draft and reopen the editor before saving.', cls: 'charity-error' });
      el.createEl('p', { text: 'Saved draft actual date: ' + this.input.visitDate + ' · ' + visitSummary({ ...linked, ...this.input }), cls: 'charity-hint' });
      for (const value of [this.input.observations, this.input.finds, this.input.nextTime]) if (value) el.createEl('p', { text: value, cls: 'charity-visit-text' });
      button(el, 'Open saved visit', () => this.plugin.openFile(linked.path)); return;
    }
    if (linked && this.visitRevision !== linked.revision) el.createEl('p', { text: 'The saved visit changed after this draft began. Your draft is kept; review the saved note and discard/reopen the draft before saving.', cls: 'charity-error' });
    el.createEl('p', { text: source?.name ?? stop.sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? 'Source', cls: 'charity-visit-source' });
    if (stop.visitOperationId && !stop.visitPath) el.createEl('p', { text: 'Earlier inline notes stay in the source. These structured details do not copy or replace that text.', cls: 'charity-hint' });
    if (stop.status === 'skipped') new Setting(el).setName('Change this skipped stop to visited').setDesc('Saving a visit changes this stop outcome only after you confirm.').addToggle(control => control.setValue(false).onChange(value => this.confirmSkipped = value));
    this.form = el.createDiv();
    this.fields = renderVisitFields(this.form, this.input, () => this.schedule(), { source, dateOrigin: this.record.draft ? 'Restored unfinished visit date' : linked ? 'Saved actual visit date' : suggestion.origin, quickNoteLabel: 'Outing visit quick note', colourSuggestions: visits.map(visit => visit.stockColour ?? '') });
    const footer = el.createDiv('charity-modal-footer');
    this.status = footer.createDiv({ cls: 'charity-outing-draft-status', attr: { role: 'status', 'aria-live': 'polite' } });
    if (this.record.draft) this.status.setText('Saved draft restored');
    button(footer, 'Save visit and continue', () => this.saveVisit(), true);
    button(footer, 'Close', async () => { await this.flush(); this.close(); });
  }
  private schedule(): void {
    this.changed = true; window.clearTimeout(this.timer);
    this.status?.setText('Saving draft…'); this.timer = window.setTimeout(() => { void this.flush().catch(error => this.draftFailure(error)); }, 500);
  }
  private draftFailure(error: unknown): void {
    this.status?.setText('Draft not saved: ' + errorText(error)); this.status?.addClass('charity-error');
    if (this.closed) new Notice('Visit draft could not be saved: ' + errorText(error), 12000);
  }
  private flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (!this.changed || this.completed || this.record?.operation) return this.queue;
    const snapshot = this.fields?.snapshot() ?? clone(this.input), signature = JSON.stringify(snapshot);
    const run = async () => {
      if (signature === this.persisted) return;
      this.record = await this.plugin.store.outings.saveDraft(this.path, this.stopId, snapshot, this.record.revision, this.visitRevision);
      this.persisted = signature; this.status?.setText(JSON.stringify(this.fields?.snapshot() ?? this.input) === signature ? 'Draft saved' : 'Saving draft…'); this.status?.removeClass('charity-error');
    };
    const next = this.queue.then(run, run); this.queue = next; return next;
  }
  private setSaving(value: boolean): void {
    this.saving = value;
    if (this.form) this.form.inert = value;
    this.contentEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input, textarea, select, button').forEach(control => control.disabled = value);
    this.fields?.setDisabled(value);
  }
  private async saveVisit(): Promise<void> {
    if (this.saving) return;
    try {
      this.fields?.validate();
      if (stopsOf(this.record).find(stop => stop.id === this.stopId)?.status === 'skipped' && !this.confirmSkipped) throw Error('Confirm changing this skipped stop to visited before saving.');
    } catch (error) { this.status.setText(errorText(error)); this.status.addClass('charity-error'); return; }
    this.setSaving(true);
    try {
      await this.flush(); this.status.setText('Saving visit…');
      this.record = await this.plugin.store.outings.recordVisit(this.path, this.stopId, this.fields?.snapshot() ?? clone(this.input), { revision: this.record.revision, operationId: this.record.draft?.operationId, confirmSkipped: this.confirmSkipped, visitRevision: this.visitRevision });
      this.completed = true; this.setSaving(false); this.close(); await this.plugin.openFile(this.path); new Notice('Visit saved; next stop ready');
    } catch (error) {
      this.status.setText('Not completed: ' + errorText(error)); this.status.addClass('charity-error');
      try { this.record = await this.plugin.store.outings.get(this.path); } catch { /* Keep the draft and reported error. */ }
      this.setSaving(false);
      if (this.record.operation) this.showRecovery();
    }
  }
  private showRecovery(): void {
    window.clearTimeout(this.timer); this.contentEl.empty();
    renderContextBanner(this.plugin, this.contentEl);
    this.contentEl.createEl('p', { text: 'The visit save needs completion. Its original input is retained. Retry completion before editing or advancing this stop.', cls: 'charity-error' });
    button(this.contentEl, 'Retry completion', async () => {
      this.record = await this.plugin.store.outings.resumeVisit(this.path);
      this.completed = true; this.close(); new Notice('Visit saved; stop marked visited');
    }, true);
    this.contentEl.createEl('p', { text: 'Cancel unsaved attempt keeps the draft. A visit already written must be completed and will not be deleted.', cls: 'charity-hint' });
    button(this.contentEl, 'Cancel unsaved attempt', async () => {
      this.record = await this.plugin.store.outings.cancelPendingVisit(this.path);
      this.changed = false; this.contentEl.empty(); await this.load();
    });
  }
  close(): void {
    if (this.saving) return;
    if (this.completed || !this.changed || !this.record || this.record.operation) { super.close(); return; }
    if (this.closing) return;
    this.closing = true; this.setSaving(true);
    void this.flush().then(() => { this.setSaving(false); super.close(); }).catch(error => { this.setSaving(false); this.draftFailure(error); }).finally(() => { this.closing = false; });
  }
  onClose(): void { this.fields?.dispose?.();
    this.closed = true; window.clearTimeout(this.timer); this.contentEl.ownerDocument?.removeEventListener('visibilitychange', this.background);
    void this.flush().catch(error => this.draftFailure(error)).finally(() => this.finishEditing?.());
  }
}
