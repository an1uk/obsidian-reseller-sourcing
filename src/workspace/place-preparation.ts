import { Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { CaptureDraft } from '../types';
import type { PlacePreparation } from './types';
import { PreparationModal } from './preparation-modal';
import { AreaEditor } from '../ui/area-controls';
import { button, details, PickModal } from '../ui';
import { parseGooglePlaceUrl, safeFileName, validateCoordinates } from '../domain';
import { mountPlaceMap } from '../map';

export class PlacePreparationModal extends PreparationModal<PlacePreparation> {
  private area?: AreaEditor;
  private coordinatesText = '';
  constructor(context: NotebookContext, capture: CaptureDraft, linkedSource?: string, draftId?: string) {
    super(context, 'place', { capture: { ...capture, sourceType: capture.sourceType || context.settings.defaultSourceType }, area: { town: '', locality: '' }, step: 1, filename: '', ...(linkedSource ? { linkedSource } : {}) }, draftId);
  }
  protected meaningful() { const d = this.draft.data; return !!(d.capture.name.trim() || d.capture.address || d.capture.url || d.area.town || d.capture.coordinates); }
  async renderStep() {
    const d = this.draft.data, c = d.capture, el = this.contentEl;
    this.titleEl.setText(c.kind === 'parking' ? 'Add parking' : 'Add a place');
    el.createEl('p', { text: d.step === 1 ? '1. Name the place' : '2. Location and details (optional)', cls: 'charity-hint' });
    if (d.step === 1) {
      new Setting(el).setName('Name').addText(t => { t.inputEl.setAttribute('aria-label', 'Place name'); t.setValue(c.name).onChange(v => { c.name = v; this.changed(); }); });
      if (c.kind === 'shop') {
        button(el, 'Type: ' + c.sourceType, () => new PickModal(this.context, [...new Set([...this.context.settings.sourceTypes, c.sourceType!, this.context.settings.defaultSourceType])], s => s, s => { c.sourceType = s; this.changed(); return this.render(); }, 'Choose source type').open());
        if (c.sourceType !== this.context.settings.defaultSourceType) new Setting(el).setName('Use as my default').addToggle(t => t.setValue(d.makeDefaultSourceType ?? false).onChange(v => { d.makeDefaultSourceType = v; this.changed(); }));
      }
      button(el, 'Add location or details', async () => { d.step = 2; this.changed(); await this.flush(); await this.render(); });
    } else {
      button(el, 'Back', async () => { d.step = 1; this.changed(); await this.flush(); await this.render(); });
      const areas = await this.context.store.listLocalities(); if (this.closed) return;
      this.area = new AreaEditor(this.context, areas, d.area, () => { d.area = this.area!.value; this.changed(); }, c.address);
      this.area.mount(el);
      el.querySelector('.charity-area-editor .setting-item-name')?.setText('Town / parent area — optional');
      el.querySelector('.charity-area-editor .setting-item-description')?.setText('Optional. Leave blank to organise this place later.');
      d.area = this.area.value;
      new Setting(el).setName('Google Maps link').addText(t => t.setValue(c.url).onChange(v => { c.url = v; const pin = parseGooglePlaceUrl(v); if (pin.coordinates && !c.coordinates && !d.coordinatesText?.trim()) { c.coordinates = pin.coordinates; d.coordinatesText = this.coordinatesText = c.coordinates.join(', '); } this.changed(); }));
      new Setting(el).setName('Address').addText(t => t.setValue(c.address).onChange(v => { c.address = v; this.changed(); }));
      this.coordinatesText = d.coordinatesText ?? c.coordinates?.join(', ') ?? '';
      new Setting(el).setName('Coordinates').addText(t => t.setValue(this.coordinatesText).setPlaceholder('Latitude, longitude').onChange(v => {
        d.coordinatesText = this.coordinatesText = v; c.coordinates = v.trim() && v.split(',').every(s => s.trim()) ? validateCoordinates(v.split(',').map(Number)) : null; this.changed();
      }));
      const map = details(el, 'Pick a location on the map');
      let mounted = false; map.addEventListener('toggle', () => { if (map.open && !mounted && !this.closed) { mounted = true; mountPlaceMap(this.owner, map, this.context.mapHost, { records: [], onPick: coords => { c.coordinates = coords; d.coordinatesText = this.coordinatesText = coords.join(', '); this.changed(); void this.render(); } }); } });
      const contacts = details(el, 'Contact details'); contacts.open = !!(c.website || c.telephone);
      new Setting(contacts).setName('Website').addText(t => { t.inputEl.type = 'url'; t.setValue(c.website ?? '').onChange(v => { c.website = v; this.changed(); }); });
      new Setting(contacts).setName('Telephone').addText(t => { t.inputEl.type = 'tel'; t.setValue(c.telephone ?? '').onChange(v => { c.telephone = v; this.changed(); }); });
    }
    button(el, 'Save place', () => this.finish(), true);
  }
  protected async finish() {
    if (this.busy) return; this.setBusy(true);
    try {
      const d = this.draft.data;
      if (!d.capture.name.trim()) throw Error('Add the place name.');
      if ((d.coordinatesText ?? this.coordinatesText).trim() && !d.capture.coordinates) throw Error('Use a valid latitude, longitude pair or leave coordinates blank.');
      if (d.area.town && this.area) d.area = this.area.confirmedValue();
      if (this.draft.phase === 'editing') { d.filename = safeFileName((d.capture.kind === 'parking' ? 'Parking - ' : '') + d.capture.name).slice(0, 175); if (d.filename.toLowerCase() === 'area') d.filename += ' (place)'; }
      if (this.draft.phase === 'editing') await this.context.store.validatePlacePreparation(d.capture, d.area, d.filename);
      await this.completing();
      const saved = await this.context.store.saveCapture(d.capture, d.area, d.filename, { allowUnassigned: true, makeDefaultSourceType: d.makeDefaultSourceType });
      if (d.linkedSource) await this.context.store.linkParking(saved.path, d.linkedSource);
      await this.completed(saved.path);
    } catch (e) { this.setBusy(false); this.failure(e); }
  }
}
