import { App, Modal, Setting } from 'obsidian';

export class SelectableTextModal extends Modal {
  constructor(app: App, private heading: string, private value: string) { super(app); }
  onOpen(): void {
    this.modalEl.addClass('charity-copy-modal'); this.titleEl.setText(this.heading);
    this.contentEl.createEl('p', { text: 'Select and copy this text using your device controls.', cls: 'charity-hint' });
    const text = this.contentEl.createEl('textarea', { attr: { 'aria-label': this.heading, readonly: 'true', spellcheck: 'false' } });
    text.value = this.value; text.rows = Math.min(14, Math.max(3, this.value.split('\n').length));
    text.style.width = '100%'; text.style.userSelect = 'text';
    new Setting(this.contentEl).addButton(b => b.setButtonText('Select text').onClick(() => { text.focus(); text.select(); }));
  }
  onClose(): void { this.contentEl.empty(); }
}
export function showSelectableText(app: App, value: string, heading = 'Copy text'): void {
  new SelectableTextModal(app, heading, value).open();
}
export async function copyTextOrShow(app: App, value: string, heading = 'Copy text', canShowFallback: () => boolean = () => true): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value); return true;
  } catch { if (canShowFallback()) showSelectableText(app, value, heading); return false; }
}
