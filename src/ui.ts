import { markInputModal } from './ui/modal-layout';
import { StructuredVisitModal as VisitModal, renderVisitHistory } from './ui/visits';
import { VisitInsightsModal } from './ui/visit-insights';
export { VisitModal };
import { distanceFromKm, distanceToKm, formatDistance, normaliseDistanceUnit, type DistanceUnit } from './units';
import { readGoogleHours, readGoogleTopics, validSnapshotDate } from './domain/google-details';
import { Component, Modal, Notice, Platform, Setting, SuggestModal, TFile } from 'obsidian';
import type { NotebookContext } from './notebook-context';
import type { AreaHint, CaptureDraft, Coordinates, LocalityRecord, PlaceKind, PlaceRecord } from './types';
import { canonicalPlaceIdentity, formatRating, googleMapsUrl, localitySuggestions, navigationUrl, parseGooglePlaceUrl, resolveParking, safeFileName, validateCoordinates, validateRootPath, websiteUrl, telephoneUrl } from './domain';
import { addressParts, getAddressHints } from './capture';
import { AttachNotebookModal } from './ui/attach-notebook';
import { copyTextOrShow } from './platform/clipboard';
import { THIRD_PARTY_NOTICES } from './credits';
import { AreaEditor, areaSelectionFor, selectedAreaPath, areaSegments } from './ui/area-controls';
import { mountPlaceMap, type PlaceMap } from './map';

export function button(parent: HTMLElement, text: string, run: () => unknown, primary = false): HTMLButtonElement {
  const b = parent.createEl('button', { text, cls: primary ? 'mod-cta' : '' });
  b.onclick = async () => { b.disabled = true; try { await run(); } catch (e) { new Notice(errorText(e)); } finally { b.disabled = false; } }; return b;
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
/** Malformed structured frontmatter must not become "[object Object]" in a field. */
export function propertyText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback;
}
export function external(plugin: NotebookContext, parent: HTMLElement, text: string, url: string): void {
  if (!url) return;
  if (plugin.externalActions === 'preview') {
    const preview = button(parent, 'Preview ' + text, () => plugin.openExternal(url, text));
    preview.setAttribute('data-preview-url', url); return;
  }
  const link = parent.createEl('a', { text, href: url, cls: 'external-link', attr: { target: '_blank', rel: 'noopener noreferrer' } });
  const activate = async (event: MouseEvent) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault(); event.stopPropagation();
    try { await plugin.openExternal(url, text); } catch (error) { new Notice(errorText(error)); }
  };
  link.onclick = activate; link.onauxclick = activate;
}

/** Fictional practice content stays visibly distinct wherever shared controls render. */
export function renderContextBanner(plugin: NotebookContext, parent: HTMLElement): void {
  if (plugin.kind !== 'examples' || parent.querySelector(':scope > .charity-examples-banner')) return;
  const banner = parent.createDiv({ cls: 'charity-examples-banner charity-empty-state', attr: { role: 'note' } });
  banner.createEl('strong', { text: 'Examples: fictional practice data' });
  banner.createEl('p', { text: 'Practice changes stay here. External actions preview destinations.', cls: 'charity-hint' });
}
export function renderExamplesEntry(plugin: NotebookContext, parent: HTMLElement): void {
  if (plugin.kind === 'examples') {
    if (plugin.tourPath && plugin.app.vault.getAbstractFileByPath(plugin.tourPath) instanceof TFile)
      button(parent, 'Open tour', () => plugin.openFile(plugin.tourPath!));
    return;
  }
  button(parent, plugin.host.examplesAvailable ? 'Open examples' : 'Add examples', () => plugin.host.showExamples());
}
export function renderExamplesReference(plugin: NotebookContext, parent: HTMLElement, reason = 'Setup, browser capture and moving the notebook are explained in the Reference notes.'): void {
  renderContextBanner(plugin, parent);
  parent.createEl('p', { text: reason, cls: 'charity-hint' });
  if (plugin.referencePath && plugin.app.vault.getAbstractFileByPath(plugin.referencePath) instanceof TFile)
    button(parent, 'Reference: setup and capture', () => plugin.openFile(plugin.referencePath!));
  else parent.createEl('p', { text: 'Reference notes are unavailable. Open the examples workspace to review this installation.', cls: 'charity-hint' });
}
export function details(parent: HTMLElement, label: string): HTMLDetailsElement {
  const section = parent.createEl('details', { cls: 'charity-details' }); section.createEl('summary', { text: label }); return section;
}
function localityLabel(locality: LocalityRecord): string { return locality.label || locality.name; }
export class PickModal<T> extends SuggestModal<T> {
  constructor(plugin: NotebookContext, private values: T[], private label: (value: T) => string, private choose: (value: T) => unknown, title: string) { super(plugin.app); this.setPlaceholder(plugin.kind === 'examples' ? 'Examples: ' + title : title); }
  getSuggestions(query: string): T[] { return this.values.filter(v => this.label(v).toLocaleLowerCase().includes(query.toLocaleLowerCase())); }
  renderSuggestion(value: T, el: HTMLElement): void { el.setText(this.label(value)); }
  onChooseSuggestion(value: T): void { void (async () => { try { await this.choose(value); } catch (error) { new Notice(errorText(error)); } })(); }
}
export function pickPlace(plugin: NotebookContext, values: PlaceRecord[], choose: (value: PlaceRecord) => unknown, title = 'Search places'): void {
  new PickModal(plugin, values, p => p.name + ' — ' + p.path.split('/').slice(0, -1).join(' / '), choose, title).open();
}
export function pickCapture(plugin: NotebookContext, values: TFile[], choose: (value: TFile) => unknown): void {
  new PickModal(plugin, values, f => f.basename, choose, 'Choose a pending capture').open();
}
export function manualDraft(kind: PlaceKind, coordinates: Coordinates | null = null): CaptureDraft {
  return { captureId: crypto.randomUUID(), kind, name: '', address: '', url: '', coordinates, googleRating: null, googleReviewCount: null, topics: [], hours: [], capturedAt: new Date().toISOString(), street: '', postcode: '', brandTag: '' };
}
export class ContactModal extends Modal {
  private finishEditing?: () => void;
  constructor(private plugin: NotebookContext, private place: PlaceRecord) { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.modalEl.addClass('charity-contact-modal'); this.titleEl.setText('Contact details'); renderContextBanner(this.plugin, this.contentEl);
    let website = typeof this.place.properties.website === 'string' ? this.place.properties.website : '';
    let telephone = typeof this.place.properties.telephone === 'string' ? this.place.properties.telephone : '';
    this.contentEl.createEl('p', { text: 'Add or correct details from any source. Leave unknown details blank.', cls: 'charity-hint' });
    new Setting(this.contentEl).setName('Website').addText(t => {
      t.inputEl.type = 'url'; t.inputEl.setAttribute('aria-label', 'Website'); t.inputEl.placeholder = 'https://example.org';
      t.setValue(website).onChange(v => website = v);
    });
    new Setting(this.contentEl).setName('Telephone').addText(t => {
      t.inputEl.type = 'tel'; t.inputEl.setAttribute('aria-label', 'Telephone');
      t.setValue(telephone).onChange(v => telephone = v);
    });
    const footer = this.contentEl.createDiv('charity-modal-footer');
    const status = footer.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    button(footer, 'Save contacts', async () => {
      status.setText('Saving...');
      try { await this.plugin.store.updateContact(this.place.path, { website, telephone }, { website: this.place.properties.website, telephone: this.place.properties.telephone }); this.close(); new Notice('Contact details saved'); }
      catch (error) { status.setText('Not saved: ' + errorText(error)); status.addClass('charity-error'); }
    }, true);
  }
  onClose(): void { this.finishEditing?.(); this.contentEl.empty(); }
}
export class TextModal extends Modal {
  constructor(private plugin: NotebookContext, private heading: string, private label: string, private save: (value: string) => Promise<unknown>, private initial = '') { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    this.titleEl.setText(this.heading); renderContextBanner(this.plugin, this.contentEl); let value = this.initial;
    new Setting(this.contentEl).setName(this.label).addText(t => t.setValue(value).onChange(v => value = v));
    button(this.contentEl, 'Save', async () => { await this.save(value); this.close(); }, true);
  }
}
function renderMovePreview(el: HTMLElement, preview: { files: { from: string; to: string }[]; rewrites: string[]; conflicts: string[]; warnings?: string[] }): void {
  el.createEl('p', { text: preview.files.length + ' files to move; ' + preview.rewrites.length + ' files with links or configuration to update.' });
  for (const warning of preview.warnings ?? []) el.createEl('p', { text: warning, cls: 'charity-hint' });
  for (const conflict of preview.conflicts) el.createEl('p', { text: conflict, cls: 'charity-error' });
  const list = details(el, 'Affected files and links').createEl('ul');
  for (const file of preview.files) list.createEl('li', { text: file.from + ' → ' + file.to });
  for (const path of preview.rewrites) list.createEl('li', { text: 'Update links: ' + path });
}
export class LocalityModal extends Modal {
  constructor(private plugin: NotebookContext, private existing?: LocalityRecord, private created?: (locality: LocalityRecord) => unknown) { super(plugin.app); }
  onOpen(): void { markInputModal(this); void this.render().catch(e => this.contentEl.createEl('p', { text: errorText(e), cls: 'charity-error' })); }
  private async render(): Promise<void> {
    const values = await this.plugin.store.listLocalities(), el = this.contentEl; renderContextBanner(this.plugin, el);
    this.titleEl.setText(this.existing ? 'Rename area / Change parent' : 'New locality');
    let name = this.existing?.name ?? '', parent = this.existing?.parentPath ?? '';
    let preview: Awaited<ReturnType<typeof this.plugin.store.previewLocalityMove>> | undefined;
    const previewEl = el.createDiv('charity-move-preview'), invalidate = () => { preview = undefined; previewEl.empty(); };
    new Setting(el).setName('Area name').setDesc('Use a town or neighbourhood name. Leave parent empty to create a town first.').addText(t => t.setValue(name).onChange(v => { name = v; invalidate(); }));
    const row = new Setting(el).setName('Parent area').setDesc(values.find(l => l.path === parent)?.label || 'None — standalone town or area');
    row.addButton(b => b.setButtonText('Choose…').onClick(() => new PickModal(this.plugin, values.filter(l => l.path !== this.existing?.path && !l.path.startsWith((this.existing?.path.replace(/\.md$/, '') ?? '\u0000') + '/')),
      localityLabel, l => { parent = l.path; row.setDesc(localityLabel(l)); invalidate(); }, 'Search parent areas').open()));
    row.addButton(b => b.setButtonText('None').onClick(() => { parent = ''; row.setDesc('None — standalone town or area'); invalidate(); }));
    el.appendChild(previewEl);
    if (!this.existing) {
      button(el, 'Create area', async () => { const locality = await this.plugin.store.ensureLocality(name, parent); this.close(); if (this.created) await this.created(locality); else await this.plugin.openFile(locality.path); }, true); return;
    }
    el.createEl('p', { text: 'Preview affected notes and links. Sources, parking and child areas move together.', cls: 'charity-hint' });
    button(el, 'Preview changes', async () => {
      previewEl.empty(); preview = await this.plugin.store.previewLocalityMove(this.existing!.path, name, parent); renderMovePreview(previewEl, preview);
      if (!preview.conflicts.length) button(previewEl, 'Apply area changes', async () => {
        const report = await this.plugin.runRootOperation(() => this.plugin.store.moveLocality(this.existing!.path, name, parent, preview));
        new Notice('Area updated. Recovery backup: ' + report.backupRoot, 10000); this.close(); await this.plugin.openFile(this.plugin.store.root + '/Localities.md');
      }, true);
    });
  }
}
export class NotebookMoveModal extends Modal {
  constructor(private plugin: NotebookContext) { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    if (this.plugin.kind === 'examples') { this.titleEl.setText('Examples reference'); renderExamplesReference(this.plugin, this.contentEl, 'The examples notebook stays separate. Moving a real notebook is described in Reference.'); return; }
    this.titleEl.setText('Move notebook'); let target = this.plugin.settings.root;
    const el = this.contentEl;
    el.createEl('p', { text: 'Choose a folder inside this vault. Files, generated components and links are checked before moving.' });
    const previewEl = el.createDiv('charity-move-preview');
    let preview: Awaited<ReturnType<typeof this.plugin.store.previewNotebookMove>> | undefined;
    new Setting(el).setName('New notebook folder').addText(t => t.setValue(target).onChange(v => { target = v; preview = undefined; previewEl.empty(); }));
    el.appendChild(previewEl);
    button(el, 'Preview move', async () => {
      previewEl.empty(); target = validateRootPath(target); preview = await this.plugin.store.previewNotebookMove(target); renderMovePreview(previewEl, preview);
      if (!preview.conflicts.length) button(previewEl, 'Move notebook', async () => {
        const report = await this.plugin.runRootOperation(() => this.plugin.store.moveNotebook(target, preview));
        this.close(); await this.plugin.home(); new Notice('Notebook moved. Re-import the updated Web Clipper templates. Recovery backup: ' + report.backupRoot, 15000);
      }, true);
    });
  }
}
export class CaptureModal extends Modal {
  private owner = new Component();
  private map?: PlaceMap;
  private localities: LocalityRecord[] = [];
  private places: PlaceRecord[] = [];
  private area?: AreaEditor;
  private filename = ''; private filenameEdited = false;
  private fileInput?: HTMLInputElement; private suggestions?: HTMLElement;
  private destination?: HTMLElement; private error?: HTMLElement; private coordsInput?: HTMLInputElement;
  private closed = false; private finishEditing?: () => void;
  private makeDefault = false; private defaultSetting?: Setting; private defaultToggle?: import('obsidian').ToggleComponent;
  private remember = false; private phrase = ''; private phraseEdited = false;
  private rememberSetting?: Setting; private phraseSetting?: Setting; private phraseInput?: HTMLInputElement; private rememberToggle?: import('obsidian').ToggleComponent;
  constructor(private plugin: NotebookContext, public draft: CaptureDraft, private shopPath?: string, private done?: () => void) { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.owner.load(); this.modalEl.addClass('charity-capture-modal');
    void this.render().catch(e => this.contentEl.createEl('p', { text: errorText(e), cls: 'charity-error' }));
  }
  private async render(): Promise<void> {
    [this.localities, this.places] = await Promise.all([this.plugin.store.listLocalities(), this.plugin.store.listPlaces()]);
    if (this.closed) return;
    const linkedArea = this.places.find(p => p.path === this.shopPath)?.locality ?? '';
    this.area = new AreaEditor(this.plugin, this.localities, areaSelectionFor(linkedArea, this.localities), () => {
      this.updateFilename(); this.updateSuggestions(); this.map?.setRecords(this.previewRecords());
      if (!this.draft.coordinates) this.map?.fitAll();
    }, this.draft.address);
    this.phrase = getAddressHints(this.draft.address).phrase;
    const el = this.contentEl; renderContextBanner(this.plugin, el);
    this.titleEl.setText(this.draft.kind === 'shop' ? 'Review source' : 'Review parking');
    if (this.draft.sourcePath) el.createEl('p', { text: 'Your original capture stays in the inbox until saved.', cls: 'charity-hint' });
    new Setting(el).setName('Name').addText(t => t.setValue(this.draft.name).onChange(v => { this.draft.name = v; this.updateFilename(); }));
    if (this.draft.kind === 'shop') {
      // Apply the remembered default once. An explicit capture value always wins.
      this.draft.sourceType = this.draft.sourceType?.trim() || this.plugin.settings.defaultSourceType;
      const choices = [...new Set([...this.plugin.settings.sourceTypes, this.plugin.settings.defaultSourceType, this.draft.sourceType])];
      let custom: Setting, customValue = '';
      new Setting(el).setName('Source type').addDropdown(d => {
        for (const type of choices) d.addOption(type, type);
        d.addOption('__custom__', 'Custom…');
        d.setValue(this.draft.sourceType!).onChange(v => {
          custom.settingEl.toggle(v === '__custom__'); this.draft.sourceType = v === '__custom__' ? customValue : v; this.updateDefaultChoice();
        });
      });
      custom = new Setting(el).setName('Custom source type').addText(t => { t.inputEl.setAttribute('aria-label', 'Custom source type'); t.onChange(v => { customValue = v; this.draft.sourceType = v; this.updateDefaultChoice(); }); });
      custom.settingEl.hide();
      this.defaultSetting = new Setting(el).setName('Use as my default').setDesc('Use this type for future blank captures. Existing notes keep their type.')
        .addToggle(t => { this.defaultToggle = t; t.toggleEl.setAttribute('aria-label', 'Use as my default'); t.setValue(false).onChange(v => this.makeDefault = v); });
      this.updateDefaultChoice();
    }
    if (this.draft.coordinateIssue) el.createEl('p', { text: this.draft.coordinateIssue, cls: 'charity-hint' });
    const mapEl = el.createDiv('charity-capture-preview');
    this.map = mountPlaceMap(this.owner, mapEl, this.plugin.mapHost, { records: this.previewRecords(), focusPath: this.previewPath(), unsavedPath: this.previewPath(), onPick: coords => {
      this.draft.coordinates = coords; if (this.coordsInput) this.coordsInput.value = coords.join(', '); this.map?.setRecords(this.previewRecords()); this.updateSuggestions();
    } });
    this.area.mount(el);
    this.suggestions = el.createDiv('charity-locality-suggestions'); this.updateSuggestions();
    this.rememberSetting = new Setting(el).setName('Remember this address phrase')
      .setDesc('Optional. Save a rule for this phrase within the chosen town, using the area you confirm below.')
      .addToggle(t => { this.rememberToggle = t; t.toggleEl.setAttribute('aria-label', 'Remember this address phrase'); t.setValue(false).onChange(v => { this.remember = v; this.phraseSetting?.settingEl.toggle(v); }); });
    this.phraseSetting = new Setting(el).setName('Address phrase').setDesc('Use a distinctive place or shopping-centre name. You can edit or remove saved rules in settings.')
      .addText(t => { this.phraseInput = t.inputEl; t.inputEl.setAttribute('aria-label', 'Address phrase'); t.setValue(this.phrase).onChange(v => { this.phrase = v; this.phraseEdited = true; }); });
    this.phraseSetting.settingEl.hide();
    this.updateRememberVisibility();
    const contacts = details(el, 'Contact details');
    contacts.createEl('p', { text: 'Captured from the selected listing when available. You can also enter details from another source.', cls: 'charity-hint' });
    new Setting(contacts).setName('Website').addText(t => {
      t.inputEl.type = 'url'; t.inputEl.setAttribute('aria-label', 'Website'); t.inputEl.placeholder = 'https://example.org';
      t.setValue(this.draft.website ?? '').onChange(v => this.draft.website = v);
    });
    new Setting(contacts).setName('Telephone').addText(t => {
      t.inputEl.type = 'tel'; t.inputEl.setAttribute('aria-label', 'Telephone');
      t.setValue(this.draft.telephone ?? '').onChange(v => this.draft.telephone = v);
    });
    const optional = details(el, 'Address, Google information and coordinates');
    new Setting(optional).setName('Address').addText(t => t.setValue(this.draft.address).onChange(v => {
      this.draft.address = v;
      if (!this.phraseEdited) { this.phrase = getAddressHints(v).phrase; if (this.phraseInput) this.phraseInput.value = this.phrase; }
      this.area?.setAddress(v); this.updateRememberVisibility(); this.updateFilename();
    }));
    new Setting(optional).setName('Google Maps listing').addText(t => t.setValue(this.draft.url).onChange(v => this.draft.url = v));
    button(optional, 'Read location from listing URL', () => {
      const parsed = parseGooglePlaceUrl(this.draft.url); if (!parsed.coordinates) { new Notice(parsed.issue ?? 'No unambiguous place location in this URL.'); return; }
      this.draft.coordinates = parsed.coordinates; if (this.coordsInput) this.coordsInput.value = parsed.coordinates.join(', '); this.map?.setRecords(this.previewRecords()); this.updateSuggestions();
    });
    new Setting(optional).setName('Coordinates').setDesc('Latitude, longitude. Leave empty when unknown.').addText(t => {
      this.coordsInput = t.inputEl; t.setValue(this.draft.coordinates?.join(', ') ?? '').onChange(v => {
        this.draft.coordinates = v.trim() ? validateCoordinates(v.split(',').map(x => x.trim())) : null; this.updateSuggestions(); this.map?.setRecords(this.previewRecords());
      });
    });
    if (this.draft.kind === 'shop') {
      new Setting(optional).setName('Brand / name tag').setDesc('Brand only, without the town or neighbourhood.').addText(t => t.setValue(this.draft.brandTag).onChange(v => this.draft.brandTag = v));
      optional.createEl('p', { text: 'Google snapshot checked ' + this.draft.capturedAt.slice(0, 10) + '. Separate from your sourcing rating.', cls: 'charity-hint' });
      for (const [key, label] of [['googleRating', 'Google score'], ['googleReviewCount', 'Review count']] as const) new Setting(optional).setName(label).addText(t => {
        t.inputEl.type = 'number'; t.inputEl.min = '0'; t.inputEl.step = key === 'googleRating' ? '0.1' : '1'; if (key === 'googleRating') t.inputEl.max = '5';
        t.setValue(this.draft[key] === null ? '' : String(this.draft[key])).onChange(v => this.draft[key] = v.trim() === '' ? null : Number(v));
      });
      for (const [key, label] of [['hours', 'Opening hours'], ['topics', 'Review topics and counts']] as const) new Setting(optional).setName(label).setDesc('One entry per line. Leave missing information blank.').addTextArea(t => {
        t.inputEl.rows = 3; t.setValue(this.draft[key].join('\n')).onChange(v => this.draft[key] = v.split('\n').map(s => s.trim()).filter(Boolean));
      });
    }
    const identity = canonicalPlaceIdentity(this.draft.url);
    const possible = this.places.filter(p => p.name.toLowerCase() === this.draft.name.toLowerCase() || (this.draft.url && p.properties.google_maps_url === this.draft.url) || (identity && typeof p.properties.google_maps_url === 'string' && canonicalPlaceIdentity(p.properties.google_maps_url) === identity) || (this.draft.address && p.properties.address === this.draft.address));
    if (possible.length) {
      const matches = el.createDiv('charity-hint'); matches.createEl('p', { text: 'Possible existing notes — check before saving:' });
      for (const p of possible) button(matches, p.name + ' — ' + p.path.split('/').at(-2), () => this.plugin.openFile(p.path));
    }
    new Setting(details(el, 'Edit filename')).setName('Filename').setDesc('Existing notes are never replaced.').addText(t => {
      this.fileInput = t.inputEl; t.onChange(v => { this.filename = v; this.filenameEdited = true; this.updateDestination(); });
    });
    const footer = el.createDiv('charity-modal-footer');
    this.destination = footer.createDiv({ cls: 'charity-destination', attr: { role: 'status', 'aria-live': 'polite' } }); this.updateFilename();
    this.error = footer.createDiv({ cls: 'charity-error', attr: { role: 'alert' } });
    button(footer, 'Save place', () => this.save(), true);
  }
  private updateDefaultChoice(): void {
    this.makeDefault = false; this.defaultToggle?.setValue(false);
    const differs = !!this.draft.sourceType?.trim() && this.draft.sourceType.trim() !== this.plugin.settings.defaultSourceType;
    this.defaultSetting?.settingEl.toggle(differs);
    if (!differs) {
      this.makeDefault = false;
      this.defaultToggle?.setValue(false);
    }
  }
  private updateRememberVisibility(): void {
    const available = !!this.draft.address.trim();
    this.rememberSetting?.settingEl.toggle(available); this.phraseSetting?.settingEl.toggle(available && this.remember);
    if (!available) { this.remember = false; this.rememberToggle?.setValue(false); }
  }
  private previewPath(): string { return this.plugin.store.root + '/Sources/.review.md'; }
  private previewRecords(): PlaceRecord[] {
    const value = this.area?.value ?? { town: '', locality: '' }; const locality = selectedAreaPath(value) || value.townPath || '';
    const selected = this.localities.find(l => l.path === locality);
    const areaPaths = new Set(selected ? this.localities.filter(l => selected.segments.every((segment, i) => l.segments[i] === segment)).map(l => l.path) : []);
    const context = this.places.filter(p => areaPaths.has(p.locality));
    return [...context, { path: this.previewPath(), name: this.draft.name || 'New location', kind: this.draft.kind, locality, coordinates: this.draft.coordinates, properties: { rating: 0 } }];
  }
  private updateSuggestions(): void {
    if (!this.suggestions) return; this.suggestions.empty();
    const nearby = localitySuggestions(this.draft.coordinates, this.localities, this.places, this.plugin.settings.suggestionKm);
    if (nearby.length) {
      const row = this.suggestions.createDiv('charity-nearby'); row.createSpan({ text: 'Nearby: ' });
      for (const s of nearby) button(row, localityLabel(s.locality) + ' (' + formatDistance(s.distanceKm, normaliseDistanceUnit(this.plugin.settings.distanceUnit), 2) + ')', () => this.area?.choose(s.locality));
    }
    const recent = this.plugin.settings.recentLocalities.map(path => this.localities.find(l => l.path === path)).filter((l): l is LocalityRecord => !!l).filter(l => !nearby.some(n => n.locality.path === l.path)).slice(0, 4);
    if (recent.length) { const row = this.suggestions.createDiv('charity-nearby'); row.createSpan({ text: 'Recent: ' }); for (const l of recent) button(row, localityLabel(l), () => this.area?.choose(l)); }
    this.updateDestination();
  }
  private updateFilename(): void {
    if (!this.filenameEdited) {
      const area = this.area?.value, locality = area?.locality.trim() || area?.town.trim() || '', { postcode, street } = addressParts(this.draft.address);
      let name = this.draft.name.trim();
      if (locality) name = name.replace(new RegExp('(?:[ ,–—-]+)' + locality.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '$', 'i'), '').trim();
      this.filename = safeFileName([name, locality, street, postcode].filter(Boolean).join(' – ')); if (this.fileInput) this.fileInput.value = this.filename;
    }
    this.updateDestination();
  }
  private updateDestination(): void {
    const area = this.area?.value ?? { town: '', locality: '' };
    this.destination?.setText('Save to: ' + this.plugin.store.paths.places + '/' + (areaSegments(area, this.localities).join('/') || '[enter town]') + '/' + (this.filename.replace(/\.md$/i, '') || '[enter name]') + '.md');
  }
  private async save(): Promise<void> {
    try {
      this.error?.setText('Saving…');
      if (this.coordsInput?.value.trim() && !this.draft.coordinates) throw Error('Coordinates must contain a valid latitude and longitude, or be empty.');
      if (this.draft.kind === 'shop' && !this.draft.sourceType?.trim()) throw Error('Choose or enter a source type.');
      if (this.draft.googleRating !== null && (!Number.isFinite(this.draft.googleRating) || this.draft.googleRating < 0 || this.draft.googleRating > 5)) throw Error('Google score must be from 0 to 5, or blank.');
      if (this.draft.googleReviewCount !== null && (!Number.isInteger(this.draft.googleReviewCount) || this.draft.googleReviewCount < 0)) throw Error('Review count must be a non-negative whole number, or blank.');
      if (this.remember && !this.phrase.trim()) throw Error('Enter an address phrase to remember, or turn off the option.');
      if (this.draft.kind === 'shop' && !this.draft.brandTag) this.draft.brandTag = this.draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const file = await this.plugin.store.saveCapture(structuredClone(this.draft), this.area!.confirmedValue(), this.filename, {
        makeDefaultSourceType: this.draft.kind === 'shop' && this.makeDefault,
        ...(this.remember ? { rememberHint: { phrase: this.phrase.trim() } } : {}),
      });
      if (this.shopPath) await this.plugin.store.linkParking(file.path, this.shopPath);
      this.close(); await this.plugin.openFile(file.path); new Notice('Place saved');
    } catch (e) { this.error?.setText('Not saved: ' + errorText(e)); }
  }
  onClose(): void { this.closed = true; this.owner.unload(); this.finishEditing?.(); this.contentEl.empty(); this.done?.(); }
}

const assessmentStatus = new Map<string, { text: string; failed: boolean }>();

export async function renderPlace(plugin: NotebookContext, owner: Component, el: HTMLElement, path: string, existingMap?: PlaceMap, isCurrent = () => true): Promise<PlaceMap | undefined> {
  const places = await plugin.store.listPlaces(), place = places.find(p => p.path === path);
  if (!isCurrent()) return existingMap;
  if (!place) { el.createEl('p', { text: 'These controls belong in a saved Reseller sourcing source or parking note.' }); return; }
  const sourceFile = place.kind === 'shop' ? plugin.app.vault.getAbstractFileByPath(path) : null;
  const sourceText = sourceFile instanceof TFile ? await plugin.app.vault.read(sourceFile) : '';
  const capturedHours = sourceFile instanceof TFile ? readGoogleHours(sourceText) : null;
  const capturedTopics = sourceFile instanceof TFile ? readGoogleTopics(sourceText) : null;
  if (!isCurrent()) return existingMap;
  const related = place.kind === 'shop' ? resolveParking(place, places).choices : [];
  const records = places.filter(p => p.path === place.path || (place.locality && p.locality === place.locality) || related.some(r => r.path === p.path));
  const map = existingMap ?? mountPlaceMap(owner, el, plugin.mapHost, { records, focusPath: place.path });
  if (existingMap) existingMap.setRecords(records);
  const prior = el.querySelector('.charity-place-controls');
  // Metadata refreshes must not replace text the user is still editing.
  if (prior?.contains(el.doc.activeElement) && el.doc.activeElement?.matches('input[type=text],textarea')) return map;
  prior?.remove(); el = el.createDiv('charity-place-controls');
  renderContextBanner(plugin, el);
  const actions = el.createDiv('charity-actions'); external(plugin, actions, 'Google Maps', googleMapsUrl(place));
  const parking = place.kind === 'shop' ? resolveParking(place, places) : { status: 'single', destination: place, choices: [] };
  if (parking.status === 'choice') button(actions, 'Drive here…', () => pickPlace(plugin, parking.choices, p => {
    const url = navigationUrl(p.coordinates, 'driving'); if (url) return plugin.openExternal(url, 'Drive to parking'); else new Notice('Add coordinates to this parking note first.');
  }, 'Choose parking for this trip'));
  else external(plugin, actions, parking.destination?.kind === 'parking' && place.kind === 'shop' ? 'Drive to parking' : 'Drive here', navigationUrl(parking.destination?.coordinates ?? null, 'driving'));
  external(plugin, actions, 'Walk here', navigationUrl(place.coordinates, 'walking'));
  external(plugin, actions, 'Website', websiteUrl(place.properties.website));
  const phone = typeof place.properties.telephone === 'string' ? place.properties.telephone : '';
  external(plugin, actions, 'Call ' + phone, telephoneUrl(phone));
  if (place.kind === 'shop') {
    const destination = parking.status === 'choice' ? 'Choose a parking location for this trip.'
      : parking.status === 'invalid' ? 'Chosen parking is missing or has no coordinates. Choose another below.'
      : 'Driving destination: ' + (parking.destination?.name ?? place.name) + (parking.status === 'preferred' ? ' (preferred parking)' : '');
    el.createEl('p', { text: destination, cls: 'charity-hint' });
  }
  const controls = el.createDiv('charity-actions');
  button(controls, 'Edit contacts', () => new ContactModal(plugin, place).open());
  button(controls, 'Change area', () => new ChangeAreaModal(plugin, place.path).open());
  const status = el.createDiv({ cls: 'charity-save-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const previousStatus = assessmentStatus.get(path); if (previousStatus) { status.setText(previousStatus.text); status.toggleClass('charity-error', previousStatus.failed); }
  const save = async (run: () => Promise<void>) => {
    const finish = plugin.beginEditing(); if (!finish) return;
    status.removeClass('charity-error'); status.setText('Saving…'); assessmentStatus.set(path, { text: 'Saving…', failed: false });
    try { await run(); status.setText('Saved'); assessmentStatus.set(path, { text: 'Saved', failed: false }); }
    catch (e) { status.setText('Not saved: ' + errorText(e)); status.addClass('charity-error'); assessmentStatus.set(path, { text: 'Not saved: ' + errorText(e), failed: true }); new Notice('Not saved: ' + errorText(e)); }
    finally { finish(); }
  };
  if (place.kind === 'shop') {
    button(controls, 'Add visit', () => new VisitModal(plugin, place.path).open(), true);
    button(controls, 'Visit insights', () => new VisitInsightsModal(plugin, place.path).open());
    button(controls, 'Link parking', () => pickPlace(plugin, places.filter(p => p.kind === 'parking'), async p => {
      await plugin.store.linkParking(p.path, place.path); new Notice('Parking linked');
    }, 'Search reusable parking locations'));
    const rating = new Setting(el).setName('Sourcing rating').setDesc(formatRating(place.properties.rating));
    rating.addDropdown(d => {
      for (let n = 0; n <= 5; n += .5) d.addOption(String(n), n ? String(n) : '0 · Not rated');
      d.setValue(propertyText(place.properties.rating, '0')).onChange(v => void save(async () => { await plugin.store.updateAssessment(place.path, { rating: Number(v) }); rating.setDesc(formatRating(Number(v))); }));
    });
    new Setting(el).setName('Shortlist').setDesc('Keep for an upcoming outing. Visits do not clear it.').addToggle(t => t.setValue(place.properties.shortlist === true).onChange(v => void save(() => plugin.store.updateAssessment(place.path, { shortlist: v }))));
    new Setting(el).setName('Takeaway').addText(t => {
      t.setValue(propertyText(place.properties.comments));
      t.inputEl.onchange = () => void save(() => plugin.store.updateAssessment(place.path, { comments: t.getValue() }));
    });
    if (parking.choices.length) {
      const section = details(el, 'Linked parking (' + parking.choices.length + ')');
      new Setting(section).setName('Preferred parking').addDropdown(d => {
        d.addOption('', 'No preference — choose if several');
        for (const p of parking.choices) d.addOption(p.path, p.name);
        d.setValue(parking.status === 'preferred' ? parking.destination?.path ?? '' : '').onChange(v => void save(() => plugin.store.setPreferredParking(place.path, v)));
      });
      for (const p of parking.choices) {
        const line = section.createDiv('charity-parking-list');
        button(line, p.name, () => plugin.openFile(p.path));
        line.createSpan({ text: propertyText(p.properties.parking_cost, 'cost unknown') + ' · ' + propertyText(p.properties.parking_availability, 'availability unknown') });
        button(line, 'Unlink', () => save(() => plugin.store.unlinkParking(p.path, place.path)));
      }
    }
  } else {
    button(controls, 'Link a source', () => pickPlace(plugin, places.filter(p => p.kind === 'shop'), async p => {
      await plugin.store.linkParking(place.path, p.path); new Notice('Source linked');
    }, 'Choose a source served by this parking'));
    const sources = places.filter(p => p.kind === 'shop' && resolveParking(p, places).choices.some(q => q.path === place.path));
    if (sources.length) {
      const section = details(el, 'Linked sources (' + sources.length + ')');
      for (const source of sources) {
        const line = section.createDiv('charity-parking-list'); button(line, source.name, () => plugin.openFile(source.path));
        button(line, 'Unlink', () => save(() => plugin.store.unlinkParking(place.path, source.path)));
      }
    }
  }
  if (place.kind === 'shop') {
    await renderVisitHistory(plugin, owner, el, place.path, isCurrent); if (!isCurrent()) return map;
    const section = details(el, 'Current captured details');
    section.addClass('charity-google-details');
    const checked = (value: unknown) => validSnapshotDate(value) || 'Date unknown';
    const props = place.properties;
    const score = typeof props.google_rating === 'number' && Number.isFinite(props.google_rating) && props.google_rating >= 0 && props.google_rating <= 5 ? props.google_rating : null;
    const count = typeof props.google_review_count === 'number' && Number.isSafeInteger(props.google_review_count) && props.google_review_count >= 0 ? props.google_review_count : null;
    section.createEl('p', { text: 'Google: ' + (score ?? 'Not available') + ' / 5; ' + (count ?? 'Unknown') + ' reviews. Checked: ' + checked(props.google_checked) + '.', cls: 'charity-hint' });
    section.createEl('h4', { text: 'Opening hours' });
    if (capturedHours?.hours.length) {
      section.createEl('p', { text: 'Checked: ' + (capturedHours.checked || 'Date unknown') + (capturedHours.legacy ? ' (original capture).' : '.'), cls: 'charity-hint' });
      const list = section.createEl('ul'); for (const row of capturedHours.hours) list.createEl('li', { text: row });
    } else section.createEl('p', { text: 'Not captured.', cls: 'charity-hint' });
    section.createEl('h4', { text: 'Review topics' });
    const topics = capturedTopics?.topics ?? [];
    if (topics.length) {
      section.createEl('p', { text: 'Checked: ' + (capturedTopics?.checked || 'Date unknown') + (capturedTopics?.legacy ? ' (original capture).' : '.'), cls: 'charity-hint' });
      const list = section.createEl('ul'); for (const topic of topics) list.createEl('li', { text: topic });
    } else section.createEl('p', { text: 'Not captured.', cls: 'charity-hint' });
    section.createEl('p', { text: 'Google details are a captured snapshot, separate from your sourcing rating. Original body snapshots are retained below when present.', cls: 'charity-hint' });
  }
  return map;
}

export class SetupModal extends Modal {
  constructor(private plugin: NotebookContext) { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    if (this.plugin.kind === 'examples') { this.titleEl.setText('Examples reference'); renderExamplesReference(this.plugin, this.contentEl); return; }
    this.titleEl.setText('Set up Reseller sourcing'); const el = this.contentEl;
    el.createEl('p', { text: 'Vault: ' + this.plugin.app.vault.getName() + ' · Plugin ' + this.plugin.manifest.version });
    el.createEl('p', { text: 'Notebook folder: ' + this.plugin.settings.root + '. Open this folder inside the current vault; it is not a separate vault.' });
    if (!this.plugin.settings.setupVersion) new Setting(el).setName('Notebook folder').addText(t => {
      t.setValue(this.plugin.settings.root);
      t.inputEl.onchange = () => { void (async () => {
        try { this.plugin.settings.root = validateRootPath(t.getValue()); await this.plugin.saveSettings(); }
        catch (e) { new Notice(errorText(e)); t.setValue(this.plugin.settings.root); }
      })(); };
    });
    else {
      button(el, 'Open notebook', () => this.plugin.openFile(this.plugin.store.root + '/Home.md'), true);
      button(el, 'Move notebook…', () => new NotebookMoveModal(this.plugin).open());
    }
    if (this.plugin.store.migrationActive) {
      const recovery = el.createDiv('charity-hint');
      recovery.createEl('p', { text: 'An organisation change needs recovery. Capture and editing stay paused until it is resolved. Existing notes and the recovery backup are retained. Recovery stops if any affected file has changed since the move.' });
      button(recovery, 'Restore previous organisation', async () => {
        await this.plugin.runRootOperation(() => this.plugin.store.rollbackMove(), true); new Notice('Previous organisation restored.'); this.close();
      });
      return;
    }
    el.createEl('p', { text: this.plugin.basesReady ? 'Core Bases is available.' : 'Enable Bases in Settings → Core plugins, then reload Reseller sourcing. Maps and tables need Bases.' });
    el.createEl('p', { text: 'No other community plugin is required. Web Clipper is optional for Google Maps capture.' });
    if (!Platform.isMobileApp) external(this.plugin, el, 'Install Obsidian Web Clipper', 'https://obsidian.md/clipper');
    const results = el.createDiv({ attr: { role: 'status' } });
    if (!this.plugin.settings.setupVersion) button(el, 'Use existing notebook', () => { this.close(); new AttachNotebookModal(this.plugin).open(); });
    button(el, this.plugin.settings.setupVersion ? 'Repair components' : 'Create notebook', async () => {
      const report = await this.plugin.runRootOperation(() => this.plugin.store.setup());
      results.setText('Created ' + report.created.length + ', updated ' + report.updated.length + '. ' + (report.conflicts.length ? 'Your edited files were kept: ' + report.conflicts.join(', ') : 'Components are ready.'));
      await this.plugin.openFile(this.plugin.store.root + '/Home.md');
      this.close(); if (!Platform.isMobileApp) this.plugin.openClipperSetup();
    }, !this.plugin.settings.setupVersion);
    const clipper = details(el, Platform.isMobileApp ? 'Desktop capture' : 'Google Maps capture with Web Clipper');
    clipper.createEl('p', { text: Platform.isMobileApp ? 'Configure clipping on desktop, then sync the source notes here. Android supports manual source and parking entry in this version.' : 'Use the import guide to copy current versioned templates, follow the browser steps and confirm each import. The guide is also available on Home and in the command palette.' });
    button(clipper, Platform.isMobileApp ? 'Desktop capture help' : 'Set up / update Web Clipper', () => { this.close(); this.plugin.openClipperSetup(); });
    button(el, 'About / Credits', () => new CreditsModal(this.plugin).open());
  }
}
export class CreditsModal extends Modal {
  constructor(private plugin: NotebookContext) { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    this.titleEl.setText('Reseller sourcing — about / credits'); renderContextBanner(this.plugin, this.contentEl);
    this.contentEl.createEl('p', { text: 'Version ' + this.plugin.manifest.version + '. No paid API, telemetry or background capture service.' });
    this.contentEl.createEl('p', { text: 'Map view adapted from Obsidian Maps 0.2.2, © 2025 Obsidian, MIT licence. Pinned commit 8703e98013fa20fb188746d24664452f41b17227. Modified for sourcing notes, linked parking, map placement, padding, lifecycle handling and MapLibre GL JS 6.' });
    external(this.plugin, this.contentEl, 'Upstream Obsidian Maps source', 'https://github.com/obsidianmd/obsidian-maps/tree/8703e98013fa20fb188746d24664452f41b17227');
    this.contentEl.createEl('p', { text: 'MapLibre GL JS: BSD-3-Clause. YAML: ISC. Complete licences, notices and modification details are included below, including when installed through community plugins.' });
    const legal = details(this.contentEl, 'Full licences and third-party notices');
    button(legal, 'Copy full notices', () => copyTextOrShow(this.plugin.app, THIRD_PARTY_NOTICES, 'Third-party notices'));
    legal.createEl('pre', { text: THIRD_PARTY_NOTICES, cls: 'charity-license-text' });
    external(this.plugin, this.contentEl, 'OpenFreeMap', 'https://openfreemap.org');
    external(this.plugin, this.contentEl, 'OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright');
    this.contentEl.createEl('p', { text: 'Map tiles load from OpenFreeMap by default. Google links open the selected destination externally. Source information and visit notes are stored in your vault.' });
  }
}

export class ChangeAreaModal extends Modal {
  constructor(private plugin: NotebookContext, private path: string) { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    this.titleEl.setText('Change area'); this.modalEl.addClass('charity-change-area-modal');
    void this.render().catch(e => this.contentEl.createEl('p', { text: errorText(e), cls: 'charity-error' }));
  }
  private async render(): Promise<void> {
    const [areas, places] = await Promise.all([this.plugin.store.listLocalities(), this.plugin.store.listPlaces()]);
    const place = places.find(value => value.path === this.path);
    if (!place) throw Error('This source or parking note is no longer available.');
    const el = this.contentEl; renderContextBanner(this.plugin, el);
    el.createEl('p', { text: 'Move this place to another town or locality. Linked notes and parking associations are updated; your visits and assessment stay with it.' });
    let preview: Awaited<ReturnType<typeof this.plugin.store.previewPlaceAreaChange>> | undefined;
    const previewEl = el.createDiv('charity-move-preview');
    const area = new AreaEditor(this.plugin, areas, areaSelectionFor(place.locality, areas), () => { preview = undefined; previewEl.empty(); }, '', false);
    area.mount(el); el.appendChild(previewEl);
    button(el, 'Preview area change', async () => {
      previewEl.empty(); preview = await this.plugin.store.previewPlaceAreaChange(this.path, area.confirmedValue());
      renderMovePreview(previewEl, preview);
      const target = preview.files.find(file => file.from === this.path)?.to;
      if (target) previewEl.createEl('p', { text: 'Destination: ' + target, cls: 'charity-destination' });
      if (preview.creations?.length) previewEl.createEl('p', { text: 'Create missing area components: ' + preview.creations.join(', '), cls: 'charity-hint' });
      if (!preview.conflicts.length) button(previewEl, 'Apply area change', async () => {
        const report = await this.plugin.runRootOperation(() => this.plugin.store.changePlaceArea(this.path, area.confirmedValue(), preview));
        this.close(); await this.plugin.openFile(target ?? this.path);
        new Notice('Area changed. Recovery backup: ' + report.backupRoot, 10000);
      }, true);
    });
  }
}
export class AreaHintsModal extends Modal {
  constructor(private plugin: NotebookContext) { super(plugin.app); }
  onOpen(): void { markInputModal(this); this.titleEl.setText('Remembered address rules'); void this.render().catch(e => this.contentEl.createEl('p', { text: errorText(e), cls: 'charity-error' })); }
  private async render(): Promise<void> {
    const areas = await this.plugin.store.listLocalities(); const el = this.contentEl; el.empty(); renderContextBanner(this.plugin, el);
    el.createEl('p', { text: 'These rules suggest an area when an address contains a saved phrase within its town. Conflicting rules require a choice; no notes are moved automatically.' });
    if (!this.plugin.settings.areaHints.length) el.createEl('p', { text: 'No remembered rules yet. During capture, confirm an area and choose to remember its address phrase.', cls: 'charity-empty-state' });
    for (const hint of this.plugin.settings.areaHints) {
      const target = areas.find(area => area.path === (hint.localityPath || hint.townPath));
      const row = new Setting(el).setName(hint.phrase).setDesc(target?.label ?? 'Saved target is missing — edit or remove this rule.');
      row.addToggle(t => t.setValue(hint.enabled).setTooltip('Enabled').onChange(async enabled => {
        try { await this.plugin.store.saveAreaHint({ ...hint, enabled }); }
        catch (e) { t.setValue(hint.enabled); new Notice(errorText(e)); }
      }));
      row.addButton(b => b.setButtonText('Edit').onClick(() => new AreaHintEditModal(this.plugin, hint, () => this.render()).open()));
      row.addButton(b => b.setButtonText('Remove').onClick(async () => {
        try { await this.plugin.store.removeAreaHint(hint.id); await this.render(); }
        catch (e) { new Notice(errorText(e)); }
      }));
    }
    button(el, 'Add address rule', () => new AreaHintEditModal(this.plugin, undefined, () => this.render()).open());
  }
}
class AreaHintEditModal extends Modal {
  constructor(private plugin: NotebookContext, private hint?: AreaHint, private done?: () => Promise<void>) { super(plugin.app); }
  onOpen(): void { markInputModal(this);
    this.titleEl.setText(this.hint ? 'Edit address rule' : 'New address rule');
    void this.render().catch(e => this.contentEl.createEl('p', { text: errorText(e), cls: 'charity-error' }));
  }
  private async render(): Promise<void> {
    const areas = await this.plugin.store.listLocalities(), el = this.contentEl; renderContextBanner(this.plugin, el);
    let phrase = this.hint?.phrase ?? '', enabled = this.hint?.enabled ?? true;
    new Setting(el).setName('Address phrase').addText(t => { t.inputEl.setAttribute('aria-label', 'Address phrase'); t.setValue(phrase).onChange(v => phrase = v); });
    const area = new AreaEditor(this.plugin, areas, areaSelectionFor(this.hint?.localityPath || this.hint?.townPath || '', areas), () => {}, '', false);
    area.mount(el);
    el.createEl('p', { text: 'Choose saved areas for a rule. New areas are created when you save a source or parking location.', cls: 'charity-hint' });
    new Setting(el).setName('Enabled').addToggle(t => t.setValue(enabled).onChange(v => enabled = v));
    const status = el.createDiv({ cls: 'charity-error', attr: { role: 'alert' } });
    button(el, 'Save rule', async () => {
      try {
        const selected = area.confirmedValue();
        if (!selected.townPath || (selected.locality && !selected.localityPath)) throw Error('Choose a saved town and locality for this rule.');
        await this.plugin.store.saveAreaHint({ id: this.hint?.id ?? crypto.randomUUID(), phrase: phrase.trim(), townPath: selected.townPath, localityPath: selected.localityPath || selected.townPath, enabled });
        await this.done?.(); this.close();
      } catch (e) { status.setText(errorText(e)); }
    }, true);
  }
}

/** Settings here belong to the practice store and are persisted by its captured context. */

type PracticeSettingsField = 'defaultType' | 'sourceTypes' | 'radius' | 'tiles' | 'distanceUnit';
interface PracticeSettingsDraft {
  root: string;
  defaultType: string;
  sourceTypes: string;
  radius: string;
  radiusKm: number;
  distanceUnit: DistanceUnit;
  tiles: NotebookContext['settings']['tileSets'];
  dirty: Set<PracticeSettingsField>;
  status: string;
  error: boolean;
  saving: boolean;
  disposed: boolean;
  detached: boolean;
  finishEditing?: () => void;
  ownerHasLifecycle: boolean;
  refreshUi?: () => void;
}
const practiceSettingsDrafts = new WeakMap<object, PracticeSettingsDraft>();

/** Detach a vanished context without discarding its unsaved draft. Pending writes keep their guard until settled. */
export function releasePracticeSettingsOwner(owner: object): void {
  const state = practiceSettingsDrafts.get(owner); if (!state) return;
  state.detached = true; state.refreshUi = undefined;
  if (!state.saving) { state.finishEditing?.(); state.finishEditing = undefined; }
}

export async function renderPracticeSettings(plugin: NotebookContext, el: HTMLElement, draftOwner: object = el): Promise<void> {
  if (plugin.kind !== 'examples') throw Error('Practice settings belong to an examples notebook.');
  renderContextBanner(plugin, el);
  el.createEl('h3', { text: 'Practice settings' });
  el.createEl('p', { text: 'These defaults, backgrounds and remembered address rules apply only to examples. Your real notebook settings stay as configured.', cls: 'charity-hint' });
  if (plugin.store.migrationActive) {
    releasePracticeSettingsOwner(draftOwner);
    const recovery = el.createDiv('charity-empty-state');
    recovery.createEl('p', { text: 'A practice organisation change needs recovery before editing can continue.', cls: 'charity-error' });
    const status = recovery.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    button(recovery, 'Restore previous organisation', async () => {
      try {
        await plugin.runRootOperation(() => plugin.store.rollbackMove(), true);
        status.setText('Previous practice organisation restored. Reopen practice settings to continue.');
      } catch (error) { status.setText('Not restored: ' + errorText(error)); status.addClass('charity-error'); }
    }, true);
    renderExamplesReference(plugin, el); return;
  }
  let draft = practiceSettingsDrafts.get(draftOwner);
  if (!draft || draft.root !== plugin.root) {
    if (draft) { releasePracticeSettingsOwner(draftOwner); draft.disposed = true; }
    const owner = draftOwner as { register?: (callback: () => void) => void };
    draft = { root: plugin.root, defaultType: '', sourceTypes: '', radius: '', radiusKm: 1, distanceUnit: 'miles', tiles: [], dirty: new Set(), status: '', error: false, saving: false, disposed: false, detached: false, ownerHasLifecycle: typeof owner.register === 'function' };
    practiceSettingsDrafts.set(draftOwner, draft);
    const created = draft;
    owner.register?.(() => {
      created.disposed = true;
      if (!created.saving) { created.finishEditing?.(); created.finishEditing = undefined; }
      if (practiceSettingsDrafts.get(draftOwner) === created) practiceSettingsDrafts.delete(draftOwner);
    });
  }
  const state = draft; state.detached = false;
  if (state.ownerHasLifecycle && state.dirty.size && !state.finishEditing && !state.saving) state.finishEditing = plugin.beginEditing();
  if (!state.dirty.has('defaultType')) state.defaultType = plugin.settings.defaultSourceType;
  if (!state.dirty.has('sourceTypes')) state.sourceTypes = plugin.settings.sourceTypes.join('\n');
  if (!state.dirty.has('distanceUnit')) state.distanceUnit = normaliseDistanceUnit(plugin.settings.distanceUnit);
  if (!state.dirty.has('radius')) {
    state.radiusKm = plugin.settings.suggestionKm;
    state.radius = String(Number(distanceFromKm(state.radiusKm, state.distanceUnit).toFixed(3)));
  }
  if (!state.dirty.has('tiles')) state.tiles = structuredClone(plugin.settings.tileSets);
  const changed = (field: PracticeSettingsField) => {
    state.dirty.add(field);
    if (state.ownerHasLifecycle && !state.finishEditing) state.finishEditing = plugin.beginEditing();
  };
  const feedback = (text: string, error = false) => {
    state.status = text; state.error = error; state.refreshUi?.();
  };
  const options = el.createEl('datalist', { attr: { id: 'sourcing-practice-default-' + crypto.randomUUID() } });
  for (const value of [...new Set([...plugin.settings.sourceTypes, plugin.settings.defaultSourceType, state.defaultType])]) options.createEl('option', { value });
  new Setting(el).setName('Default source type').setDesc('Used for new practice sources without an explicit captured type.').addText(control => {
    control.inputEl.setAttribute('aria-label', 'Practice default source type'); control.inputEl.setAttribute('list', options.id);
    control.setValue(state.defaultType).onChange(value => { state.defaultType = value; changed('defaultType'); });
  });
  new Setting(el).setName('Source types').setDesc('One suggestion per line. The configured default remains selectable.').addTextArea(control => {
    control.inputEl.rows = 5; control.inputEl.setAttribute('aria-label', 'Practice source types');
    control.setValue(state.sourceTypes).onChange(value => { state.sourceTypes = value; changed('sourceTypes'); });
  });
  let refreshRadiusDisplay = () => {};
  new Setting(el).setName('Distance units').setDesc('This choice affects only the practice notebook.').addDropdown(control => {
    control.selectEl.setAttribute('aria-label', 'Practice distance units');
    control.addOption('miles', 'Miles').addOption('km', 'Kilometres').setValue(state.distanceUnit).onChange(value => {
      state.distanceUnit = normaliseDistanceUnit(value); changed('distanceUnit');
      if (Number.isFinite(state.radiusKm)) state.radius = String(Number(distanceFromKm(state.radiusKm, state.distanceUnit).toFixed(3)));
      refreshRadiusDisplay();
    });
  });
  const radiusSetting = new Setting(el).setDesc('Practice suggestions only; you always choose the area.');
  radiusSetting.addText(control => {
    control.inputEl.type = 'number'; control.inputEl.step = 'any';
    control.inputEl.setAttribute('aria-label', 'Practice nearby locality radius');
    control.setValue(state.radius).onChange(value => {
      state.radius = value; state.radiusKm = value.trim() ? distanceToKm(Number(value), state.distanceUnit) : NaN; changed('radius');
    });
    refreshRadiusDisplay = () => {
      radiusSetting.setName('Nearby locality radius (' + state.distanceUnit + ')');
      control.inputEl.min = String(distanceFromKm(.1, state.distanceUnit)); control.inputEl.max = String(distanceFromKm(50, state.distanceUnit));
      control.setValue(state.radius);
    };
    refreshRadiusDisplay();
  });
  new Setting(el).setName('Remembered address rules').setDesc('Edit, disable or remove practice rules without changing your real address rules.')
    .addButton(control => control.setButtonText('Manage practice address rules').onClick(() => new AreaHintsModal(plugin).open()));
  const backgrounds = details(el, 'Practice map backgrounds');
  backgrounds.createEl('p', { text: 'Default: free OpenFreeMap and OpenStreetMap. Custom backgrounds accept a style URL or {z}/{x}/{y} raster URL. Reopen maps after saving changes.', cls: 'charity-hint' });
  const rows = backgrounds.createDiv();
  const renderTiles = () => {
    rows.empty();
    for (const tile of state.tiles) {
      const row = rows.createDiv('charity-tile-settings');
      new Setting(row).setName('Name').addText(control => control.setValue(tile.name).onChange(value => { tile.name = value; changed('tiles'); }));
      for (const [key, label] of [['lightTiles', 'Light tiles'], ['darkTiles', 'Dark tiles']] as const)
        new Setting(row).setName(label).addText(control => control.setValue(tile[key]).onChange(value => { tile[key] = value.trim(); changed('tiles'); }));
      button(row, 'Remove background', () => { state.tiles = state.tiles.filter(value => value.id !== tile.id); changed('tiles'); renderTiles(); });
    }
  };
  renderTiles();
  button(backgrounds, 'Add custom background', () => { state.tiles.push({ id: crypto.randomUUID(), name: 'Custom', lightTiles: '', darkTiles: '' }); changed('tiles'); renderTiles(); });
  const footer = el.createDiv('charity-modal-footer');
  const status = footer.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
  button(footer, 'Save practice settings', async () => {
    if (state.saving) return;
    const value = state.defaultType.trim(), values = [...new Set(state.sourceTypes.split('\n').map(value => value.trim()).filter(Boolean))], distance = state.radiusKm;
    if (!value || value.length > 80 || /[\r\n]/.test(value)) { feedback('Enter a default source type of 1 to 80 characters.', true); return; }
    if (!values.length || values.some(value => value.length > 80)) { feedback('Keep at least one source type, with up to 80 characters per type.', true); return; }
    if (!Number.isFinite(distance) || distance < .1 || distance > 50) { feedback('Use a radius from ' + distanceFromKm(.1, state.distanceUnit) + ' to ' + distanceFromKm(50, state.distanceUnit) + ' ' + state.distanceUnit + '.', true); return; }
    const hadLease = !!state.finishEditing, finish = state.finishEditing ?? plugin.beginEditing(); if (!finish) return;
    const before = { defaultSourceType: plugin.settings.defaultSourceType, sourceTypes: plugin.settings.sourceTypes, suggestionKm: plugin.settings.suggestionKm, distanceUnit: plugin.settings.distanceUnit, tileSets: plugin.settings.tileSets };
    let saved = false; state.saving = true; state.refreshUi?.();
    try {
      Object.assign(plugin.settings, { defaultSourceType: value, sourceTypes: [...new Set([...values, value])], suggestionKm: distance, distanceUnit: state.distanceUnit, tileSets: structuredClone(state.tiles) });
      await plugin.saveSettings(); saved = true; state.dirty.clear();
      feedback('Practice settings saved. Reopen maps to use changed backgrounds.');
    } catch (error) {
      Object.assign(plugin.settings, before); feedback('Practice settings were not saved: ' + errorText(error), true);
    } finally {
      state.saving = false;
      if ((saved || state.disposed || state.detached) && state.finishEditing) { state.finishEditing(); state.finishEditing = undefined; }
      else if (!hadLease) finish();
      state.refreshUi?.();
    }
  }, true);
  renderExamplesReference(plugin, el);
  state.refreshUi = () => {
    if (state.disposed) return;
    status.setText(state.status); if (state.error) status.addClass('charity-error'); else status.removeClass('charity-error');
    for (const input of Array.from(el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input,textarea,select,button'))) input.disabled = state.saving;
  };
  state.refreshUi();
}
