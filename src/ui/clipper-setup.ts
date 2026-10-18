import { Modal, Notice, Platform, Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { ClipperStatus, ClipperTemplateStatus } from '../storage/store';
import { CHROME_CLIPPER_SETTINGS_URL } from '../platform/clipper-browser';
import { copyTextOrShow, showSelectableText } from '../platform/clipboard';
import { button, errorText, external, renderExamplesReference } from '../ui';

/** The browser owns its templates; this guide records only the user's confirmation. */
export class ClipperSetupModal extends Modal {
  private finishEditing?: () => void;
  private closed = false;
  private importChoices = new Set<string>();
  constructor(private plugin: NotebookContext) { super(plugin.app); }
  onOpen(): void {
    if (this.plugin.kind === 'examples') { this.titleEl.setText('Examples reference'); renderExamplesReference(this.plugin, this.contentEl, 'Review the prepared practice captures here. Real browser-template import instructions are available in Reference.'); return; }
    if (Platform.isMobileApp) { this.renderMobileHelp(); return; }
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.modalEl.addClass('charity-clipper-modal');
    this.titleEl.setText('Set up / update Web Clipper');
    this.contentEl.createEl('p', { text: 'Preparing capture templates...', attr: { role: 'status' } });
    void this.prepare();
  }
  private renderMobileHelp(): void {
    this.titleEl.setText('Desktop capture'); this.modalEl.addClass('charity-mobile-capture-help');
    this.contentEl.createEl('p', { text: 'Browser clipping is configured on desktop in this version. Sync the completed source notes to use them on Android. You can create sources and parking, add visits and plan outings here.' });
    this.contentEl.createEl('p', { text: 'No Android browser extraction or import confirmation is required.', cls: 'charity-hint' });
    const path = this.plugin.store.paths.templates + '/Web Clipper';
    const field = this.contentEl.createEl('textarea', { attr: { readonly: 'true', 'aria-label': 'Templates folder in this vault' } });
    field.value = path; field.rows = 2; field.style.width = '100%';
    button(this.contentEl, 'Copy template folder path', () => copyTextOrShow(this.plugin.app, path, 'Templates folder in this vault'));
    button(this.contentEl, 'Show selectable path', () => showSelectableText(this.plugin.app, path, 'Templates folder in this vault'));
  }
  private async prepare(): Promise<void> {
    try {
      await this.plugin.store.refreshClipperTemplates();
      const status = await this.plugin.store.getClipperStatus();
      if (!this.closed) this.render(status);
    } catch (error) {
      if (this.closed) return;
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: 'Could not prepare templates: ' + errorText(error), cls: 'charity-error', attr: { role: 'alert' } });
      button(this.contentEl, 'Try again', () => this.prepare(), true);
    }
  }
  private render(status: ClipperStatus): void {
    const el = this.contentEl; el.empty();
    el.createEl('p', { text: 'Optional browser capture for ' + this.plugin.store.root + '. Available template release: v' + status.release + '.', cls: 'charity-hint' });
    el.createEl('p', { text: 'Copy JSON or use the template files, import them in Web Clipper, then confirm each version below.' });
    if (status.templates.some(t => t.exportState === 'edited')) el.createEl('p', { text: 'Some exported JSON files have edits and were preserved. Use Copy JSON below for the current supplied templates.', cls: 'charity-hint' });
    external(this.plugin, el, 'Install Obsidian Web Clipper', 'https://obsidian.md/clipper');
    if (Platform.isDesktopApp && Platform.isWin) {
      const launch = el.createDiv('charity-actions');
      const result = el.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
      button(launch, 'Open Chrome settings and template folder', async () => {
        try {
          const requested = await this.plugin.openClipperImportTools();
          result.setText(requested
            ? 'Chrome was asked to open Web Clipper Templates. Select a template and choose Import. If the page is unavailable, switch to the Chrome profile with Clipper installed or use the cog-menu steps below.'
            : 'The template folder is available. Chrome settings could not be opened automatically. Open Web Clipper settings from your browser using the steps below.');
        } catch (error) { result.setText('Could not open the import tools: ' + errorText(error) + '. Use the steps below.'); result.addClass('charity-error'); }
      }, true);
      launch.createEl('p', { text: 'Uses your ordinary Chrome profile. Install Web Clipper in that profile first.', cls: 'charity-hint' });
    }
    for (const template of status.templates) this.renderTemplate(el, template);
    const instructions = el.createEl('details', { cls: 'charity-details' });
    instructions.createEl('summary', { text: 'Import steps and older versions' });
    instructions.createEl('p', { text: 'Obsidian cannot replace browser templates or check which versions the browser has.' });
    const steps = instructions.createEl('ol');
    steps.createEl('li', { text: 'Copy Source JSON or Parking JSON below.' });
    steps.createEl('li', { text: 'In Web Clipper, open the Settings cog, select any template, choose Import, paste the JSON and choose Import again.' });
    steps.createEl('li', { text: 'Check that the imported name matches the version below. Test it on a place listing, then delete older copies or move them below the new version.' });
    instructions.createEl('p', { text: 'Import creates another template. The first matching template in Clipper is used. Templates without a visible version are older than these exports.', cls: 'charity-hint' });
    const more = el.createEl('details', { cls: 'charity-details' });
    more.createEl('summary', { text: 'Import JSON files instead' });
    more.createEl('p', { text: 'In the same Import dialog, select or drop Capture source.json and Capture parking.json. You can select both files together. Use template Import, not Import all settings.' });
    const changed = status.templates.filter(t => t.exportState !== 'current');
    if (changed.length) more.createEl('p', { text: 'Some exported files have edits and were kept. Use Copy JSON above for the current supplied templates.', cls: 'charity-hint' });
    button(more, 'Show template files', () => this.plugin.revealTemplates());
    if (Platform.isDesktopApp && Platform.isWin) button(more, 'Copy Chrome settings address', async () => { if (await copyTextOrShow(this.plugin.app, CHROME_CLIPPER_SETTINGS_URL, 'Chrome settings address')) new Notice('Chrome settings address copied. Paste it into Chrome.'); });
    external(this.plugin, more, 'Web Clipper import help', 'https://obsidian.md/help/web-clipper/templates');
    const footer = el.createDiv('charity-modal-footer');
    footer.createEl('p', { text: 'Confirmations apply to these exact templates and destination.', cls: 'charity-hint' });
    button(footer, 'Done', () => this.close());
  }
  private renderTemplate(parent: HTMLElement, template: ClipperTemplateStatus): void {
    const label = template.kind === 'shop' ? 'Source' : 'Parking';
    const section = parent.createDiv('charity-clipper-template');
    section.setAttribute('data-template-kind', template.kind);
    section.createEl('h3', { text: template.name });
    section.createEl('p', {
      text: template.confirmedAt
        ? 'You confirmed this version was imported on ' + new Date(template.confirmedAt).toLocaleDateString() + '.'
        : 'Import not yet confirmed for this version and destination.',
      cls: 'charity-hint',
    });
    if (template.exportState === 'edited') section.createEl('p', { text: 'Your exported JSON has edits and was preserved. Copy JSON provides the current supplied template.', cls: 'charity-hint' });
    const actions = section.createDiv('charity-actions');
    const status = section.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    button(actions, 'Copy ' + label + ' JSON', async () => {
      try { const copied = await copyTextOrShow(this.plugin.app, template.json, label + ' template JSON'); status.setText(copied ? label + ' JSON copied. Paste it into the template Import dialog in Web Clipper.' : 'Select and copy the JSON in the opened dialog.'); }
      catch { status.setText('Could not copy. Use Show template files and import the JSON file instead.'); status.addClass('charity-error'); }
    }, !template.confirmedAt && !(Platform.isDesktopApp && Platform.isWin));
    if (template.exportState === 'current') button(actions, 'Show ' + label + ' file', () => this.plugin.revealTemplates(template.kind));
    if (!template.confirmedAt) {
      let confirm: HTMLButtonElement;
      new Setting(section).setName('I imported ' + template.name).addToggle(toggle => {
        toggle.toggleEl.setAttribute('aria-label', 'I imported ' + label);
        toggle.setValue(this.importChoices.has(template.fingerprint)).onChange(value => {
          if (value) this.importChoices.add(template.fingerprint); else this.importChoices.delete(template.fingerprint);
          confirm.disabled = !value;
        });
      });
      confirm = button(section, 'Save ' + label + ' confirmation', async () => {
        try {
          await this.plugin.store.confirmClipperImport(template.kind, template.fingerprint);
          this.importChoices.delete(template.fingerprint);
          this.plugin.notifyClipperStatusChanged();
          if (!this.closed) this.render(await this.plugin.store.getClipperStatus());
        } catch (error) { status.setText('Confirmation not saved: ' + errorText(error)); status.addClass('charity-error'); }
      });
      confirm.disabled = !this.importChoices.has(template.fingerprint);
    }
  }
  onClose(): void { this.closed = true; this.finishEditing?.(); this.contentEl.empty(); }
}

export async function showClipperUpdateNotice(plugin: NotebookContext): Promise<void> {
  if (plugin.kind === 'examples' || Platform.isMobileApp) return;
  const status = await plugin.store.getClipperStatus();
  const pending = status.templates.some(t => !t.confirmedAt);
  if (!pending || plugin.settings.clipperNoticeFingerprint === status.fingerprint) return;
  const fragment = document.createDocumentFragment();
  fragment.createEl('span', { text: 'Web Clipper templates v' + status.release + ' are ready. Import or update them for this notebook. ' });
  const open = fragment.createEl('button', { text: 'Open import guide' });
  open.onclick = () => { notice.hide(); plugin.openClipperSetup(); };
  const notice = new Notice(fragment, 15000);
  await plugin.store.markClipperNoticeSeen(status.fingerprint);
}
