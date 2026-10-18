import { markInputModal, modalWindow } from './modal-layout';
import { Component, Modal, Notice, Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { PlaceRecord, VisitInput } from '../types';
import type { VisitRecord, VisitOperation } from '../visits/types';
import { localDate } from '../storage/markdown';
import { details, errorText, renderContextBanner, propertyText } from '../ui';

const clone = <T>(value: T): T => structuredClone(value);
const HAUL_LABELS = ['Weak', 'Modest', 'Good', 'Strong', 'Exceptional'];
const EVIDENCE_LABELS = { confirmed: 'Confirmed meaning', suspected: 'Suspected meaning', unknown: 'Meaning unknown' } as const;
export interface VisitFieldsOptions {
  source?: PlaceRecord;
  dateOrigin?: string;
  quickNoteLabel?: string;
  colourSuggestions?: string[];
}
export interface VisitEditor {
  snapshot(): VisitInput;
  validate(): void;
  setDisabled(value: boolean): void;
  dispose?(): void;
}
export function visitDateSuggestion(record?: { startedAt?: string }, stop?: { completedAt?: string }): { date: string; origin: string } {
  for (const [value, origin] of [[stop?.completedAt, 'Suggested from recorded stop completion'], [record?.startedAt, 'Suggested from outing start']] as const) {
    if (value && Number.isFinite(new Date(value).getTime())) return { date: localDate(new Date(value)), origin };
  }
  return { date: localDate(), origin: 'Suggested from today' };
}
export function visitInputFromRecord(record: VisitRecord): VisitInput {
  return {
    observations: record.observations, finds: record.finds, nextTime: record.nextTime,
    visitDate: record.visitDate, updateLastVisited: false,
    ...(record.itemsPurchased === undefined ? {} : { itemsPurchased: record.itemsPurchased }),
    ...(record.haulPotential === undefined ? {} : { haulPotential: record.haulPotential }),
    ...(record.stockColour ? { stockColour: record.stockColour, colourEvidence: record.colourEvidence ?? 'unknown' } : {}),
  };
}
export function visitSummary(visit: VisitRecord): string {
  const summary: string[] = [];
  if (visit.itemsPurchased !== undefined) summary.push(visit.itemsPurchased + (visit.itemsPurchased === 1 ? ' item purchased' : ' items purchased'));
  if (visit.itemsPurchased === 0) summary.push('Haul score not applicable');
  else if (visit.haulPotential !== undefined) summary.push('Whole-haul potential ' + visit.haulPotential + '/5 (' + HAUL_LABELS[visit.haulPotential - 1] + ')');
  if (visit.stockColour) summary.push('Stock colour: ' + visit.stockColour + ' (' + EVIDENCE_LABELS[visit.colourEvidence ?? 'unknown'] + ')');
  return summary.join(' · ') || 'No purchase count, haul score or stock colour recorded';
}

/** Keep the focused field above the footer when a phone keyboard resizes the viewport. */
function keepVisitFieldVisible(parent: HTMLElement): () => void {
  const win = parent.ownerDocument?.defaultView;
  if (!win || typeof win.addEventListener !== 'function' || typeof parent.closest !== 'function') return () => {};
  const scroller = parent.closest<HTMLElement>('.modal-content');
  if (!scroller) return () => {};
  let timer: number | undefined, settleTimer: number | undefined, lateTimer: number | undefined, disposed = false;
  const reveal = () => {
    if (disposed || !parent.isConnected) return;
    const active = parent.ownerDocument.activeElement as HTMLElement | null;
    if (!active || !parent.contains(active) || !active.matches('input,textarea,select')) return;
    const bounds = scroller.getBoundingClientRect(), field = active.getBoundingClientRect();
    const viewport = win.visualViewport, viewportTop = viewport?.offsetTop ?? 0;
    const top = Math.max(bounds.top, viewportTop) + 8;
    let bottom = Math.min(bounds.bottom, viewportTop + (viewport?.height ?? win.innerHeight)) - 8;
    const footer = scroller.querySelector<HTMLElement>('.charity-modal-footer')?.getBoundingClientRect();
    if (footer && footer.top >= top && footer.top < bottom) bottom = footer.top - 8;
    if (bottom <= top) return;
    const delta = field.height > bottom - top ? field.top - top : field.bottom > bottom ? field.bottom - bottom : field.top < top ? field.top - top : 0;
    if (Math.abs(delta) > 1) scroller.scrollTop += delta;
  };
  const cancelChecks = () => { win.clearTimeout(timer); win.clearTimeout(settleTimer); win.clearTimeout(lateTimer); };
  const schedule = () => {
    if (disposed) return; cancelChecks();
    // Android may apply native focus scrolling after the keyboard resize.
    timer = win.setTimeout(reveal, 160); settleTimer = win.setTimeout(reveal, 500); lateTimer = win.setTimeout(reveal, 1000);
  };
  scroller.addEventListener('pointerdown', cancelChecks);
  parent.addEventListener('focusin', schedule); win.addEventListener('resize', schedule); win.visualViewport?.addEventListener('resize', schedule);
  // Capacitor changes the modal size through --keyboard-height without a browser resize.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
  observer?.observe(scroller);
  const body = parent.ownerDocument.body;
  let keyboardHeight = body ? win.getComputedStyle(body).getPropertyValue('--keyboard-height') : '';
  const keyboardObserver = body && typeof MutationObserver === 'function' ? new MutationObserver(() => {
    const next = win.getComputedStyle(body).getPropertyValue('--keyboard-height');
    if (next !== keyboardHeight) { keyboardHeight = next; schedule(); }
  }) : undefined;
  keyboardObserver?.observe(body, { attributes: true, attributeFilter: ['style', 'class'] });
  return () => { if (disposed) return; disposed = true; observer?.disconnect(); keyboardObserver?.disconnect(); cancelChecks(); scroller.removeEventListener('pointerdown', cancelChecks); parent.removeEventListener('focusin', schedule); win.removeEventListener('resize', schedule); win.visualViewport?.removeEventListener('resize', schedule); };
}

/** Shared quick fields. Source updates are opt-in and never re-applied by editing old visits. */
export function renderVisitFields(parent: HTMLElement, input: VisitInput, changed: () => void, options: VisitFieldsOptions = {}): VisitEditor {
  parent.addClass('charity-structured-visit-fields');
  new Setting(parent).setName('Visit date').setDesc((options.dateOrigin || 'Editable actual visit date') + '. Change it for an earlier visit.').addText(control => {
    control.inputEl.type = 'date'; control.inputEl.setAttribute('aria-label', 'Visit date');
    control.setValue(input.visitDate).onChange(value => { input.visitDate = value; changed(); });
  });
  let scoreControl!: HTMLSelectElement;
  const noHaul = parent.createEl('p', { cls: 'charity-hint charity-visit-no-haul', attr: { role: 'status' } });
  const updateScoreState = () => {
    scoreControl.disabled = input.itemsPurchased === 0;
    scoreControl.value = input.itemsPurchased === 0 || input.haulPotential === undefined ? '' : String(input.haulPotential);
    noHaul.setText(input.itemsPurchased === 0 ? 'No purchases: haul score is not applicable. Saving clears any saved haul score.' : '');
    noHaul.toggle(input.itemsPurchased === 0);
  };
  new Setting(parent).setName('Items purchased').setDesc('Leave blank if unknown. Enter 0 when you bought nothing.').addText(control => {
    control.inputEl.type = 'number'; control.inputEl.min = '0'; control.inputEl.step = '1'; control.inputEl.setAttribute('aria-label', 'Items purchased');
    control.setValue(input.itemsPurchased === undefined ? '' : String(input.itemsPurchased)).onChange(value => {
      input.itemsPurchased = value.trim() ? Number(value) : undefined; updateScoreState(); changed();
    });
  });
  new Setting(parent).setName('Quick note').addTextArea(control => {
    control.inputEl.rows = 4; control.inputEl.placeholder = 'What is worth remembering?'; control.inputEl.setAttribute('aria-label', options.quickNoteLabel ?? 'Visit quick note');
    control.setValue(input.observations).onChange(value => { input.observations = value; changed(); });
  });
  const haul = details(parent, 'Haul and stock details');
  haul.open = input.haulPotential !== undefined || !!input.stockColour?.trim();
  new Setting(haul).setName('Whole-haul profit potential').setDesc('Expected potential for the entire haul, separate from the sourcing rating.').addDropdown(control => {
    scoreControl = control.selectEl; scoreControl.setAttribute('aria-label', 'Whole-haul profit potential');
    control.addOption('', 'Not assessed');
    for (let value = 1; value <= 5; value++) control.addOption(String(value), value + ' · ' + HAUL_LABELS[value - 1]);
    control.setValue(input.haulPotential === undefined ? '' : String(input.haulPotential)).onChange(value => { input.haulPotential = value ? Number(value) : undefined; changed(); });
  });
  haul.appendChild(noHaul); updateScoreState();
  const colours = haul.createEl('datalist', { attr: { id: 'visit-stock-colours-' + crypto.randomUUID() } });
  for (const value of [...new Set(options.colourSuggestions ?? [])].filter(Boolean).sort()) colours.createEl('option', { value });
  new Setting(haul).setName('Stock colour').setDesc('One observed label or colour for this branch. Its meaning may be unknown.').addText(control => {
    control.inputEl.setAttribute('aria-label', 'Stock colour'); control.inputEl.setAttribute('list', colours.id);
    control.setValue(input.stockColour ?? '').onChange(value => { input.stockColour = value; changed(); });
  });
  new Setting(haul).setName('Colour meaning').setDesc('Confirmed means staff, signage or direct observation established its meaning.').addDropdown(control => {
    control.selectEl.setAttribute('aria-label', 'Colour meaning');
    control.addOption('unknown', 'Meaning unknown').addOption('suspected', 'Suspected meaning').addOption('confirmed', 'Confirmed by staff, signage or observation');
    control.setValue(input.colourEvidence ?? 'unknown').onChange(value => { input.colourEvidence = value as VisitInput['colourEvidence']; changed(); });
  });
  const optional = details(parent, 'Finds and reminders');
  optional.open = !!input.finds.trim() || !!input.nextTime.trim();
  for (const [key, label] of [['finds', 'Useful finds'], ['nextTime', 'Remember next time']] as const) new Setting(optional).setName(label).addTextArea(control => {
    control.inputEl.rows = 3; control.inputEl.setAttribute('aria-label', label); control.setValue(input[key]).onChange(value => { input[key] = value; changed(); });
  });
  let updateAssessment = input.rating !== undefined || input.comments !== undefined;
  const sourceUpdates = details(parent, 'Update source assessment');
  sourceUpdates.open = updateAssessment || input.updateLastVisited;
  new Setting(sourceUpdates).setName('Update last visited').setDesc('Only changes the source date when selected.').addToggle(control => control.setValue(input.updateLastVisited).onChange(value => { input.updateLastVisited = value; changed(); }));
  let rating = input.rating ?? Number(options.source?.properties.rating ?? 0), takeaway = input.comments ?? propertyText(options.source?.properties.comments);
  const assessment = sourceUpdates.createDiv();
  new Setting(sourceUpdates).setName('Update current assessment').setDesc('Only changes the source when selected.').addToggle(control => control.setValue(updateAssessment).onChange(value => {
    updateAssessment = value; assessment.toggle(value); input.rating = value ? rating : undefined; input.comments = value ? takeaway : undefined; changed();
  }));
  new Setting(assessment).setName('Sourcing rating').addDropdown(control => {
    control.selectEl.setAttribute('aria-label', 'Sourcing rating');
    for (let value = 0; value <= 5; value += .5) control.addOption(String(value), value ? String(value) : '0 · Not rated');
    control.setValue(String(rating)).onChange(value => { rating = Number(value); if (updateAssessment) { input.rating = rating; changed(); } });
  });
  new Setting(assessment).setName('Takeaway').addText(control => control.setValue(takeaway).onChange(value => { takeaway = value; if (updateAssessment) { input.comments = value; changed(); } }));
  sourceUpdates.appendChild(assessment); assessment.toggle(updateAssessment);
  const snapshot = () => {
    const value = clone(input);
    if (value.itemsPurchased === 0) delete value.haulPotential;
    value.stockColour = value.stockColour?.trim() || undefined;
    if (!value.stockColour) delete value.colourEvidence; else value.colourEvidence ??= 'unknown';
    return value;
  };
  const stopViewport = keepVisitFieldVisible(parent);
  return {
    dispose: stopViewport,
    snapshot,
    validate() {
      const value = snapshot();
      if (value.itemsPurchased !== undefined && (!Number.isSafeInteger(value.itemsPurchased) || value.itemsPurchased < 0)) throw Error('Items purchased must be a whole number of 0 or more, or blank.');
      if (value.haulPotential !== undefined && (!Number.isInteger(value.haulPotential) || value.haulPotential < 1 || value.haulPotential > 5)) throw Error('Choose a whole-haul potential from 1 to 5, or leave it blank.');
      const date = new Date(value.visitDate + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value.visitDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.visitDate) throw Error('Choose a valid actual visit date.');
      if (!value.observations.trim() && !value.finds.trim() && !value.nextTime.trim() && value.itemsPurchased === undefined && value.haulPotential === undefined && !value.stockColour && value.rating === undefined && !value.comments?.trim()) throw Error('Add a purchase count, haul score, stock colour or a few visit details.');
    },
    setDisabled(value) {
      parent.inert = value;
      parent.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select').forEach(control => control.disabled = value);
      if (!value) updateScoreState();
    },
  };
}

export class StructuredVisitModal extends Modal {
  private input: VisitInput = { observations: '', finds: '', nextTime: '', visitDate: localDate(), updateLastVisited: false };
  private visit?: VisitRecord;
  private visitRevision?: string;
  private draftRevision = '';
  private fields?: VisitEditor;
  private form!: HTMLElement;
  private status!: HTMLElement;
  private finishEditing?: () => void;
  private closed = false;
  private saving = false;
  private closing = false;
  private completed = false;
  private changed = false;
  private timer?: number;
  private queue: Promise<void> = Promise.resolve();
  private persisted = '';
  private operationId = crypto.randomUUID();
  private background = () => { if (this.contentEl.ownerDocument?.hidden) void this.flush().catch(error => this.draftFailure(error)); };
  constructor(private context: NotebookContext, private sourcePath: string, private visitPath?: string) { super(context.app); }
  onOpen(): void { markInputModal(this);
    if (!(this.finishEditing = this.context.beginEditing())) { this.close(); return; }
    this.modalEl.addClass('charity-visit-modal', 'charity-structured-visit-modal');
    this.contentEl.ownerDocument?.addEventListener('visibilitychange', this.background);
    this.titleEl.setText(this.visitPath ? 'Edit visit' : 'Add visit');
    this.status = this.contentEl.createDiv({ cls: 'charity-save-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.status.setText('Loading visit...');
    void this.load().catch(error => { if (!this.closed) { this.status.setText(errorText(error)); this.status.addClass('charity-error'); } });
  }
  private async load(): Promise<void> {
    this.fields?.dispose?.();
    const [places, visits, visit, draftState, operations] = await Promise.all([
      this.context.store.listPlaces(), this.context.store.visits.list(this.sourcePath),
      this.visitPath ? this.context.store.visits.get(this.visitPath) : Promise.resolve(undefined),
      this.context.store.visits.getDraftState(this.sourcePath, this.visitPath), this.context.store.visits.pendingOperations(),
    ]);
    if (this.closed) return;
    const source = places.find(place => place.path === this.sourcePath && place.kind === 'shop');
    if (!source) throw Error('This source is no longer available in this notebook.');
    if (visit && visit.sourcePath !== this.sourcePath) throw Error('This visit belongs to another source.');
    this.visit = visit;
    this.draftRevision = draftState?.revision ?? '';
    const draft = draftState && !draftState.cleared ? draftState : undefined;
    this.visitRevision = draft ? draft.visitRevision : visit?.revision;
    const pending = operations.filter(operation => operation.sourcePath === this.sourcePath && (!this.visitPath || operation.visitPath === this.visitPath));
    this.contentEl.empty(); renderContextBanner(this.context, this.contentEl);
    if (pending.length) {
      this.contentEl.createEl('p', { text: 'A previous visit save needs completion before these details can be edited.', cls: 'charity-error' });
      for (const operation of pending) renderRecoveryOperation(this.context, this.contentEl, operation, () => this.finishAndClose());
      return;
    }
    if (visit) this.input = visitInputFromRecord(visit);
    if (draft) this.input = clone(draft.input);
    this.persisted = draft ? JSON.stringify(this.input) : '';
    if (visit && draft && !this.visitRevision) {
      this.contentEl.createEl('p', { text: 'This older draft has no saved visit comparison. Its entered details are kept below. Review the saved visit, then explicitly discard this draft and reopen the editor before saving.', cls: 'charity-error' });
      this.contentEl.createEl('p', { text: 'Saved draft actual date: ' + this.input.visitDate + ' · ' + visitSummary({ ...visit, ...this.input }), cls: 'charity-hint' });
      for (const value of [this.input.observations, this.input.finds, this.input.nextTime]) if (value) this.contentEl.createEl('p', { text: value, cls: 'charity-visit-text' });
      this.status = this.contentEl.createDiv({ cls: 'charity-save-status', attr: { role: 'status', 'aria-live': 'polite' } });
      const open = this.contentEl.createEl('button', { text: 'Open saved visit' }); open.onclick = () => { void this.context.openFile(visit.path).catch(error => new Notice(errorText(error))); };
      const discard = this.contentEl.createEl('button', { text: 'Discard unfinished changes' }); discard.onclick = () => { void this.discard(); }; return;
    }
    if (visit && draft && this.visitRevision !== visit.revision) this.contentEl.createEl('p', { text: 'The saved visit changed after this draft began. Your draft is kept; review the saved note and discard/reopen the draft before saving.', cls: 'charity-error' });
    this.contentEl.createEl('p', { text: source.name, cls: 'charity-hint' });
    this.form = this.contentEl.createDiv();
    this.fields = renderVisitFields(this.form, this.input, () => this.schedule(), {
      source, dateOrigin: draft ? 'Restored unfinished visit date' : visit ? 'Saved actual visit date' : 'Suggested from today',
      colourSuggestions: visits.map(value => value.stockColour ?? ''),
    });
    const footer = this.contentEl.createDiv('charity-modal-footer charity-actions');
    this.status = footer.createDiv({ cls: 'charity-save-status', attr: { role: 'status', 'aria-live': 'polite' } });
    if (draft) this.status.setText('Unfinished draft restored');
    const save = footer.createEl('button', { text: 'Save visit', cls: 'mod-cta' }); save.onclick = () => { void this.save(); };
    const cancel = footer.createEl('button', { text: 'Close' }); cancel.onclick = () => this.close();
    const more = details(footer, 'More');
    const discard = more.createEl('button', { text: 'Discard draft', cls: 'mod-warning' });
    discard.onclick = () => { void this.discard(); };
  }
  private schedule(): void {
    this.changed = true; modalWindow(this).clearTimeout(this.timer);
    this.status?.setText('Saving draft...');
    this.timer = modalWindow(this).setTimeout(() => { void this.flush().catch(error => this.draftFailure(error)); }, 500);
  }
  private draftFailure(error: unknown): void {
    if (!this.closed) { this.status?.setText('Draft not saved: ' + errorText(error)); this.status?.addClass('charity-error'); }
    else new Notice('Visit draft was not saved: ' + errorText(error), 12000);
    this.showDraftConflict(error);
  }
  private showDraftConflict(error: unknown): void {
    if (this.closed || !/draft.*(?:changed|removed|another|elsewhere)/i.test(errorText(error)) || this.contentEl.querySelector('.charity-visit-draft-conflict')) return;
    const section = this.contentEl.createDiv('charity-visit-draft-conflict');
    section.createEl('p', { text: 'Another saved draft has been kept. Your entered details remain in this form. Copy them below before closing, then reopen the saved draft to review it.', cls: 'charity-hint' });
    const input = this.fields?.snapshot() ?? clone(this.input);
    const values = [['Visit date', input.visitDate], ['Items purchased', input.itemsPurchased === undefined ? 'Unknown' : String(input.itemsPurchased)], ['Whole-haul potential', input.haulPotential === undefined ? 'Not assessed' : String(input.haulPotential)], ['Stock colour', input.stockColour ?? ''], ['Colour meaning', input.colourEvidence ?? 'unknown'], ['Observations', input.observations], ['Useful finds', input.finds], ['Remember next time', input.nextTime], ['Update last visited', input.updateLastVisited ? 'Yes' : 'No'], ['Source rating update', input.rating === undefined ? 'No change' : String(input.rating)], ['Source takeaway update', input.comments ?? 'No change']];
    const copy = section.createEl('textarea', { cls: 'charity-copy-conflict', attr: { 'aria-label': 'Entered visit details to copy before closing' } }); copy.rows = 8; copy.readOnly = true; copy.value = values.map(([label, value]) => label + ': ' + value).join('\n\n');
    const close = section.createEl('button', { text: 'Close without saving this form' }); close.onclick = () => { this.changed = false; this.completed = true; this.close(); };
  }
  private flush(): Promise<void> {
    modalWindow(this).clearTimeout(this.timer);
    if (!this.changed || this.completed || !this.fields) return this.queue;
    const snapshot = this.fields.snapshot(), signature = JSON.stringify(snapshot);
    const run = async () => {
      if (signature === this.persisted) return;
      this.draftRevision = await this.context.store.visits.saveDraft(this.sourcePath, snapshot, this.visitPath, this.draftRevision, this.visitRevision);
      this.persisted = signature;
      if (!this.closed) { this.status?.setText(JSON.stringify(this.fields?.snapshot()) === this.persisted ? 'Draft saved' : 'Saving draft…'); this.status?.removeClass('charity-error'); }
    };
    const next = this.queue.then(run, run); this.queue = next; return next;
  }
  private setSaving(value: boolean): void {
    this.saving = value; this.fields?.setDisabled(value);
    this.contentEl.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = value);
  }
  private async save(): Promise<void> {
    if (this.closed || this.saving || !this.fields) return;
    if (this.completed) {
      this.setSaving(true);
      try { await this.context.store.visits.clearDraft(this.sourcePath, this.visitPath, this.draftRevision); this.setSaving(false); this.finishAndClose(); }
      catch (error) { this.setSaving(false); this.fields.setDisabled(true); this.status.setText('Visit saved; draft cleanup still needs completion: ' + errorText(error)); }
      return;
    }
    try { this.fields.validate(); } catch (error) { this.status.setText(errorText(error)); this.status.addClass('charity-error'); return; }
    this.setSaving(true);
    try {
      await this.flush(); this.status.setText('Saving visit...'); this.status.removeClass('charity-error');
      const input = this.fields.snapshot();
      const draft = await this.context.store.visits.getDraftState(this.sourcePath, this.visitPath);
      if ((draft?.revision ?? '') !== this.draftRevision) throw Error('This unfinished draft changed in another editor. Your entered details are kept; reopen it to review the saved draft.');
      if (this.visit) this.visit = await this.context.store.visits.update(this.visit.path, input, this.visitRevision ?? '', { draftRevision: this.draftRevision });
      else this.visit = await this.context.store.visits.create(this.sourcePath, input, { operationId: this.operationId, draftRevision: this.draftRevision });
      this.completed = true;
      await this.context.store.visits.clearDraft(this.sourcePath, this.visitPath, this.draftRevision);
      this.setSaving(false); this.finishAndClose(); new Notice('Visit saved');
    } catch (error) {
      this.status.setText((this.completed ? 'Visit saved; draft cleanup needs completion: ' : 'Not completed: ') + errorText(error)); this.status.addClass('charity-error');
      this.setSaving(false); this.showDraftConflict(error);
      if (this.completed) {
        this.fields.setDisabled(true);
        const save = this.contentEl.querySelector<HTMLButtonElement>('button.mod-cta'); if (save) save.setText('Finish draft cleanup');
      }
      const pending = await this.context.store.visits.pendingOperations().catch(() => []);
      if (!this.closed && pending.some(operation => operation.sourcePath === this.sourcePath)) { this.changed = false; this.contentEl.empty(); await this.load(); }
    } finally { if (this.closed) this.release(); }
  }
  private async discard(): Promise<void> {
    if (this.saving || this.closed) return;
    this.setSaving(true); modalWindow(this).clearTimeout(this.timer);
    try {
      await this.queue.catch(() => undefined);
      await this.context.store.visits.clearDraft(this.sourcePath, this.visitPath, this.draftRevision);
      this.changed = false; this.completed = true; this.setSaving(false); this.finishAndClose();
    } catch (error) { this.setSaving(false); this.draftFailure(error); }
  }
  private finishAndClose(): void { this.completed = true; this.changed = false; this.close(); }
  private release(): void { this.finishEditing?.(); this.finishEditing = undefined; }
  close(): void {
    if (this.saving) return;
    if (!this.completed && this.changed && this.fields) {
      if (this.closing) return;
      this.closing = true; this.setSaving(true);
      void this.flush().then(() => { this.setSaving(false); this.changed = false; this.close(); })
        .catch(error => { this.setSaving(false); this.draftFailure(error); }).finally(() => this.closing = false);
      return;
    }
    this.closed = true; super.close();
  }
  onClose(): void {
    this.closed = true; this.contentEl.ownerDocument?.removeEventListener('visibilitychange', this.background);
    this.fields?.dispose?.(); modalWindow(this).clearTimeout(this.timer); this.contentEl.empty();
    if (!this.saving) void this.flush().catch(error => this.draftFailure(error)).finally(() => this.release());
  }
}

export function renderVisitRecordDetails(el: HTMLElement, visit: VisitRecord): void {
  for (const [label, value] of [['Observations', visit.observations], ['Useful finds', visit.finds], ['Remember next time', visit.nextTime]]) if (value) {
    el.createEl('strong', { text: label }); el.createEl('p', { text: value, cls: 'charity-visit-text' });
  }
  el.createEl('p', { text: 'Recorded ' + visit.recordedAt + (visit.updatedAt !== visit.recordedAt ? ' · edited ' + visit.updatedAt : ''), cls: 'charity-hint' });
}
export async function renderVisitHistory(context: NotebookContext, _owner: Component, el: HTMLElement, sourcePath: string, isCurrent: () => boolean = () => true): Promise<void> {
  const visits = await context.store.visits.list(sourcePath); if (!isCurrent()) return;
  const section = details(el, 'Visits (' + visits.length + ')');
  if (!visits.length) { section.createEl('p', { text: 'No separate visit notes yet. Earlier inline visit logs remain in this source note.', cls: 'charity-hint' }); return; }
  for (const visit of [...visits].sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.recordedAt.localeCompare(a.recordedAt) || a.path.localeCompare(b.path))) {
    const row = section.createDiv('charity-visit-history-row');
    row.createEl('strong', { text: visit.visitDate }); row.createEl('p', { text: visitSummary(visit), cls: 'charity-visit-summary' });
    const more = details(row, 'Visit details'); renderVisitRecordDetails(more, visit);
    const actions = row.createDiv('charity-actions');
    const open = actions.createEl('button', { text: 'Open visit' }); open.onclick = () => { void context.openFile(visit.path).catch(error => new Notice(errorText(error))); };
    const edit = actions.createEl('button', { text: 'Edit visit' }); edit.onclick = () => { if (isCurrent()) new StructuredVisitModal(context, sourcePath, visit.path).open(); };
  }
}
export async function renderVisitNote(context: NotebookContext, _owner: Component, el: HTMLElement, path: string, isCurrent: () => boolean = () => true): Promise<void> {
  const visit = await context.store.visits.get(path); if (!isCurrent()) return;
  const places = await context.store.listPlaces(); if (!isCurrent()) return;
  renderContextBanner(context, el); el.addClass('charity-structured-visit');
  el.createEl('h3', { text: 'Visit on ' + visit.visitDate });
  el.createEl('p', { text: visitSummary(visit), cls: 'charity-visit-summary' });
  el.createEl('p', { text: 'Recorded ' + visit.recordedAt + (visit.updatedAt !== visit.recordedAt ? ' · edited ' + visit.updatedAt : ''), cls: 'charity-hint' });
  const actions = el.createDiv('charity-actions');
  const source = places.find(place => place.path === visit.sourcePath);
  const open = actions.createEl('button', { text: 'Open ' + (source?.name ?? 'source') }); open.onclick = () => { void context.openFile(visit.sourcePath).catch(error => new Notice(errorText(error))); };
  if (visit.outingPath) {
    const outing = actions.createEl('button', { text: 'Open outing' }); outing.onclick = () => { void context.openFile(visit.outingPath!).catch(error => new Notice(errorText(error))); };
  }
  const edit = actions.createEl('button', { text: 'Edit visit' }); edit.onclick = () => { if (isCurrent()) new StructuredVisitModal(context, visit.sourcePath, visit.path).open(); };
}

export function renderRecoveryOperation(context: NotebookContext, el: HTMLElement, operation: VisitOperation, resolved?: () => void, isCurrent: () => boolean = () => true): void {
  const row = el.createDiv('charity-visit-recovery');
  row.createEl('strong', { text: operation.kind === 'update' ? 'Finish editing a visit' : 'Finish saving a visit' });
  row.createEl('p', { text: operation.sourcePath.split('/').pop()?.replace(/\.md$/, '') + ' · actual visit ' + operation.input.visitDate, cls: 'charity-hint' });
  row.createEl('p', { text: visitSummary(operation.expected), cls: 'charity-visit-summary' });
  for (const value of [operation.input.observations, operation.input.finds, operation.input.nextTime]) if (value) row.createEl('p', { text: value, cls: 'charity-visit-text' });
  row.createEl('p', { text: operation.stage === 'prepared' ? 'The saved input is retained. Complete this save, or cancel before a visit has been written.' : 'The visit was written. Finish the remaining source or outing updates; the visit will not be written twice.', cls: 'charity-hint' });
  const status = row.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
  const actions = row.createDiv('charity-actions');
  let busy = false;
  const action = (label: string, run: () => Promise<unknown>, primary = false) => {
    const button = actions.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' });
    button.onclick = () => {
      if (busy || !isCurrent()) return;
      const finish = context.beginEditing(); if (!finish) return;
      busy = true; actions.querySelectorAll<HTMLButtonElement>('button').forEach(value => value.disabled = true); status.setText('Completing...');
      void run().then(() => {
        if (!isCurrent()) return;
        status.setText('Resolved'); row.remove(); resolved?.();
      }).catch(error => {
        if (row.isConnected && isCurrent()) { status.setText(errorText(error)); status.addClass('charity-error'); }
        else new Notice('Visit save needs attention: ' + errorText(error));
      }).finally(() => {
        busy = false; finish();
        if (row.isConnected) actions.querySelectorAll<HTMLButtonElement>('button').forEach(value => value.disabled = false);
      });
    }; return button;
  };
  action('Finish visit save', () => operation.outingPath ? context.store.outings.resumeVisit(operation.outingPath) : context.store.visits.resumeOperation(operation.id), true);
  if (operation.stage === 'prepared') action('Cancel unwritten save', () => operation.outingPath ? context.store.outings.cancelPendingVisit(operation.outingPath) : context.store.visits.cancelOperation(operation.id));
}
export async function renderVisitRecovery(context: NotebookContext, el: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const operations = await context.store.visits.pendingOperations(); if (!isCurrent() || !operations.length) return;
  const section = el.createDiv('charity-visit-recovery-list'); section.createEl('h3', { text: 'Visit saves needing attention' });
  for (const operation of operations) renderRecoveryOperation(context, section, operation, undefined, isCurrent);
}
