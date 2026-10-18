import { markInputModal } from './modal-layout';
import { DropdownComponent, Modal } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { CaptureDraft, PlaceRecord } from '../types';
import type { CaptureRefreshField, CaptureRefreshPreview } from '../capture/refresh';
import { errorText, renderContextBanner } from '../ui';

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join('\n') : 'Not recorded';
  if (typeof value === 'object') {
    const snapshot = value as Record<string, unknown>;
    if ('rating' in snapshot) return 'Google score: ' + displayValue(snapshot.rating) + '\nReview count: ' + displayValue(snapshot.reviewCount) + '\nChecked: ' + displayValue(snapshot.checked);
    if ('hours' in snapshot) return displayValue(snapshot.hours) + '\nChecked: ' + displayValue(snapshot.checked);
    if ('topics' in snapshot) return displayValue(snapshot.topics) + '\nChecked: ' + displayValue(snapshot.checked);
    return Object.entries(snapshot).map(([key, item]) => key + ': ' + displayValue(item)).join('\n');
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol' ? String(value) : 'Unavailable';
}

/** A pending capture stays untouched until the user explicitly applies or archives it. */
export class CaptureRefreshModal extends Modal {
  private targetPath = '';
  private preview?: CaptureRefreshPreview;
  private choices = new Map<CaptureRefreshField, boolean>();
  private finishEditing?: () => void;
  private ended = false;
  private closed = false;
  private busy = false;
  private failed = false;
  private targetControl?: DropdownComponent;
  private targetEl!: HTMLElement;
  private fieldsEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private status!: HTMLElement;

  constructor(private plugin: NotebookContext, private draft: CaptureDraft, private matches: PlaceRecord[], private done?: () => void) { super(plugin.app); }

  onOpen(): void { markInputModal(this);
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.modalEl.addClass('charity-capture-refresh-modal'); this.titleEl.setText('Review source updates'); renderContextBanner(this.plugin, this.contentEl);
    this.contentEl.createEl('p', { text: 'This capture matches an existing Google Maps listing. Choose which information to update. Your sourcing assessment, visits and note text stay as recorded.', cls: 'charity-hint' });
    this.contentEl.createEl('p', { text: 'Captured: ' + this.draft.capturedAt, cls: 'charity-capture-refresh-date' });
    if (this.matches.length > 1) {
      const label = this.contentEl.createEl('label', { text: 'Choose the matching source', cls: 'charity-capture-refresh-target-label' });
      const controlEl = this.contentEl.createDiv('charity-capture-refresh-target-control');
      this.targetControl = new DropdownComponent(controlEl).addOption('', 'Choose a source');
      const controlId = 'charity-refresh-target-' + this.draft.captureId.replace(/[^a-zA-Z0-9_-]/g, '');
      label.htmlFor = controlId; this.targetControl.selectEl.id = controlId;
      for (const place of this.matches) this.targetControl.addOption(place.path, place.path);
      this.targetControl.onChange(path => {
        if (this.closed || this.busy) { this.targetControl?.setValue(this.targetPath); return; }
        this.targetPath = path; this.preview = undefined; this.choices.clear(); this.failed = false;
        this.targetEl.empty(); this.fieldsEl.empty(); this.actionsEl.empty();
        if (path) void this.perform(() => this.refresh(false));
        else this.status.setText('Choose a matching source to compare.');
      });
    } else this.targetPath = this.matches[0]?.path ?? '';
    const tools = this.contentEl.createDiv('charity-actions charity-capture-refresh-tools');
    this.action(tools, 'Refresh comparison', () => this.refresh(), false, () => !this.targetPath);
    this.targetEl = this.contentEl.createDiv('charity-capture-refresh-target');
    this.status = this.contentEl.createDiv({ cls: 'charity-capture-refresh-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.fieldsEl = this.contentEl.createDiv('charity-capture-refresh-fields');
    this.actionsEl = this.contentEl.createDiv('charity-modal-footer charity-capture-refresh-actions');
    if (this.targetPath) void this.perform(() => this.refresh(false));
    else this.status.setText('Choose a matching source to compare.');
    this.setBusy(false);
  }

  private accept(preview: CaptureRefreshPreview, preserve = true): void {
    if (!preserve) this.choices.clear();
    this.preview = preview; this.failed = false;
    for (const field of preview.fields) if (!this.choices.has(field.key)) this.choices.set(field.key, field.selected);
    this.render();
  }
  private async refresh(preserve = true): Promise<void> {
    if (!this.targetPath) return;
    const preview = await this.plugin.store.previewCaptureRefresh(this.draft, this.targetPath);
    if (this.closed) return;
    this.accept(preview, preserve);
    this.status.setText(preview.completed ? 'Source changes are already saved. Finish archiving the original capture; the changes will not be applied again.' : 'Comparison refreshed. Review the selected changes before applying.');
    this.status.removeClass('charity-error');
  }
  private async perform(run: () => Promise<void>): Promise<void> {
    if (this.closed || this.busy) return;
    this.busy = true; this.setBusy(true);
    try { await run(); }
    catch (error) {
      if (!this.closed) {
        this.failed = true;
        this.status.setText('Comparison unavailable: ' + errorText(error) + ' If the original capture changed, close this review and reopen it from Review captures.');
        this.status.addClass('charity-error'); this.render();
      }
    } finally {
      this.busy = false;
      if (this.closed) this.finish(); else this.setBusy(false);
    }
  }
  private action(parent: HTMLElement, label: string, run: () => Promise<void>, primary = false, disabled: () => boolean = () => false): HTMLButtonElement {
    const control = parent.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' });
    control.dataset.refreshDisabled = String(disabled()); (control as HTMLButtonElement & { refreshDisabled?: () => boolean }).refreshDisabled = disabled;
    control.disabled = this.busy || disabled(); control.onclick = () => { void this.perform(run); }; return control;
  }
  private setBusy(busy: boolean): void {
    this.targetControl?.setDisabled(busy);
    for (const control of this.contentEl.querySelectorAll<HTMLButtonElement>('button')) {
      const disabled = (control as HTMLButtonElement & { refreshDisabled?: () => boolean }).refreshDisabled;
      control.disabled = control.dataset.refreshCancel === 'true' ? false : busy || (disabled?.() ?? false);
    }
    for (const control of this.fieldsEl?.querySelectorAll<HTMLInputElement>('input[type=checkbox]') ?? []) control.disabled = busy || control.dataset.refreshDisabled === 'true';
  }
  private selectedFields(): CaptureRefreshField[] {
    return this.preview?.fields.filter(field => field.available && field.changed && this.choices.get(field.key)).map(field => field.key) ?? [];
  }
  private render(): void {
    if (this.closed || !this.fieldsEl) return;
    this.targetEl.empty(); this.fieldsEl.empty(); this.actionsEl.empty();
    const preview = this.preview;
    if (!preview) { this.setBusy(this.busy); return; }
    const filename = preview.targetPath.split('/').at(-1) ?? preview.targetPath;
    const folder = preview.targetPath.split('/').slice(0, -1).join('/');
    this.targetEl.createEl('strong', { text: filename });
    this.targetEl.createEl('p', { text: folder, cls: 'charity-hint' });
    if (preview.warnings.length) {
      const warnings = this.fieldsEl.createDiv('charity-capture-refresh-warnings');
      for (const warning of preview.warnings) warnings.createEl('p', { text: warning, cls: 'charity-hint' });
    }
    if (preview.blockers.length) {
      const blockers = this.fieldsEl.createDiv({ cls: 'charity-error charity-capture-refresh-blockers', attr: { role: 'alert' } });
      for (const blocker of preview.blockers) blockers.createEl('p', { text: blocker });
    }
    for (const field of preview.fields) {
      const row = this.fieldsEl.createDiv('charity-capture-refresh-field'); row.dataset.field = field.key;
      const label = row.createEl('label', { cls: 'charity-capture-refresh-choice' });
      const input = label.createEl('input', { type: 'checkbox' });
      const unavailable = !field.available || !field.changed || preview.completed || this.failed || !!preview.blockers.length;
      input.dataset.refreshDisabled = String(unavailable); input.disabled = this.busy || unavailable;
      input.checked = !unavailable && !!this.choices.get(field.key);
      input.setAttribute('aria-label', 'Update ' + field.label);
      label.createSpan({ text: field.label });
      input.onchange = () => { this.choices.set(field.key, input.checked); this.setBusy(this.busy); };
      const values = row.createDiv('charity-capture-refresh-values');
      for (const [heading, value, cls] of [['Current', field.current, 'current'], ['Captured', field.incoming, 'incoming']] as const) {
        const cell = values.createDiv('charity-capture-refresh-' + cls);
        cell.createSpan({ text: heading, cls: 'charity-capture-refresh-value-label' });
        cell.createEl('p', { text: heading === 'Captured' && !field.available ? 'Unavailable - existing information will be kept' : displayValue(value) });
      }
      if (field.available && !field.changed) row.createEl('p', { text: 'No change', cls: 'charity-hint' });
      if (field.key === 'coordinates' && field.available && field.changed && !preview.completed) row.createEl('p', { text: 'Pin changes are unchecked by default. Select only if you want to replace the saved location.', cls: 'charity-hint' });
    }
    const blocked = () => this.failed || !!this.preview?.blockers.length;
    if (preview.completed) this.action(this.actionsEl, 'Finish archiving', () => this.apply([]), true, blocked);
    else {
      this.action(this.actionsEl, 'Apply selected updates', () => this.apply(this.selectedFields()), true, () => blocked() || !this.selectedFields().length);
      this.action(this.actionsEl, 'Keep existing and archive capture', () => this.apply([]), false, blocked);
    }
    const cancel = this.actionsEl.createEl('button', { text: 'Cancel' });
    cancel.dataset.refreshCancel = 'true'; cancel.onclick = () => this.close();
    this.setBusy(this.busy);
  }
  private async apply(keys: CaptureRefreshField[]): Promise<void> {
    const previous = this.preview; if (!previous || this.failed || previous.blockers.length) return;
    const fresh = await this.plugin.store.previewCaptureRefresh(this.draft, this.targetPath);
    if (this.closed) return;
    if (fresh.fingerprint !== previous.fingerprint) {
      this.accept(fresh); this.status.setText('Source information changed. Review the refreshed comparison and choose the action again.'); this.status.removeClass('charity-error'); return;
    }
    try {
      const file = await this.plugin.store.applyCaptureRefresh(this.draft, fresh, keys);
      if (this.closed) return;
      this.close();
      if (keys.length) await this.plugin.openFile(file.path);
    } catch (error) {
      if (this.closed) return;
      try {
        const updated = await this.plugin.store.previewCaptureRefresh(this.draft, this.targetPath);
        if (this.closed) return;
        this.accept(updated);
        this.status.setText(updated.completed
          ? 'Source changes are saved, but archiving is unfinished: ' + errorText(error) + ' Choose Finish archiving to retry without applying the changes again.'
          : 'Not saved: ' + errorText(error) + ' Review the comparison before trying again.');
      } catch {
        this.failed = true; this.status.setText('Capture kept for review: ' + errorText(error) + ' Close and reopen Review captures to check its current state.');
      }
      this.status.addClass('charity-error'); this.render();
    }
  }
  close(): void { this.closed = true; super.close(); if (!this.busy) this.finish(); }
  private finish(): void { if (this.ended) return; this.ended = true; this.finishEditing?.(); this.done?.(); }
  onClose(): void { this.closed = true; this.contentEl.empty(); if (!this.busy) this.finish(); }
}
