import { Modal, Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { AttachmentPreview } from '../storage/attachment';
import { button, errorText, details, renderExamplesReference } from '../ui';

export class AttachNotebookModal extends Modal {
  private finishEditing?: () => void;
  private closed = false;
  constructor(private plugin: NotebookContext) { super(plugin.app); }
  onOpen(): void {
    if (this.plugin.kind === 'examples') { this.titleEl.setText('Examples reference'); renderExamplesReference(this.plugin, this.contentEl, 'Use existing notebook attaches your real notebook on another device. Practice attaching is described in Reference.'); return; }
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.titleEl.setText('Use existing notebook'); this.modalEl.addClass('charity-attach-modal');
    const el = this.contentEl;
    let root = this.plugin.settings.root, preview: AttachmentPreview | undefined, generation = 0, attaching = false, rootInput: HTMLInputElement;
    el.createEl('p', { text: 'Choose the sourcing notebook already in this vault. Finish syncing it before connecting this device. Attachment changes only local plugin settings.', cls: 'charity-hint' });
    const options = el.createEl('datalist', { attr: { id: 'sourcing-existing-' + crypto.randomUUID() } });
    for (const file of this.plugin.app.vault.getMarkdownFiles().filter(f => f.basename === 'Home' && f.path.includes('/'))) options.createEl('option', { value: file.path.slice(0, -'/Home.md'.length) });
    const results = el.createDiv(), footer = el.createDiv('charity-modal-footer');
    const status = footer.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    const attach = footer.createEl('button', { text: 'Use this notebook', cls: 'mod-cta' }); attach.disabled = true;
    const field = new Setting(el).setName('Notebook folder in this vault').addText(t => {
      rootInput = t.inputEl; rootInput.setAttribute('aria-label', 'Existing notebook folder'); rootInput.setAttribute('list', options.id);
      t.setValue(root).onChange(value => { if (attaching) return; generation++; root = value; preview = undefined; results.empty(); attach.disabled = true; status.empty(); });
    });
    el.insertBefore(field.settingEl, results);
    const inspect = button(el, 'Preview existing notebook', async () => {
      const token = ++generation, requestedRoot = root;
      results.empty(); preview = undefined; attach.disabled = true; status.setText('Inspecting...');
      try {
        const proposed = await this.plugin.store.inspectExistingNotebook(requestedRoot);
        if (this.closed || token !== generation || root !== requestedRoot) return;
        preview = proposed;
        results.createEl('p', { text: proposed.counts.sources + ' sources, ' + proposed.counts.parking + ' parking places, ' + proposed.counts.areas + ' areas and ' + proposed.counts.pendingCaptures + ' pending captures.' });
        results.createEl('p', { text: proposed.identical.length + ' unchanged components recognised; ' + proposed.modified.length + ' customised or older components and ' + proposed.missing.length + ' missing components will be left as they are.' });
        for (const warning of proposed.warnings) results.createEl('p', { text: warning, cls: 'charity-hint' });
        for (const problem of proposed.blockers) results.createEl('p', { text: problem, cls: 'charity-error' });
        if (proposed.modified.length || proposed.missing.length) {
          const list = details(results, 'Components kept without repair');
          for (const path of [...proposed.modified, ...proposed.missing]) list.createEl('p', { text: path });
        }
        attach.disabled = !proposed.recognized || proposed.blockers.length > 0;
        status.setText(attach.disabled ? 'Resolve the problems above before attaching.' : 'Ready to use ' + proposed.root + '. No notebook files will be changed.');
      } catch (error) { if (!this.closed && token === generation && root === requestedRoot) status.setText('Could not inspect: ' + errorText(error)); }
    });
    el.insertBefore(inspect, results);
    attach.onclick = async () => {
      if (!preview || attaching) return;
      const confirmed = preview; attaching = true; attach.disabled = true; rootInput.disabled = true; inspect.disabled = true;
      this.finishEditing?.(); this.finishEditing = undefined; status.setText('Connecting...');
      try {
        await this.plugin.runRootOperation(() => this.plugin.store.attachExistingNotebook(confirmed.root, confirmed.fingerprint));
        if (!this.closed) { this.close(); await this.plugin.home(); }
      } catch (error) {
        if (!this.closed) {
          this.finishEditing = this.plugin.beginEditing(); preview = undefined;
          status.setText('Not connected: ' + errorText(error) + ' Preview again before retrying.');
        }
      } finally {
        if (!this.closed) { attaching = false; rootInput.disabled = false; inspect.disabled = false; attach.disabled = !preview; }
      }
    };
  }
  onClose(): void { this.closed = true; this.finishEditing?.(); this.finishEditing = undefined; this.contentEl.empty(); }
}
