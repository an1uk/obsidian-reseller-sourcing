import { propertyText } from '../domain/guards';
import { Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { PlaceRecord, LocalityRecord } from '../types';
import type { OutingGroup, OutingStop } from '../outings/types';
import type { OutingPreparation } from './types';
import { PreparationModal } from './preparation-modal';
import { button, details, PickModal } from '../ui';
import { resolveParking, formatRating } from '../domain';
import { localDate } from '../storage/markdown';
import { proposeOutingGroups } from '../outings/domain';
import { OutingPlannerModal } from '../ui/outing-planner';
import { mountPlaceMap } from '../map';
import { defaultPlaceQuery, normalisePlaceQuery, normalisePlaceSort, queryPlaces, serialisePlaceQuery, type PlaceQuery, type PlaceSort } from './place-query';

const stops = (groups: OutingGroup[]) => groups.flatMap(g => g.stops);
export class OutingPreparationModal extends PreparationModal<OutingPreparation> {
  private places: PlaceRecord[] = []; private areas: LocalityRecord[] = []; private visited = new Set<string>();
  constructor(context: NotebookContext, existingPath?: string, draftId?: string, criteria?: { query: PlaceQuery; sort: PlaceSort }, seed?: OutingPreparation) {
    super(context, 'outing', seed ?? { name: '', groups: [], step: 1, unresolved: [], filter: { text: '', area: '', shortlist: false, type: '', view: 'list' }, ...(existingPath ? { existingPath } : {}), ...(criteria ? { placeQuery: serialisePlaceQuery(criteria.query), placeSort: criteria.sort, filter: { text: criteria.query.text, area: criteria.query.area, shortlist: criteria.query.shortlist, type: criteria.query.sourceType, view: 'list' as const } } : {}) }, draftId);
  }
  protected meaningful() { return !!(this.draft.data.placeQuery || this.draft.data.groups.length || this.draft.data.name || this.draft.data.filter.area || this.draft.data.filter.text); }
  private name(path: string) { return this.places.find(p => p.path === path)?.name ?? path.split('/').pop()!.replace(/\.md$/, ''); }
  private async stage(step: 1 | 2 | 3) { this.draft.data.step = step; this.changed(); await this.flush(); await this.render(); }
  private async redraw() { this.changed(); await this.render(); }
  private async select(place: PlaceRecord) {
    const data = this.draft.data; if (stops(data.groups).some(s => s.sourcePath === place.path)) return;
    const proposed = proposeOutingGroups([place], this.places), parking = resolveParking(place, this.places);
    if (proposed.issues.length || parking.status === 'choice' || parking.status === 'invalid') data.unresolved.push(place.path);
    const group = proposed.groups[0] ?? { id: crypto.randomUUID(), parkingPath: '', stops: [{ id: crypto.randomUUID(), sourcePath: place.path, status: 'pending' as const }] };
    const shared = group.parkingPath && data.groups.find(g => g.parkingPath === group.parkingPath);
    if (shared) shared.stops.push(...group.stops); else data.groups.push({ ...group, id: crypto.randomUUID() });
    await this.redraw();
  }
  private remove(stop: OutingStop) {
    const data = this.draft.data;
    data.groups = data.groups.map(g => ({ ...g, stops: g.stops.filter(s => s.id !== stop.id) })).filter(g => g.stops.length);
    data.unresolved = data.unresolved.filter(p => p !== stop.sourcePath);
    if (data.planning) delete data.planning.stopOverrides[stop.id];
    return this.redraw();
  }
  async renderStep(): Promise<void> {
    [this.places, this.areas] = await Promise.all([this.context.store.listPlaces(), this.context.store.listLocalities()]);
    this.visited = new Set((await this.context.store.visits.list()).map(v => v.sourcePath)); if (this.closed) return;
    const d = this.draft.data;
    if (!this.draft.revision && this.meaningful()) this.changed();
    if (d.existingPath && !d.existingRevision) {
      const existing = await this.context.store.outings.get(d.existingPath); if (this.closed) return;
      if (existing.operation || existing.draft) throw Error('Finish the saved visit before changing this outing.');
      d.groups = structuredClone(existing.groups); d.name = existing.name; d.planning = existing.planning; d.existingRevision = existing.revision;
    }
    this.titleEl.setText(['Choose places', 'Review journey', 'Ready to go'][d.step - 1]);
    const steps = this.contentEl.createDiv({ cls: 'charity-preparation-steps', attr: { 'aria-label': 'Preparation stage' } });
    ['Choose places', 'Review journey', 'Ready to go'].forEach((label, i) => steps.createSpan({ text: (i + 1) + '. ' + label, cls: i + 1 === d.step ? 'is-current' : '', attr: i + 1 === d.step ? { 'aria-current': 'step' } : {} }));
    button(this.contentEl, 'Back', () => d.step > 1 ? this.stage((d.step - 1) as 1 | 2) : this.close());
    if (d.reviewWarnings?.length) {
      const review = details(this.contentEl, 'Review this new plan'); review.open = true;
      for (const message of d.reviewWarnings) review.createEl('p', { text: message, cls: 'charity-hint' });
    }
    if (d.step === 1) this.choosePlaces(); else if (d.step === 2) this.review(); else this.ready();
  }
  private choosePlaces() {
    const d = this.draft.data, el = this.contentEl, selected = new Set(stops(d.groups).map(s => s.sourcePath));
    const top = el.createDiv('charity-actions');
    button(top, d.filter.area === 'unassigned' ? 'Unassigned' : d.filter.area ? this.areas.find(a => a.path === d.filter.area)?.label ?? 'Area unavailable' : 'Choose an area', () => new PickModal(this.context, [{ path: '', label: 'All areas' }, { path: 'unassigned', label: 'Unassigned' }, ...this.areas], a => a.label, a => { d.filter.area = a.path; if (d.placeQuery) d.placeQuery.area = a.path; return this.redraw(); }, 'Choose an area').open());
    const short = button(top, 'Shortlist', () => { d.filter.shortlist = !d.filter.shortlist; if (d.placeQuery) d.placeQuery.shortlist = d.filter.shortlist; return this.redraw(); }); short.setAttribute('aria-pressed', String(d.filter.shortlist));
    button(top, d.filter.view === 'list' ? 'Show map' : 'Show list', () => { d.filter.view = d.filter.view === 'list' ? 'map' : 'list'; return this.redraw(); });
    const selectedEl = el.createDiv('charity-preparation-selected');
    selectedEl.createEl('strong', { text: selected.size ? selected.size + ' places selected' : 'Choose a few places to begin' });
    for (const s of stops(d.groups)) { const row = selectedEl.createDiv('charity-compact-row'); row.createSpan({ text: this.name(s.sourcePath) }); if (s.status === 'pending') button(row, 'Remove', () => this.remove(s)).setAttribute('aria-label', 'Remove ' + this.name(s.sourcePath)); }
    const search = el.createEl('input', { type: 'search', placeholder: 'Search places', attr: { 'aria-label': 'Search places to visit' } }); search.value = d.filter.text;
    const results = el.createDiv('charity-preparation-candidates');
    const draw = () => {
      results.empty();
      const query = normalisePlaceQuery(d.placeQuery ?? { ...defaultPlaceQuery(), text: d.filter.text, area: d.filter.area, shortlist: d.filter.shortlist, sourceType: d.filter.type });
      query.text = d.filter.text; query.area = d.filter.area; query.shortlist = d.filter.shortlist; query.kind = 'shop';
      const found = queryPlaces(this.places, this.areas, this.visited, query, normalisePlaceSort(d.placeSort));
      const choices = found.places.filter(p => !selected.has(p.path) && p.properties.shop_closed !== true);
      if (d.placeQuery) {
        const note = results.createDiv('charity-hint');
        if (query.status !== 'active') note.createEl('p', { text: 'Permanently closed places cannot be added to an outing.' }); note.createSpan({ text: 'Using the filters from Places. Search, area and shortlist can be adjusted here.' });
        button(note, 'Clear carried filters', () => { delete d.placeQuery; delete d.placeSort; d.filter = { text: '', area: '', shortlist: false, type: '', view: d.filter.view }; return this.redraw(); });
        if (found.nearbyUnavailable) note.createEl('p', { text: 'The temporary nearby reference is unavailable. Clear carried filters or choose a saved reference in the place browser.' });
      }
      if (d.filter.view === 'map') {
        mountPlaceMap(this.owner, results, { ...this.context.mapHost, openFile: path => { const place = choices.find(p => p.path === path); return place ? this.select(place) : this.context.openFile(path); } }, { records: choices, selectionLabel: 'Add to outing' });
      } else for (const p of choices) { const row = results.createDiv('charity-source-choice'); const text = row.createDiv(); text.createEl('strong', { text: p.name }); text.createEl('p', { text: propertyText(p.properties.comments, formatRating(p.properties.rating)), cls: 'charity-hint' }); button(row, 'Add', () => this.select(p)).setAttribute('aria-label', 'Add ' + p.name); }
      if (!choices.length) results.createEl('p', { text: 'No more matching places. Change the area, shortlist or search.' });
    };
    search.oninput = () => { d.filter.text = search.value; if (d.placeQuery) d.placeQuery.text = d.filter.text; this.changed(); if (d.filter.view === 'list') draw(); };
    if (d.filter.view === 'map') search.onchange = () => this.redraw();
    draw();
    const next = button(el, 'Review journey', () => this.stage(2), true); next.disabled = !selected.size;
  }
  private parking(stop: OutingStop, group: OutingGroup, path: string) {
    const d = this.draft.data; d.unresolved = d.unresolved.filter(p => p !== stop.sourcePath);
    group.stops = group.stops.filter(s => s.id !== stop.id);
    const shared = path && d.groups.find(g => g.parkingPath === path && g.id !== group.id);
    if (shared) shared.stops.push(stop); else d.groups.push({ id: crypto.randomUUID(), parkingPath: path, stops: [stop] });
    d.groups = d.groups.filter(g => g.stops.length); return this.redraw();
  }
  private review() {
    const d = this.draft.data, el = this.contentEl;
    for (const g of d.groups) {
      const section = el.createEl('section', { cls: 'charity-journey-group' });
      section.createEl('h3', { text: g.parkingPath ? 'Park at ' + this.name(g.parkingPath) : 'On foot' });
      for (const s of g.stops) {
        const row = section.createDiv('charity-compact-row'); row.createSpan({ text: this.name(s.sourcePath) });
        const place = this.places.find(p => p.path === s.sourcePath);
        if (s.status === 'pending' && (!place || place.properties.shop_closed === true)) {
          row.createEl('p', { text: !place ? 'Place no longer exists. Remove it before saving.' : 'This source is permanently closed. Remove it before saving.', cls: 'charity-error' });
          if (s.status === 'pending') button(row, 'Remove unavailable place', () => this.remove(s));
        }
        if (s.status !== 'pending') continue;
        const options = place ? resolveParking(place, this.places).choices : [];
        const unresolved = d.unresolved.includes(s.sourcePath);
        button(row, unresolved ? 'Choose parking or on foot' : 'Change parking', () => new PickModal(this.context,
          [{ path: '', name: 'On foot / source location' }, ...options], p => p.name, p => this.parking(s, g, p.path), 'Parking for ' + this.name(s.sourcePath)).open(), unresolved);
      }
    }
    const ordering = details(el, 'Change the order');
    d.groups.forEach((g, i) => {
      const row = ordering.createDiv('charity-compact-row'); row.createSpan({ text: g.parkingPath ? this.name(g.parkingPath) : this.name(g.stops[0].sourcePath) });
      const up = button(row, 'Earlier', () => { [d.groups[i - 1], d.groups[i]] = [d.groups[i], d.groups[i - 1]]; return this.redraw(); });
      up.disabled = i === 0 || g.stops.some(s => s.status !== 'pending') || d.groups[i - 1]?.stops.some(s => s.status !== 'pending') === true;
      g.stops.forEach((s, j) => { const line = ordering.createDiv('charity-compact-row'); line.createSpan({ text: this.name(s.sourcePath) }); const before = button(line, 'Earlier within group', () => { [g.stops[j - 1], g.stops[j]] = [g.stops[j], g.stops[j - 1]]; return this.redraw(); }); before.disabled = j === 0 || s.status !== 'pending' || g.stops[j - 1]?.status !== 'pending'; });
    });
    const improve = button(el, 'Improve journey', () => new OutingPlannerModal(this.context, {
      draft: () => { if (this.closed) throw Error('Preparation closed.'); return { id: this.draft.id, path: d.existingPath ?? '', name: this.outingName(), status: 'planned', createdAt: '', revision: d.existingRevision ?? '', groups: structuredClone(d.groups), planning: d.planning }; },
      onApplyDraft: (groups, planning) => { if (this.closed) throw Error('Preparation closed.'); d.groups = structuredClone(groups); d.planning = structuredClone(planning); void this.redraw(); },
    }).open()); improve.disabled = !!d.unresolved.length;
    const next = button(el, 'Ready to go', () => this.stage(3), true); next.disabled = !stops(d.groups).length || !!d.unresolved.length || stops(d.groups).some(s => s.status === 'pending' && !this.places.some(p => p.path === s.sourcePath && p.properties.shop_closed !== true));
  }
  private outingName() { const d = this.draft.data; return d.name.trim() || (this.areas.find(a => a.path === d.filter.area)?.name ?? 'Sourcing') + ' ' + (d.planning?.date ?? localDate()); }
  private ready() {
    const d = this.draft.data, el = this.contentEl;
    el.createEl('h3', { text: this.outingName() });
    const list = el.createEl('ol'); for (const g of d.groups) list.createEl('li', { text: (g.parkingPath ? 'Park at ' + this.name(g.parkingPath) + ': ' : '') + g.stops.map(s => this.name(s.sourcePath)).join(', ') });
    if (d.planning) el.createEl('p', { text: d.planning.date + ' at ' + d.planning.departureTime + ' · ' + d.planning.timeZone, cls: 'charity-hint' });
    new Setting(details(el, 'Change name')).setName('Outing name').addText(t => t.setValue(d.name).setPlaceholder(this.outingName()).onChange(v => { d.name = v; this.changed(); }));
    const actions = el.createDiv('charity-actions');
    button(actions, 'Start outing', () => { d.startAfterSave = true; return this.finish(); }, true);
    button(actions, 'Save for later', () => { d.startAfterSave = false; return this.finish(); });
  }
  protected async finish(): Promise<void> {
    if (this.busy) return; this.setBusy(true);
    try {
      const d = this.draft.data; if (!stops(d.groups).length || d.unresolved.length) throw Error('Choose places and resolve parking before saving.');
      d.name = this.outingName();
      const input = { name: d.name, groups: d.groups, ...(d.planning ? { planning: d.planning } : {}) };
      if (this.draft.phase === 'editing') await this.context.store.outings.validatePreparation(input, d.existingPath, d.existingRevision);
      await this.completing();
      let record = d.existingPath ? await this.context.store.outings.updatePlan(d.existingPath, input, d.existingRevision, this.draft.id) : await this.context.store.outings.create(input, this.draft.id);
      if (d.startAfterSave && record.status !== 'active') record = await this.context.store.outings.start(record.path, record.revision);
      await this.completed(record.path);
    } catch (e) { this.setBusy(false); this.failure(e); }
  }
}
