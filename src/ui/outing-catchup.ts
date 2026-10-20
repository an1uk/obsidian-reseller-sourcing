import type { Component } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import { buildOutingCatchup, type OutingCatchup } from '../outings/catch-up';
import { button, details, errorText, renderContextBanner } from '../ui';
import { renderVisitRecordDetails, visitSummary } from './visits';

/** Optional browsing only; the normal visit editor owns all drafts and saves. */
export async function renderOutingCatchup(context: NotebookContext, _owner: Component, el: HTMLElement, path: string,
  openVisit: (stopId: string) => void | Promise<void>, isCurrent: () => boolean = () => true, isActionCurrent: () => boolean = isCurrent): Promise<void> {
  const read = async () => {
    const [outing, inspection, places] = await Promise.all([context.store.outings.get(path), context.store.visits.inspect(), context.store.listPlaces()]);
    return { outing, inspection, overview: buildOutingCatchup(outing, inspection.visits, places, inspection.rejectedAssociations) };
  };
  const { outing, inspection, overview } = await read(); if (!isCurrent()) return;
  el.empty(); el.addClass('charity-outing-catchup'); renderContextBanner(context, el);
  el.createEl('p', { text: outing.name + ' · ' + outing.status, cls: 'charity-hint' });
  el.createEl('p', { text: 'Add anything worth remembering from the places you visited. You can leave details for later or keep them blank.', cls: 'charity-hint' });
  const status = el.createDiv({ cls: 'charity-outing-catchup-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const act = async (stopId: string, recovery = false) => {
    if (!isActionCurrent()) return;
    try {
      const latest = await read(); if (!isActionCurrent()) return;
      const permitted = recovery ? latest.overview.savedWork?.available && latest.overview.savedWork.stopId === stopId :
        latest.overview.rows.some(row => row.stopId === stopId && row.action);
      if (!permitted) throw Error('This saved outing changed. Refresh the view to review its current details.');
      await openVisit(stopId);
    } catch (error) {
      if (!isActionCurrent()) return;
      if (isCurrent()) status.setText(errorText(error)); else throw error;
    }
  };
  if (!overview.available) {
    el.createEl('p', { text: 'Catch up becomes available after this outing has started.', cls: 'charity-empty-state' }); return;
  }
  renderSavedWork(el, overview, act);
  if (inspection.warnings.length) {
    const warnings = details(el, 'Visit notes to review');
    for (const warning of inspection.warnings) warnings.createEl('p', { text: warning, cls: 'charity-hint' });
  }
  if (!overview.rows.length) {
    el.createEl('p', { text: 'There are no visited stops to catch up on. Pending and skipped stops stay in the outing.', cls: 'charity-empty-state' }); return;
  }
  const list = el.createDiv('charity-outing-catchup-list');
  for (const row of overview.rows) {
    const article = list.createEl('article', { cls: 'charity-visit-history-row charity-outing-catchup-row', attr: { 'data-charity-stop': row.stopId } });
    article.createEl('h3', { text: row.name });
    article.createEl('p', { text: (row.visit ? 'Visit ' : 'Suggested visit date ') + row.date.date, cls: 'charity-hint' });
    if (row.visit) {
      article.createEl('p', { text: visitSummary(row.visit), cls: 'charity-visit-summary' });
      if (row.visit.itemsPurchased === undefined) article.createEl('p', { text: 'Items purchased: unknown', cls: 'charity-hint' });
      const note = row.visit.observations.trim();
      article.createEl('p', { text: note ? 'Quick note: ' + (note.length > 180 ? note.slice(0, 180) + '…' : note) : 'No quick note recorded', cls: note ? 'charity-visit-text' : 'charity-hint' });
      const more = details(article, 'Saved visit details'); renderVisitRecordDetails(more, row.visit);
    } else if (!row.issues.length) {
      article.createEl('p', { text: 'Visited without separate details. Items purchased: unknown. Earlier inline notes stay in the source.', cls: 'charity-hint' });
      article.createEl('p', { text: row.date.origin + '. The date can be changed in the visit editor.', cls: 'charity-hint' });
    }
    for (const issue of row.issues) article.createEl('p', { text: issue, cls: 'charity-error' });
    const actions = article.createDiv('charity-actions');
    if (row.action) {
      const label = row.action === 'resume' ? 'Resume visit draft' : row.action === 'edit' ? 'Edit visit details' : 'Add visit details';
      const edit = button(actions, label, () => act(row.stopId)); edit.setAttribute('data-charity-action', 'catchup-' + row.action);
    }
    if (row.visit) button(actions, 'Open saved visit', () => isActionCurrent() ? context.openFile(row.visit!.path) : undefined);
    if (row.sourceAvailable) button(actions, 'Open source', () => isActionCurrent() ? context.openFile(row.sourcePath) : undefined);
  }
}
function renderSavedWork(el: HTMLElement, overview: OutingCatchup, act: (stopId: string, recovery?: boolean) => Promise<void>): void {
  const saved = overview.savedWork; if (!saved) return;
  const section = el.createDiv('charity-empty-state');
  section.createEl('p', { text: saved.kind === 'operation' ? 'An unfinished visit save for ' + saved.name + ' needs review. Its saved input is kept.' : 'A saved visit draft for ' + saved.name + ' is available. Resume it before editing another stop.', cls: 'charity-hint' });
  if (saved.available && !overview.rows.some(row => row.stopId === saved.stopId && row.action === 'resume')) button(section, saved.kind === 'operation' ? 'Review unfinished visit save' : 'Resume visit draft', () => act(saved.stopId, true));
  else if (!saved.available) section.createEl('p', { text: 'The saved stop is unavailable. Review the outing note before continuing.', cls: 'charity-error' });
}
