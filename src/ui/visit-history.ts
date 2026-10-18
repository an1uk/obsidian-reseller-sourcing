import type { Component } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import { localDate } from '../storage/markdown';
import { visitPeriodRange, isVisitDateInRange, type VisitPeriod } from '../visits/periods';
import { button, details, errorText, renderContextBanner } from '../ui';
import { StructuredVisitModal, renderVisitRecordDetails, visitSummary } from './visits';
import { renderVisitInsights, type InsightsState } from './visit-insights';

export interface VisitsHubState {
  view?: 'history' | 'insights';
  period?: VisitPeriod;
  from?: string;
  to?: string;
  query?: string;
  expandedVisits?: Record<string, boolean>;
  insights?: InsightsState;
}
const panes = new WeakMap<HTMLElement, Map<string, VisitsHubState>>();
/** Transient browsing choices belong to a pane and note, never notebook preferences. */
export function embeddedVisitsHubState(element: HTMLElement, path: string): VisitsHubState {
  const pane = element.closest<HTMLElement>('.workspace-leaf') ?? element;
  let states = panes.get(pane);
  if (!states) { states = new Map(); panes.set(pane, states); }
  let state = states.get(path);
  if (!state) {
    state = {}; states.set(path, state);
    if (states.size > 24) states.delete(states.keys().next().value!);
  }
  return state;
}

export async function renderVisitsHub(context: NotebookContext, owner: Component, el: HTMLElement, state: VisitsHubState = {}, isCurrent: () => boolean = () => true): Promise<void> {
  const [inspection, places] = await Promise.all([context.store.visits.inspect(), context.store.listPlaces()]);
  if (!isCurrent()) return;
  el.empty(); el.addClass('charity-visits-hub'); renderContextBanner(context, el);
  const sources = new Map(places.filter(place => place.kind === 'shop').map(place => [place.path, place]));
  const sourceName = (path: string) => sources.get(path)?.name ?? path.split('/').at(-1)?.replace(/\.md$/, '') ?? 'Source unavailable';
  state.expandedVisits ??= {}; state.insights ??= {};
  const tabs = el.createDiv({ cls: 'charity-actions charity-visits-tabs', attr: { 'aria-label': 'Visit views' } });
  const body = el.createDiv('charity-visits-view');
  let currentView = 0;
  const viewButtons = new Map<string, HTMLButtonElement>();
  const renderActive = async () => {
    const generation = ++currentView;
    if (!isCurrent()) return;
    for (const [view, control] of viewButtons) {
      const selected = (state.view ?? 'history') === view;
      control.setAttribute('aria-pressed', String(selected)); control.toggleClass('mod-cta', selected);
    }
    body.empty();
    if (state.view === 'insights') {
      await renderVisitInsights(context, owner, body, state.insights, () => isCurrent() && generation === currentView);
      return;
    }
    body.createEl('p', { text: 'Your recorded visits, newest first.', cls: 'charity-hint' });
    const periods = body.createDiv({ cls: 'charity-actions charity-visit-periods', attr: { 'aria-label': 'Visit period' } });
    const periodButtons = new Map<VisitPeriod, HTMLButtonElement>();
    const dates = body.createDiv('charity-insight-filters');
    for (const [key, label] of [['from', 'From visit date'], ['to', 'To visit date']] as const) {
      const group = dates.createEl('label', { cls: 'charity-insight-date' }); group.createSpan({ text: label });
      const input = group.createEl('input', { type: 'date', attr: { 'aria-label': label, 'data-charity-focus': 'visits-' + key } });
      input.value = state[key] ?? ''; input.onchange = () => { state[key] = input.value; update(); };
    }
    const search = body.createEl('input', { type: 'search', placeholder: 'Search sources or visit notes', attr: { 'aria-label': 'Search visit history', 'data-charity-focus': 'visits-query' } });
    search.value = state.query ?? ''; search.oninput = () => { state.query = search.value; update(); };
    const messages = body.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    const records = body.createDiv('charity-visit-history-list');
    const update = () => {
      if (!isCurrent() || generation !== currentView) return;
      for (const [period, control] of periodButtons) {
        const selected = (state.period ?? 'all') === period;
        control.setAttribute('aria-pressed', String(selected)); control.toggleClass('mod-cta', selected);
      }
      dates.toggle(state.period === 'custom');
      messages.empty(); records.empty();
      for (const warning of inspection.warnings) messages.createEl('p', { text: warning, cls: 'charity-error' });
      try {
        const range = visitPeriodRange(state.period ?? 'all', localDate(), { from: state.from, to: state.to });
        const query = state.query?.trim().toLocaleLowerCase() ?? '';
        const filtered = inspection.visits.filter(visit => isVisitDateInRange(visit.visitDate, range) &&
          (!query || [sourceName(visit.sourcePath), visit.visitDate, visit.observations, visit.finds, visit.nextTime, visit.stockColour ?? ''].join(' ').toLocaleLowerCase().includes(query)))
          .sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.recordedAt.localeCompare(a.recordedAt) || a.path.localeCompare(b.path));
        if (range.from || range.to) messages.createEl('p', { text: (range.from ?? 'Any earlier date') + ' to ' + (range.to ?? 'Any later date'), cls: 'charity-hint' });
        messages.createEl('p', { text: filtered.length + (filtered.length === 1 ? ' recorded visit' : ' recorded visits'), cls: 'charity-hint' });
        if (!filtered.length) {
          records.createEl('p', { text: inspection.visits.length ? 'No visits match. Try another period or clear the search.' : 'No separate visit notes yet. Record a visit from Home or a source note. Earlier inline logs remain in their source notes.', cls: 'charity-empty-state' });
          return;
        }
        for (const visit of filtered) {
          const row = records.createEl('article', { cls: 'charity-visit-history-row' });
          row.createEl('h4', { text: visit.visitDate + ' · ' + sourceName(visit.sourcePath) });
          row.createEl('p', { text: visitSummary(visit), cls: 'charity-visit-summary' });
          const more = details(row, 'Visit details'); more.open = state.expandedVisits![visit.path] === true;
          more.setAttribute('data-charity-section', 'visit-' + visit.id);
          more.addEventListener('toggle', () => { if (isCurrent() && more.isConnected) state.expandedVisits![visit.path] = more.open; });
          renderVisitRecordDetails(more, visit);
          const actions = row.createDiv('charity-actions');
          button(actions, 'Open visit', () => isCurrent() ? context.openFile(visit.path) : undefined);
          button(actions, 'Edit visit', () => { if (isCurrent()) new StructuredVisitModal(context, visit.sourcePath, visit.path).open(); });
          button(actions, 'Open source', () => isCurrent() ? context.openFile(visit.sourcePath) : undefined);
        }
      } catch (error) { messages.createEl('p', { text: errorText(error), cls: 'charity-error' }); }
    };
    for (const [period, label] of [['all', 'All visits'], ['this-week', 'This week'], ['previous-week', 'Previous week'], ['custom', 'Custom dates']] as const) {
      const control = button(periods, label, () => { state.period = period; update(); });
      control.setAttribute('data-charity-focus', 'visits-period-' + period); periodButtons.set(period, control);
    }
    update();
  };
  for (const [view, label] of [['history', 'History'], ['insights', 'Insights']] as const) {
    const control = button(tabs, label, async () => { state.view = view; await renderActive(); });
    control.setAttribute('data-charity-focus', 'visits-view-' + view); viewButtons.set(view, control);
  }
  el.appendChild(body);
  await renderActive();
}
