import { Notice, Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import { button, details } from '../ui';
import { mountPlaceMap } from '../map';
import { PreparationModal } from '../workspace/preparation-modal';
import type { PreparationDraft } from '../workspace/types';
import { placeEditPatch, rebasePlaceEdit, type PlaceEditPreparation, type PlaceEditSection, type PlaceEditValues } from './model';

export interface PlaceEditorOptions {
  section?: PlaceEditSection;
  afterSave?: (path: string) => Promise<void> | void;
  changeArea?: () => Promise<void> | void;
  manageParking?: () => Promise<void> | void;
}
type TextField = Exclude<keyof PlaceEditValues, 'rating' | 'shortlist' | 'closed'>;
export class PlaceEditorModal extends PreparationModal<PlaceEditPreparation> {
  private firstRender = true;
  constructor(context: NotebookContext, seed: PlaceEditPreparation, draftId?: string, private options: PlaceEditorOptions = {}) { super(context, 'place-edit', seed, draftId); }
  protected meaningful(): boolean { return JSON.stringify(this.draft.data.values) !== JSON.stringify(this.draft.data.snapshot.values); }
  protected override footer(): HTMLElement {
    const footer = super.footer();
    if (this.draft.phase === 'editing') footer.prepend(button(footer, 'Save place', () => this.finish(), true));
    return footer;
  }
  renderStep(): void {
    const d = this.draft.data, v = d.values, el = this.contentEl.createDiv('charity-place-edit-fields');
    if (this.firstRender && this.options.section) d.section = this.options.section; this.firstRender = false;
    this.modalEl.addClass('charity-place-editor'); this.titleEl.setText('Edit place');
    el.createEl('p', { text: d.snapshot.name, cls: 'charity-hint' });
    const group = (label: string, section: PlaceEditSection) => { const node = details(el, label); node.open = d.section === section; node.addEventListener('toggle', () => { if (node.open && d.section !== section) { d.section = section; this.changed(); } }); return node; };
    const field = (parent: HTMLElement, label: string, key: TextField, multiline = false, description = '') => {
      const setting = new Setting(parent).setName(label); if (description) setting.setDesc(description);
      const configure = (control: { inputEl: HTMLInputElement | HTMLTextAreaElement; setValue(value: string): unknown; onChange(callback: (value: string) => void): unknown }) => {
        control.setValue(v[key]); control.inputEl.dataset.editField = key; control.inputEl.setAttribute('aria-label', label);
        control.onChange(value => { v[key] = value; this.changed(); });
        if (control.inputEl.instanceOf(HTMLTextAreaElement)) control.inputEl.rows = key === 'openingNotes' ? 4 : 3;
        if (key === 'website') control.inputEl.setAttribute('type', 'url'); if (key === 'telephone') control.inputEl.setAttribute('type', 'tel');
      };
      if (multiline) setting.addTextArea(configure); else setting.addText(configure);
    };
    const basics = group('Name and type', 'basics');
    field(basics, 'Display name', 'displayName', false, 'Your optional name for this place. Leave blank to use its Google name or filename.');
    if (d.snapshot.kind === 'shop') {
      field(basics, 'Source type', 'sourceType', false, 'For example Charity shop, Rag house or another type.');
      field(basics, 'Brand / name tag', 'brandTag', false, 'Brand only, without the town. Other tags are preserved.');
      new Setting(basics).setName('Permanently closed').addToggle(t => t.setValue(v.closed).onChange(value => { v.closed = value; this.changed(); }));
    }
    const location = group('Location', 'location');
    field(location, 'Address', 'address'); field(location, 'Coordinates', 'coordinatesText', false, 'Latitude, longitude. Leave blank when unknown.');
    field(location, 'Google Maps link', 'mapsUrl', false, 'Changing the listing does not move the pin or change captured review details.');
    const picker = details(location, 'Pick a location on the map'); let mounted = false;
    picker.addEventListener('toggle', () => { if (!picker.open || mounted || this.closed) return; mounted = true;
      void this.context.store.listPlaces().then(records => {
        if (this.closed) return;
        mountPlaceMap(this.owner, picker, this.context.mapHost, { records, focusPath: d.snapshot.path, onPick: coordinates => {
          v.coordinatesText = coordinates.join(', '); const input = location.querySelector('input[data-edit-field="coordinatesText"]'); if (input?.instanceOf(HTMLInputElement)) input.value = v.coordinatesText; this.changed();
        } });
      }).catch(error => this.failure(error));
    });
    if (this.options.changeArea) button(location, 'Change area', () => this.closeAndContinue(() => this.options.changeArea?.()));
    const contacts = group('Contact details', 'contacts'); field(contacts, 'Website', 'website'); field(contacts, 'Telephone', 'telephone');
    const opening = group('Opening information', 'opening');
    field(opening, 'Your opening notes', 'openingNotes', true, 'Personal information, separate from the captured Google hours. These notes are not interpreted by the journey planner.');
    if (d.snapshot.kind === 'shop') {
      const assessment = group('Sourcing assessment', 'assessment');
      new Setting(assessment).setName('Sourcing rating').addDropdown(dropdown => { for (let score = 0; score <= 5; score += .5) dropdown.addOption(String(score), score ? String(score) : '0 — Not rated'); dropdown.setValue(String(v.rating)).onChange(value => { v.rating = Number(value); this.changed(); }); });
      field(assessment, 'Takeaway', 'comments', true);
      new Setting(assessment).setName('Shortlist').addToggle(toggle => toggle.setValue(v.shortlist).onChange(value => { v.shortlist = value; this.changed(); }));
    }
    const parking = group('Parking details', 'parking');
    if (d.snapshot.kind === 'shop') {
      new Setting(parking).setName('Parking on site').addDropdown(dropdown => { dropdown.addOption('unknown', 'Unknown').addOption('yes', 'Available on site').addOption('no', 'None on site'); dropdown.setValue(v.parkingOnSite).onChange(value => { v.parkingOnSite = value; this.changed(); }); });
      field(parking, 'On-site cost', 'onSiteCost'); field(parking, 'Typical on-site availability', 'onSiteAvailability');
    } else { field(parking, 'Cost', 'parkingCost'); field(parking, 'Typical availability', 'parkingAvailability'); }
    if (this.options.manageParking) button(parking, 'Manage linked parking', () => this.closeAndContinue(() => this.options.manageParking?.()));
    el.createEl('p', { text: 'Close keeps your draft. Save place updates this place. Filenames, visits and captured Google snapshots are preserved.', cls: 'charity-hint' });
    const focus = el.querySelector(d.section === 'location' ? '[data-edit-field="coordinatesText"]' : '[data-edit-field="displayName"]');
    if (focus?.instanceOf(HTMLElement)) this.contentEl.win.setTimeout(() => { if (!this.closed) focus.focus(); }, 0);
  }
  protected async finish(): Promise<void> {
    if (this.busy) return; this.setBusy(true);
    try {
      const d = this.draft.data;
      placeEditPatch(d.snapshot, d.values);
      if (!this.meaningful() && !this.draft.revision) { this.setBusy(false); this.close(); return; }
      await this.flush();
      if (this.draft.phase === 'editing') await this.context.store.validatePlaceEdit(d.snapshot, d.values);
      await this.completing();
      await this.context.store.savePlaceEdit(d.snapshot, d.values, this.draft.id, this.draft.revision);
      this.draft = await this.context.store.preparations.transition(this.draft.id, this.draft.revision, 'complete', d.snapshot.path) as PreparationDraft<PlaceEditPreparation>;
      this.setBusy(false); this.close(); new Notice('Place saved'); await this.options.afterSave?.(d.snapshot.path);
    } catch (error) {
      if (this.draft.phase === 'completing') {
        try { this.draft = await this.context.store.preparations.reopenPlaceEdit(this.draft.id, this.draft.revision); }
        catch { /* A committed receipt keeps the edit locked until explicit completion. */ }
        await this.render();
      }
      this.setBusy(false); this.failure(error);
    }
  }
  protected override failure(error: unknown): void {
    super.failure(error);
    if (!this.draft || this.draft.phase !== 'editing' || !this.draft.revision) return;
    const fields = this.contentEl.querySelector('.charity-place-edit-fields'); if (!fields?.instanceOf(HTMLElement)) return;
    const copy = this.contentEl.querySelector('.charity-draft-copy')?.parentElement; if (copy && copy.parentElement === this.contentEl) fields.appendChild(copy);
    if (!fields.querySelector('.charity-place-review-action')) button(fields, 'Review current values', () => this.reviewCurrentValues()).addClass('charity-place-review-action');
  }
  private async reviewCurrentValues(): Promise<void> {
    try {
      await this.flush();
      const data = this.draft.data, before = structuredClone(data), signature = JSON.stringify(data);
      const review = await this.context.store.reviewPlaceEdit(before.snapshot, before.values, this.draft.id);
      const fields = this.contentEl.querySelector('.charity-place-edit-fields'); if (!fields?.instanceOf(HTMLElement) || this.closed) return;
      fields.querySelector('.charity-place-edit-comparison')?.remove();
      const section = details(fields, 'Review current values'); section.addClass('charity-place-edit-comparison'); section.open = true;
      section.createEl('p', { text: 'Choose which conflicting values to keep. This updates your draft; Save place remains a separate action.' });
      const keep = new Set<keyof PlaceEditValues>();
      const display = (value: string | number | boolean) => typeof value === 'boolean' ? value ? 'Yes' : 'No' : value === '' ? 'Blank' : String(value);
      for (const row of review.rows) {
        const item = section.createDiv('charity-place-edit-comparison-row'); item.createEl('h3', { text: row.label });
        item.createEl('p', { text: 'Current: ' + display(row.current), cls: 'charity-hint' });
        item.createEl('p', { text: 'Your edit: ' + display(row.entered) });
        if (row.conflict) new Setting(item).setName('Resolve conflict').addDropdown(control => control.addOption('current', 'Use current').addOption('mine', 'Keep my edit').setValue('current').onChange(value => { if (value === 'mine') keep.add(row.field); else keep.delete(row.field); }));
        else item.createEl('p', { text: 'Not changed elsewhere. Your edit will be kept.', cls: 'charity-hint' });
      }
      button(section, 'Update draft with these choices', async () => {
        if (this.draft.phase !== 'editing') throw Error('Reopen this saved edit before updating its draft.');
        if (JSON.stringify(this.draft.data) !== signature) throw Error('Your entered details changed during the comparison. Review current values again before updating the draft.');
        const rebased = rebasePlaceEdit(before.snapshot, before.values, review.current, [...keep]);
        data.snapshot = rebased.snapshot; data.values = rebased.values;
        this.changed(); await this.flush(); await this.render(); new Notice('Draft updated. Save the place when ready.');
      }, true);
      section.scrollIntoView({ block: 'nearest' });
    } catch (error) { this.failure(error); }
  }
}
export async function openPlaceEditor(context: NotebookContext, path: string, options: PlaceEditorOptions = {}): Promise<void> {
  const existing = (await context.store.preparations.inspect()).drafts.find((draft): draft is PreparationDraft<PlaceEditPreparation> => draft.kind === 'place-edit' && draft.data.snapshot.path === path);
  if (existing) { const seed = structuredClone(existing.data); if (options.section) seed.section = options.section; new PlaceEditorModal(context, seed, existing.id, options).open(); return; }
  const snapshot = await context.store.placeEditSnapshot(path);
  new PlaceEditorModal(context, { snapshot, values: structuredClone(snapshot.values), section: options.section ?? 'basics' }, undefined, options).open();
}
export async function resumePlaceEditor(context: NotebookContext, draftId: string, options: PlaceEditorOptions = {}): Promise<void> {
  const draft = await context.store.preparations.get(draftId);
  if (!draft || draft.kind !== 'place-edit') throw Error('This place edit draft is no longer available.');
  new PlaceEditorModal(context, draft.data, draft.id, options).open();
}
