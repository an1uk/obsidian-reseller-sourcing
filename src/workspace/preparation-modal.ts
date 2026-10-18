import { Component, Modal, Notice } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { PreparationDraft } from './types';
import { button, details, errorText } from '../ui';
import { markInputModal } from '../ui/modal-layout';

/** A close flushes the same draft used by background saves; completion is explicit. */
export abstract class PreparationModal<T> extends Modal {
  protected draft!: PreparationDraft<T>;
  protected owner = new Component();
  protected closed = false;
  protected busy = false;
  protected status?: HTMLElement;
  private timer?: number;
  private queue = Promise.resolve();
  private signature = '';
  private finishEditing?: () => void;
  private background = () => { if (this.contentEl.ownerDocument.hidden) void this.flush().catch(e => this.failure(e)); };
  constructor(protected context: NotebookContext, private kind: 'place' | 'outing', private seed: T, private draftId?: string) { super(context.app); }
  abstract renderStep(): Promise<void> | void;
  protected abstract meaningful(): boolean;
  protected abstract finish(): Promise<void>;
  protected setBusy(value: boolean): void {
    this.busy = value;
    this.contentEl.inert = value;
    this.modalEl.setAttribute('aria-busy', String(value));
    if (value) this.status?.setText('Saving…');
  }
  onOpen(): void {
    markInputModal(this);
    this.finishEditing = this.context.beginEditing(); if (!this.finishEditing) { super.close(); return; }
    this.modalEl.addClass('charity-preparation-modal'); this.owner.load();
    this.contentEl.ownerDocument.addEventListener('visibilitychange', this.background);
    void (async () => {
      const saved = this.draftId ? await this.context.store.preparations.get(this.draftId) : undefined;
      if (this.closed) return;
      if (this.draftId && !saved) throw Error('This preparation was removed. Start a new one if wanted.');
      if (saved && (saved.kind !== this.kind || !['editing', 'completing'].includes(saved.phase))) throw Error('This preparation has already closed.');
      this.draft = saved as PreparationDraft<T> ?? { schema: 1, id: crypto.randomUUID(), kind: this.kind, root: this.context.root, updatedAt: new Date().toISOString(), deferred: false, phase: 'editing', data: this.seed, revision: '' };
      this.signature = saved ? JSON.stringify(this.draft.data) : '';
      await this.render();
    })().catch(e => this.failure(e));
  }
  protected async render(): Promise<void> {
    if (this.closed) return;
    this.owner.unload(); this.owner = new Component(); this.owner.load(); this.contentEl.empty();
    if (this.context.kind === 'examples') this.contentEl.createEl('p', { text: 'Practice notebook · fictional places', cls: 'charity-practice-label' });
    if (this.draft.phase === 'completing') {
      this.contentEl.createEl('p', { text: 'The saved preparation is ready to finish. Retrying will reuse the same record.' });
      button(this.contentEl, 'Finish saved preparation', () => this.finish(), true);
      this.footer(); return;
    }
    await this.renderStep(); if (!this.closed) this.footer();
  }
  protected footer(): HTMLElement {
    const footer = this.contentEl.createDiv('charity-modal-footer charity-actions');
    this.status = footer.createDiv({ cls: 'charity-save-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.status.setText(this.draft.revision && JSON.stringify(this.draft.data) === this.signature ? 'Draft saved' : this.meaningful() ? 'Saving draft…' : '');
    button(footer, 'Close', () => this.close());
    if (this.draft.phase === 'editing') button(details(footer, 'More'), 'Discard draft', async () => {
      await this.flush(); if (this.draft.revision) await this.context.store.preparations.transition(this.draft.id, this.draft.revision, 'discarded');
      this.draft.phase = 'discarded'; this.close();
    }).addClass('mod-warning');
    return footer;
  }
  protected changed(): void {
    if (this.busy || this.closed || !this.draft || this.draft.phase !== 'editing') return;
    this.draft.deferred = false; this.contentEl.win.clearTimeout(this.timer); this.status?.setText('Saving draft…');
    this.timer = this.contentEl.win.setTimeout(() => void this.flush().catch(e => this.failure(e)), 500);
  }
  protected flush(): Promise<void> {
    this.contentEl.win.clearTimeout(this.timer);
    if (!this.draft || this.draft.phase !== 'editing' || !this.meaningful()) return this.queue;
    const data = structuredClone(this.draft.data), signature = JSON.stringify(data);
    const run = async () => {
      if (signature === this.signature) return;
      const saved = await this.context.store.preparations.save({ ...this.draft, data }, this.draft.revision);
      this.draft.revision = saved.revision; this.draft.updatedAt = saved.updatedAt; this.signature = signature;
      if (!this.closed) { this.status?.setText(JSON.stringify(this.draft.data) === this.signature ? 'Draft saved' : 'Saving draft…'); this.status?.removeClass('charity-error'); }
    };
    this.queue = this.queue.then(run, run); return this.queue;
  }
  protected async completing(): Promise<void> {
    if (this.draft.phase === 'completing') return;
    await this.flush();
    if (!this.draft.revision) throw Error('Add some details first.');
    this.draft = await this.context.store.preparations.transition(this.draft.id, this.draft.revision, 'completing') as PreparationDraft<T>;
  }
  protected async completed(path: string): Promise<void> {
    this.draft = await this.context.store.preparations.transition(this.draft.id, this.draft.revision, 'complete', path) as PreparationDraft<T>;
    this.setBusy(false); this.close(); await this.context.openFile(path);
  }
  protected failure(error: unknown): void {
    if (this.closed) { new Notice('Draft needs review: ' + errorText(error)); return; }
    this.status ??= this.contentEl.createDiv({ attr: { role: 'status' } });
    this.status.setText(errorText(error)); this.status.addClass('charity-error');
    if (/changed|removed|another|closed/.test(errorText(error)) && !this.contentEl.querySelector('.charity-draft-copy')) {
      const section = details(this.contentEl, 'Keep a copy of these entered details');
      const copy = section.createEl('textarea', { cls: 'charity-draft-copy', attr: { 'aria-label': 'Entered preparation details' } });
      copy.readOnly = true; copy.value = JSON.stringify(this.draft?.data ?? this.seed, null, 2);
      button(section, 'Close without replacing saved work', () => { this.closed = true; super.close(); });
    }
  }
  close(): void {
    if (this.closed || this.busy) return;
    this.setBusy(true);
    void this.flush().then(() => { this.closed = true; super.close(); }).catch(e => this.failure(e)).finally(() => this.setBusy(false));
  }
  onClose(): void {
    this.closed = true; this.contentEl.win.clearTimeout(this.timer); this.owner.unload();
    this.contentEl.ownerDocument.removeEventListener('visibilitychange', this.background);
    void this.flush().catch(e => this.failure(e)).finally(() => { this.finishEditing?.(); this.finishEditing = undefined; });
  }
}
