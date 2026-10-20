import { TFile } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { PlaceRecord } from '../types';
import type { OutingFocusState, OutingRecord } from '../outings/types';
import { changedOutingFocus, confirmOutingParked, focusPhaseLabel, leaveOutingParking, outingFocusFingerprint, outingFocusView } from '../outings/focus';
import { extractSourceContext } from '../outings/domain';
import { googleMapsUrl, navigationUrl, validateCoordinates } from '../domain';
import { button, details, errorText, PickModal, renderContextBanner } from '../ui';

export interface OutingFocusActions {
  openVisit(stopId: string): void;
  finish(): void;
  skip(): void;
  discardDraft(): void;
  catchup(): void | Promise<void>;
}
async function oneReminder(context: NotebookContext, source: PlaceRecord | undefined): Promise<string> {
  if (!source) return '';
  const file = context.app.vault.getAbstractFileByPath(source.path);
  if (!(file instanceof TFile)) return '';
  const [raw, visits] = await Promise.all([context.app.vault.read(file), context.store.visits.list(source.path)]);
  const saved = extractSourceContext(raw), latest = visits.filter(visit => visit.nextTime.trim()).sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.recordedAt.localeCompare(a.recordedAt))[0];
  return latest && (!saved.reminder || latest.visitDate >= saved.reminderDate) ? latest.nextTime : saved.reminder;
}
/** Focus presentation changes only after an explicit stage choice. Opening Maps never advances it. */
export async function renderOutingFocus(context: NotebookContext, el: HTMLElement, record: OutingRecord, places: PlaceRecord[], actions: OutingFocusActions, isCurrent: () => boolean, isActionCurrent: () => boolean = isCurrent): Promise<void> {
  const view = outingFocusView(record, places), fingerprint = outingFocusFingerprint(record, places);
  let reminder = '', reminderError = '';
  try { reminder = await oneReminder(context, view.source); } catch (error) { reminderError = 'The saved reminder is unavailable: ' + errorText(error); }
  if (!isCurrent()) return;
  renderContextBanner(context, el); el.addClass('charity-outing-focus');
  el.createEl('p', { text: 'Out and about', cls: 'charity-focus-label' });
  const card = el.createDiv('charity-focus-card');
  card.createEl('p', { text: view.readyToFinish ? 'All stops have an outcome' : focusPhaseLabel(view.state.phase), cls: 'charity-focus-stage' });
  card.createEl('h3', { text: view.source?.name ?? (view.stop ? 'Source unavailable' : 'Ready when you are') });
  if (view.state.phase === 'return' && view.parked) card.createEl('p', { text: 'Back to ' + view.parked.name, cls: 'charity-focus-destination' });
  else if (view.state.phase === 'drive') card.createEl('p', { text: view.parking ? 'Driving destination: ' + view.parking.name : 'Selected parking location unavailable', cls: 'charity-focus-destination' });
  else if (view.group?.parkingPath && view.parking) card.createEl('p', { text: 'Parking: ' + view.parking.name, cls: 'charity-hint' });
  if (reminder) {
    const item = card.createDiv('charity-focus-reminder'); item.createEl('strong', { text: 'Remember' });
    const first = reminder.trim().split(/\n\s*\n/)[0];
    item.createEl('p', { text: first.length > 360 ? first.slice(0, 357) + '...' : first });
  }
  if (view.warning) card.createEl('p', { text: view.warning, cls: 'charity-hint' });
  const status = el.createDiv({ cls: 'charity-focus-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const preflight = async (): Promise<boolean> => {
    if (!isActionCurrent()) return false;
    const [latest, latestPlaces] = await Promise.all([context.store.outings.get(record.path), context.store.listPlaces()]);
    if (!isActionCurrent()) return false;
    if (outingFocusFingerprint(latest, latestPlaces) !== fingerprint) throw Error('This outing or a location changed. Reopen it to continue.');
    return true;
  };
  const saveState = async (state: OutingFocusState) => {
    if (!isActionCurrent()) return;
    const done = context.beginEditing(); if (!done) return;
    try {
      if (isCurrent()) status.setText('Saving stage...');
      await context.store.outings.setFocus(record.path, state, record.revision, fingerprint);
      if (isCurrent()) status.setText('Stage saved');
    } catch (error) { if (isCurrent()) status.setText(errorText(error)); throw error; } finally { done(); }
  };
  const primary = card.createDiv('charity-focus-actions');
  if (record.operation) {
    card.createEl('p', { text: 'A visit save needs completion. Its original input is retained.', cls: 'charity-error' });
    button(primary, 'Retry visit completion', async () => { if (await preflight()) await context.store.outings.resumeVisit(record.path); }, true);
  } else if (record.draft) {
    const draftStop = record.groups.flatMap(group => group.stops).find(stop => stop.id === record.draft?.stopId);
    const draftSource = places.find(place => place.path === draftStop?.sourcePath);
    card.createEl('p', { text: 'Saved visit draft: ' + (draftSource?.name ?? 'Source unavailable'), cls: 'charity-hint' });
    button(primary, 'Resume visit draft', async () => { if (await preflight()) actions.openVisit(record.draft!.stopId); }, true);
  } else if (view.readyToFinish) button(primary, 'Finish outing', async () => { if (await preflight()) actions.finish(); }, true);
  else if (view.state.phase === 'visit') {
    const recordButton = button(primary, 'Record visit', async () => { if (view.stop && await preflight()) actions.openVisit(view.stop.id); }, true);
    recordButton.disabled = !view.source || view.source.properties.shop_closed === true;
  } else {
    const destination = view.state.phase === 'drive' ? view.parking : view.state.phase === 'return' ? view.parked : view.source;
    const url = navigationUrl(destination?.coordinates ?? null, view.state.phase === 'drive' ? 'driving' : 'walking');
    const label = focusPhaseLabel(view.state.phase), navigate = button(primary, (context.externalActions === 'preview' ? 'Preview ' : '') + label, async () => {
      if (url && await preflight()) await context.openExternal(url, label);
    }, true);
    navigate.disabled = !url || !destination || view.state.phase !== 'return' && view.source?.properties.shop_closed === true;
    if (!url) card.createEl('p', { text: 'Directions need a valid pin for this destination. Review the full outing to add or correct it.', cls: 'charity-hint' });
    if (view.state.phase === 'drive') {
      const parked = button(primary, 'I have parked', () => saveState(confirmOutingParked(record, places)));
      parked.disabled = !view.parking || !validateCoordinates(view.parking.coordinates);
    } else if (view.state.phase === 'walk') {
      const arrived = button(primary, "I'm at the shop", () => saveState(changedOutingFocus(record, places, 'visit')));
      arrived.disabled = !view.source || view.source.properties.shop_closed === true;
    } else button(primary, "I'm back at the car", () => saveState(leaveOutingParking(record, places)));
  }
  const more = details(el, 'More'); more.setAttribute('data-charity-section', 'outing-focus-more');
  const extra = more.createDiv('charity-actions');
  button(extra, 'Full outing view', () => saveState({ ...(record.focus ?? view.state), enabled: false }));
  if (!record.operation && !record.draft) {
    button(extra, 'Change stage', () => new PickModal(context, ['drive', 'walk', 'visit', 'return'] as const, focusPhaseLabel,
      phase => saveState(changedOutingFocus(record, places, phase)), 'Choose your current stage').open());
    if (view.stop) {
      if (view.source) button(extra, 'Visited without notes', async () => { if (await preflight()) await context.store.outings.completeStop(record.path, view.stop!.id, 'visited', record.revision); });
      button(extra, 'Skip stop', async () => { if (await preflight()) actions.skip(); });
    }
    if (!view.readyToFinish) button(extra, 'Finish outing', async () => { if (await preflight()) actions.finish(); });
  }
  if (record.draft && !record.operation) button(extra, 'Discard visit draft', async () => { if (await preflight()) actions.discardDraft(); });
  if (record.operation) button(extra, 'Cancel unsaved attempt', async () => { if (await preflight()) await context.store.outings.cancelPendingVisit(record.path); });
  if (view.source) {
    button(extra, 'Open place', async () => { if (await preflight()) await context.openFile(view.source!.path); });
    button(extra, context.externalActions === 'preview' ? 'Preview Google Maps listing' : 'Google Maps listing', async () => { if (await preflight()) await context.openExternal(googleMapsUrl(view.source!), 'Google Maps listing'); });
  }
  if (record.groups.some(group => group.stops.some(stop => stop.status === 'visited'))) button(extra, 'Catch up on visits', () => { if (isActionCurrent()) return actions.catchup(); });
  if (reminder.length > 360 || reminder.includes('\n\n')) { const full = details(more, 'Full reminder'); full.createEl('p', { text: reminder, cls: 'charity-outing-context' }); }
  if (reminderError) more.createEl('p', { text: reminderError, cls: 'charity-hint' });
  more.createEl('p', { text: 'Stages are manual. Opening directions does not change your stage or record a visit.', cls: 'charity-hint' });
}
