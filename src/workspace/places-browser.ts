import { Component, Modal } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { Coordinates, PlaceRecord } from '../types';
import { button, details, errorText, PickModal } from '../ui';
import { markInputModal } from '../ui/modal-layout';
import { formatRating, validateCoordinates } from '../domain';
import { propertyText } from '../domain/guards';
import { mountPlaceMap, type PlaceMap } from '../map';
import { distanceFromKm, distanceToKm, formatDistance } from '../units';
import {
  defaultPlaceQuery, defaultNearbyRadiusKm, nextPlaceSort, queryPlaces,
  areaLabelForPlace, placeSourceType, type PlaceQuery, type PlaceSort, type NearbyReference,
} from './place-query';

export interface PlaceBrowserState { query: PlaceQuery; sort: PlaceSort; view: 'list' | 'map'; }
interface BrowserActions {
  open(path: string): void | Promise<void>;
  changed(): void;
  plan(query: PlaceQuery, sort: PlaceSort): void;
  more(parent: HTMLElement): void;
}
const sortLabels: Record<PlaceSort['key'], string> = {
  name: 'Place', area: 'Area', type: 'Type', rating: 'Sourcing rating',
  lastVisited: 'Last visited', shortlist: 'Shortlist', distance: 'Distance',
};
const dateLabel = (value: unknown): string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : 'No date';
const visitSources = async (context: NotebookContext) => new Set((await context.store.visits.list()).map(v => v.sourcePath));

/** One query powers the table, phone cards, map and the next outing's chooser. */
export async function renderPlacesBrowser(context: NotebookContext, owner: Component, el: HTMLElement, state: PlaceBrowserState, actions: BrowserActions): Promise<void> {
  const [places, areas, visited] = await Promise.all([context.store.listPlaces(), context.store.listLocalities(), visitSources(context)]);
  const component = owner.addChild(new Component());
  let mapOwner = component.addChild(new Component()); let map: PlaceMap | undefined; let mapAllowsClosed = false;
  el.addClass('charity-places-browser');
  const search = el.createEl('input', { type: 'search', placeholder: 'Search names, addresses, brands or takeaways', attr: { 'aria-label': 'Search places' } });
  search.value = state.query.text; search.setAttribute('data-workspace-focus', 'Search places');
  const toolbar = el.createDiv('charity-actions');
  const viewButtons = new Map<string, HTMLButtonElement>();
  for (const view of ['list', 'map'] as const) viewButtons.set(view, button(toolbar, view === 'list' ? 'List' : 'Map', () => { state.view = view; changed(); }));
  const sortButton = button(toolbar, 'Sort', () => new PickModal(context,
    (Object.keys(sortLabels) as PlaceSort['key'][]).filter(key => key !== 'distance' || !!state.query.nearby),
    key => sortLabels[key] + (state.sort.key === key ? ' (' + state.sort.direction + ')' : ''),
    key => { state.sort = nextPlaceSort(state.sort, key); changed(); }, 'Sort places').open());
  const filters = details(el, 'Filters'), chips = el.createDiv('charity-filter-chips');
  const resultStatus = el.createDiv({ cls: 'charity-place-results-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const results = el.createDiv('charity-place-results');
  button(el.createDiv('charity-actions'), 'Plan an outing from these places', () => actions.plan(state.query, state.sort));
  const more = details(el, 'More views'); actions.more(more);

  const choose = <T>(parent: HTMLElement, label: string, values: T[], text: (v: T) => string, apply: (v: T) => void) =>
    button(parent, label, () => new PickModal(context, values, text, value => { apply(value); changed(); }, label.split(':')[0]).open());
  const chip = (label: string, clear: () => void) => {
    const b = button(chips, label + ' ×', () => { clear(); changed(); });
    b.setAttribute('aria-label', 'Remove filter: ' + label);
  };
  function drawFilters() {
    const q = state.query, expanded = filters.open;
    filters.empty(); filters.open = expanded;
    const active = [
      !!q.text, !!q.area, q.kind !== 'shop', !!q.sourceType, q.rating !== 'any', q.shortlist,
      q.status !== 'active', q.visits !== 'any', q.location !== 'any', !!q.nearby,
    ].filter(Boolean).length;
    filters.createEl('summary', { text: active ? 'Filters (' + active + ')' : 'Filters' });
    const controls = filters.createDiv('charity-actions charity-filter-controls');
    const area = q.area === 'unassigned' ? 'Unassigned' : areas.find(a => a.path === q.area)?.label ?? (q.area ? 'Area unavailable' : 'All areas');
    choose(controls, 'Area: ' + area, [{ path: '', label: 'All areas' }, { path: 'unassigned', label: 'Unassigned' }, ...areas], a => a.label, a => { q.area = a.path; });
    choose(controls, 'Show: ' + (q.kind === 'all' ? 'All places' : q.kind === 'shop' ? 'Sources' : 'Parking'), ['shop', 'parking', 'all'] as const,
      k => k === 'shop' ? 'Sources' : k === 'parking' ? 'Parking' : 'All places', k => { q.kind = k; });
    const types = Array.from(new Set([...context.settings.sourceTypes, ...places.filter(p => p.kind === 'shop').map(placeSourceType)])).filter(Boolean).sort();
    choose(controls, 'Type: ' + (q.sourceType || 'Any'), ['', ...types], t => t || 'Any source type', t => { q.sourceType = t; });
    const ratings = [{ value: 'any', minimum: .5, label: 'Any rating' }, { value: 'unrated', minimum: .5, label: 'Not rated' },
      ...Array.from({ length: 10 }, (_, i) => ({ value: 'minimum', minimum: (i + 1) / 2, label: 'At least ' + (i + 1) / 2 + ' / 5' }))];
    choose(controls, 'Rating: ' + (q.rating === 'minimum' ? 'At least ' + q.minimumRating : q.rating === 'unrated' ? 'Not rated' : 'Any'), ratings,
      r => r.label, r => { q.rating = r.value === 'minimum' ? 'minimum' : r.value === 'unrated' ? 'unrated' : 'any'; q.minimumRating = r.minimum; });
    choose(controls, 'Status: ' + q.status, ['active', 'closed', 'all'] as const, s => s === 'closed' ? 'Permanently closed sources' : s === 'all' ? 'All statuses' : 'Active places', s => { q.status = s; });
    choose(controls, 'Visits: ' + (q.visits === 'with' ? 'Recorded' : q.visits === 'without' ? 'None recorded' : 'Any'), ['any', 'with', 'without'] as const,
      s => s === 'with' ? 'With visit notes' : s === 'without' ? 'No visit notes' : 'Any visit history', s => { q.visits = s; });
    choose(controls, 'Location: ' + (q.location === 'present' ? 'Set' : q.location === 'missing' ? 'Missing' : 'Any'), ['any', 'present', 'missing'] as const,
      s => s === 'present' ? 'With coordinates' : s === 'missing' ? 'Missing coordinates' : 'Any location', s => { q.location = s; });
    const shortlist = button(controls, 'Shortlist only', () => { q.shortlist = !q.shortlist; changed(); }); shortlist.setAttribute('aria-pressed', String(q.shortlist));
    button(controls, q.nearby ? 'Change nearby search' : 'Nearby…', () => new NearbyModal(context, places, q, nearby => { q.nearby = nearby; changed(); }).open());
    if (q.nearby) {
      const setting = controls.createEl('label', { cls: 'charity-nearby-radius', text: 'Radius (' + context.settings.distanceUnit + ')' });
      const input = setting.createEl('input', { type: 'number', attr: { min: '0.1', step: '0.1', 'aria-label': 'Nearby radius (' + context.settings.distanceUnit + ')' } });
      input.value = String(Number(distanceFromKm(q.nearby.radiusKm, context.settings.distanceUnit).toFixed(2)));
      input.onchange = () => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0) { input.setCustomValidity('Enter a radius greater than zero.'); input.reportValidity(); return; }
        input.setCustomValidity(''); if (q.nearby) q.nearby.radiusKm = distanceToKm(value, context.settings.distanceUnit); changed(false);
      };
    }
  const presets = filters.createDiv('charity-actions charity-place-presets');
  for (const [label, patch] of [
    ['Shortlist', { shortlist: true }], ['Not rated', { rating: 'unrated' }],
    ['Needs location', { location: 'missing' }], ['No visits recorded', { visits: 'without' }],
  ] as const) button(presets, label, () => { state.query = { ...defaultPlaceQuery(), ...patch }; search.value = ''; changed(); });
    chips.empty();
    if (q.text) chip('Search: ' + q.text, () => { q.text = ''; search.value = ''; });
    if (q.area) chip(area, () => { q.area = ''; });
    if (q.kind !== 'shop') chip(q.kind === 'all' ? 'All places' : 'Parking', () => { q.kind = 'shop'; });
    if (q.sourceType) chip(q.sourceType, () => { q.sourceType = ''; });
    if (q.rating !== 'any') chip(q.rating === 'unrated' ? 'Not rated' : 'Rating ≥ ' + q.minimumRating, () => { q.rating = 'any'; });
    if (q.shortlist) chip('Shortlist', () => { q.shortlist = false; });
    if (q.status !== 'active') chip('Status: ' + q.status, () => { q.status = 'active'; });
    if (q.visits !== 'any') chip(q.visits === 'with' ? 'With visits' : 'No visits', () => { q.visits = 'any'; });
    if (q.location !== 'any') chip(q.location === 'present' ? 'Has location' : 'Needs location', () => { q.location = 'any'; });
    if (q.nearby) chip('Nearby: ' + nearbyLabel(q.nearby.reference, places), () => { delete q.nearby; if (state.sort.key === 'distance') state.sort = { key: 'name', direction: 'asc' }; });
    if (active) button(chips, 'Clear filters', () => { state.query = defaultPlaceQuery(); search.value = ''; changed(); });
  }
  function drawResults() {
    const focusSort = results.ownerDocument.activeElement?.getAttribute('data-place-sort');
    const found = queryPlaces(places, areas, visited, state.query, state.sort);
    for (const [view, b] of viewButtons) b.setAttribute('aria-pressed', String(state.view === view));
    sortButton.setText('Sort: ' + sortLabels[state.sort.key] + (state.sort.direction === 'asc' ? ' ↑' : ' ↓'));
    resultStatus.setText(found.nearbyUnavailable ? 'The nearby reference is unavailable. Choose it again or remove Nearby.' :
      found.matchingCount + ' matching ' + (found.matchingCount === 1 ? 'place' : 'places') + (state.view === 'map' ? ' · ' + found.mappedCount + ' mapped · ' + found.missingLocationCount + ' without coordinates' : '') +
      (state.query.nearby ? ' · straight-line distance estimates · ' + found.missingLocationCount + ' without coordinates omitted' : ''));
    if (map && state.view === 'map' && found.mappedCount && mapAllowsClosed === (state.query.status !== 'active')) {
      map.setRecords(found.places); return;
    }
    component.removeChild(mapOwner); mapOwner = component.addChild(new Component()); map = undefined; results.empty();
    if (found.nearbyUnavailable) button(results, 'Choose nearby reference', () => new NearbyModal(context, places, state.query, nearby => { state.query.nearby = nearby; changed(); }).open());
    if (state.view === 'map' && found.mappedCount) {
      mapAllowsClosed = state.query.status !== 'active';
      map = mountPlaceMap(mapOwner, results, context.mapHost, { records: found.places, locality: true, includeClosed: state.query.status !== 'active', readOnly: true });
    } else if (state.view === 'list') {
      const tableWrap = results.createDiv('charity-places-table-wrap');
      const table = tableWrap.createEl('table', { cls: 'charity-places-table' }), headers = table.createEl('thead').createEl('tr');
      const columns: PlaceSort['key'][] = ['name', 'area', 'type', 'rating', 'lastVisited', 'shortlist'];
      if (state.query.nearby) columns.push('distance');
      for (const key of columns) {
        const th = headers.createEl('th', { attr: { scope: 'col', 'aria-sort': state.sort.key === key ? state.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none' } });
        const b = button(th, sortLabels[key] + (state.sort.key === key ? state.sort.direction === 'asc' ? ' ↑' : ' ↓' : ''), () => { state.sort = nextPlaceSort(state.sort, key); changed(false); });
        b.setAttribute('data-place-sort', key); b.setAttribute('aria-label', 'Sort by ' + sortLabels[key].toLowerCase());
      }
      const tbody = table.createEl('tbody'), cards = results.createDiv('charity-places-cards');
      for (const p of found.places) {
        const tr = tbody.createEl('tr'), name = tr.createEl('td');
        const nameButton = button(name, p.name, () => actions.open(p.path)); nameButton.addClass('charity-place-name'); nameButton.setAttribute('data-workspace-focus', 'place:' + p.path);
        if (p.properties.comments) name.createEl('p', { text: propertyText(p.properties.comments), cls: 'charity-hint charity-place-takeaway' });
        if (p.properties.shop_closed) name.createSpan({ text: 'Permanently closed', cls: 'charity-hint' });
        tr.createEl('td', { text: areaLabelForPlace(p, areas) });
        tr.createEl('td', { text: p.kind === 'parking' ? 'Parking' : placeSourceType(p) });
        tr.createEl('td', { text: p.kind === 'shop' ? formatRating(p.properties.rating) : '—' });
        tr.createEl('td', { text: p.kind === 'shop' ? dateLabel(p.properties.last_visited) : '—' });
        tr.createEl('td', { text: p.kind === 'shop' ? p.properties.shortlist === true ? 'Yes' : 'No' : '—' });
        const km = found.distancesKm.get(p.path);
        if (state.query.nearby) tr.createEl('td', { text: km === undefined ? 'Unknown' : formatDistance(km, context.settings.distanceUnit) });
        const card = cards.createEl('article', { cls: 'charity-place-card' });
        const cardButton = button(card, p.name, () => actions.open(p.path)); cardButton.addClass('charity-place-name'); cardButton.setAttribute('data-workspace-focus', 'place:' + p.path);
        card.createEl('p', { text: [areaLabelForPlace(p, areas), p.kind === 'shop' ? formatRating(p.properties.rating) : 'Parking', p.properties.shortlist ? 'Shortlisted' : '', p.properties.shop_closed ? 'Permanently closed' : ''].filter(Boolean).join(' · '), cls: 'charity-hint' });
        if (p.properties.comments) card.createEl('p', { text: propertyText(p.properties.comments) });
        if (km !== undefined) card.createEl('p', { text: formatDistance(km, context.settings.distanceUnit) + ' straight line', cls: 'charity-hint' });
      }
    }
    if (!found.places.length || state.view === 'map' && !found.mappedCount) {
      const empty = results.createDiv('charity-empty-state');
      empty.createEl('p', { text: found.places.length ? 'These places need coordinates before they can appear on the map.' : 'No places match these choices.' });
      if (found.places.length) button(empty, 'Show places without locations', () => { state.view = 'list'; state.query.location = 'missing'; delete state.query.nearby; if (state.sort.key === 'distance') state.sort = { key: 'name', direction: 'asc' }; changed(); });
      button(empty, 'Clear filters', () => { state.query = defaultPlaceQuery(); search.value = ''; changed(); });
      button(empty, 'Add a place', () => context.newPlace('shop'));
    }
    if (focusSort) results.querySelector<HTMLElement>('[data-place-sort="' + focusSort + '"]')?.focus({ preventScroll: true });
  }
  function markFocus() {
    for (const element of el.querySelectorAll<HTMLElement>('button,input,summary')) {
      element.setAttribute('data-workspace-focus', element.getAttribute('data-workspace-focus') ?? element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '');
    }
  }
  function changed(filtersChanged = true) { if (!state.query.nearby && state.sort.key === 'distance') state.sort = { key: 'name', direction: 'asc' }; if (filtersChanged) drawFilters(); drawResults(); markFocus(); actions.changed(); }
  search.oninput = () => { state.query.text = search.value; drawFilters(); drawResults(); markFocus(); actions.changed(); };
  component.register(() => { map?.unload(); });
  drawFilters(); drawResults(); markFocus();
}

function nearbyLabel(reference: NearbyReference, places: PlaceRecord[]): string {
  return reference.kind === 'place' ? places.find(p => p.path === reference.path)?.name ?? 'Place unavailable' :
    reference.kind === 'current' ? 'Current location' : reference.kind === 'unavailable' ? 'Choose reference again' : reference.label || 'Map point';
}
class NearbyModal extends Modal {
  private owner = new Component(); private closed = false; private generation = 0;
  constructor(private context: NotebookContext, private places: PlaceRecord[], private query: PlaceQuery, private apply: (nearby: NonNullable<PlaceQuery['nearby']>) => void) { super(context.app); }
  onOpen(): void {
    markInputModal(this); this.titleEl.setText('Nearby places'); this.owner.load();
    const status = this.contentEl.createDiv({ cls: 'charity-hint', attr: { role: 'status' } });
    const choose = (reference: NearbyReference) => { if (this.closed) return; ++this.generation; this.apply({ reference, radiusKm: this.query.nearby?.radiusKm ?? defaultNearbyRadiusKm() }); this.close(); };
    button(this.contentEl, 'Choose a saved place', () => new PickModal(this.context, this.places.filter(p => !!validateCoordinates(p.coordinates)), p => p.name, p => choose({ kind: 'place', path: p.path }), 'Nearby reference place').open());
    const point = details(this.contentEl, 'Coordinates or map point');
    const input = point.createEl('input', { type: 'text', placeholder: 'Latitude, longitude', attr: { 'aria-label': 'Nearby reference coordinates' } });
    button(point, 'Use coordinates', () => {
      const coordinates = validateCoordinates(input.value.split(',').map(v => v.trim()));
      if (!coordinates) { status.setText('Enter a valid latitude and longitude.'); return; }
      choose({ kind: 'point', coordinates });
    });
    const mapBox = point.createDiv(); let mapMounted = false;
    button(point, 'Choose on map', () => {
      if (mapMounted) return; mapMounted = true;
      mapBox.empty();
      mountPlaceMap(this.owner, mapBox, this.context.mapHost, { records: this.places, locality: true, onPick: coordinates => choose({ kind: 'point', coordinates }) });
    });
    button(this.contentEl, 'Use current location', () => {
      const generation = ++this.generation, location = this.contentEl.win.navigator.geolocation;
      if (!location) { status.setText('Location is unavailable. Choose a saved place or map point.'); return; }
      status.setText('Requesting location…');
      try { location.getCurrentPosition(position => {
        if (this.closed || generation !== this.generation) return;
        const coordinates: Coordinates = [position.coords.latitude, position.coords.longitude];
        choose({ kind: 'current', coordinates });
      }, error => { if (!this.closed && generation === this.generation) status.setText('Location unavailable: ' + errorText(error.message) + '. Choose another reference.'); }, { timeout: 15000, maximumAge: 0 }); } catch (error) { status.setText('Location unavailable: ' + errorText(error) + '. Choose another reference.'); }
    });
    this.contentEl.createEl('p', { text: 'Current location stays in this pane for this session. It is not saved in your notebook.', cls: 'charity-hint' });
    button(this.contentEl, 'Cancel', () => this.close());
  }
  onClose(): void { this.closed = true; ++this.generation; this.owner.unload(); }
}
