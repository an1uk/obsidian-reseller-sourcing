import { Setting, SuggestModal } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { AreaSelection, LocalityRecord } from '../types';
import { getAddressHints, matchAreaHints } from '../capture';

const normalized = (value: string): string => value.trim().normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function areaSelectionFor(path: string, areas: LocalityRecord[]): AreaSelection {
  const locality = areas.find(area => area.path === path);
  if (!locality) return { town: '', locality: '' };
  const town = areas.find(area => !area.parentPath && area.segments[0] === locality.segments[0]);
  if (!town) return { town: '', locality: '' };
  return { town: town.name, townPath: town.path, locality: locality.path === town.path ? '' : locality.name, ...(locality.path === town.path ? {} : { localityPath: locality.path }) };
}
export function selectedAreaPath(value: AreaSelection): string { return value.locality ? value.localityPath ?? '' : value.townPath ?? ''; }
export function areaSegments(value: AreaSelection, areas: LocalityRecord[]): string[] {
  const selected = areas.find(area => area.path === selectedAreaPath(value));
  if (selected) return selected.segments;
  return [value.town.trim(), value.locality.trim()].filter(Boolean);
}
class AreaPicker extends SuggestModal<LocalityRecord> {
  constructor(plugin: NotebookContext, private areas: LocalityRecord[], private choose: (area: LocalityRecord) => void, title: string) { super(plugin.app); this.setPlaceholder(plugin.kind === 'examples' ? 'Examples: ' + title : title); }
  getSuggestions(query: string): LocalityRecord[] { return this.areas.filter(area => normalized(area.label).includes(normalized(query))); }
  renderSuggestion(area: LocalityRecord, el: HTMLElement): void { el.setText(area.label); }
  onChooseSuggestion(area: LocalityRecord): void { this.choose(area); }
}

/** Staged form state: it never creates or modifies a locality. */
export class AreaEditor {
  private selection: AreaSelection;
  private townEdited: boolean;
  private localityEdited: boolean;
  private conflictPending = false;
  private townInput?: HTMLInputElement;
  private localityInput?: HTMLInputElement;
  private localityOptions?: HTMLDataListElement;
  private localityPicker?: import('obsidian').ButtonComponent;
  private evidence?: HTMLElement;
  private staged?: HTMLElement;
  private explanation = '';
  private address = '';
  constructor(private plugin: NotebookContext, private areas: LocalityRecord[], initial: AreaSelection, private changed: () => void, address = '', private suggest = true) {
    this.selection = { ...initial };
    this.townEdited = !!initial.town;
    this.localityEdited = !!initial.town;
    this.address = address;
    this.applyHints();
  }
  get value(): AreaSelection {
    const town = this.areas.find(area => area.path === this.selection.townPath);
    const locality = this.areas.find(area => area.path === this.selection.localityPath);
    return { ...this.selection, town: town?.name ?? this.selection.town, locality: locality?.name ?? this.selection.locality };
  }
  confirmedValue(): AreaSelection {
    const value = this.value;
    if (!value.town.trim()) throw Error('Enter or choose the town / parent area.');
    if (this.conflictPending) throw Error('Several remembered address rules match. Choose a locality or select Use town only before saving.');
    const matching = this.areas.filter(area => this.belongs(area, value.townPath) && area.name.trim().toLocaleLowerCase() === value.locality.trim().toLocaleLowerCase());
    if (value.locality && !value.localityPath && matching.length > 1) throw Error('Several saved areas have that name. Use Choose saved area to select the correct hierarchy.');
    return value;
  }
  mount(parent: HTMLElement): void {
    const wrap = parent.createDiv('charity-area-editor');
    const townList = wrap.createEl('datalist', { attr: { id: 'sourcing-town-' + crypto.randomUUID() } });
    for (const area of this.areas.filter(area => !area.parentPath)) townList.createEl('option', { value: area.name });
    const town = new Setting(wrap).setName('Town / parent area').setDesc('Required. Choose a saved town or type a new town name.');
    town.addText(t => {
      this.townInput = t.inputEl; t.inputEl.addClass('charity-area-town');
      t.inputEl.setAttribute('aria-label', 'Town / parent area'); t.inputEl.setAttribute('list', townList.id);
      t.setPlaceholder('Exampletown').setValue(this.selection.town).onChange(value => {
        this.townEdited = true; this.selection.town = value;
        this.selection.townPath = this.matchTown(value)?.path;
        const child = this.areas.find(area => area.path === this.selection.localityPath);
        if (!child || !this.belongs(child, this.selection.townPath)) {
          this.selection.localityPath = undefined;
          if (!this.localityEdited) this.selection.locality = '';
        }
        this.applyHints(); this.sync(); this.changed();
      });
    });
    town.addButton(b => b.setButtonText('Choose saved town').setDisabled(!this.areas.some(area => !area.parentPath)).onClick(() => new AreaPicker(this.plugin, this.areas.filter(area => !area.parentPath), area => {
      this.townEdited = true; this.selection.town = area.name; this.selection.townPath = area.path;
      const child = this.areas.find(value => value.path === this.selection.localityPath);
      if (!child || !this.belongs(child, area.path)) { this.selection.localityPath = undefined; if (!this.localityEdited) this.selection.locality = ''; }
      this.applyHints(); this.sync(); this.changed();
    }, 'Search saved towns').open()));
    this.localityOptions = wrap.createEl('datalist', { attr: { id: 'sourcing-locality-' + crypto.randomUUID() } });
    const locality = new Setting(wrap).setName('Locality').setDesc('Optional. Leave blank for the town itself, or type a smaller area.');
    locality.addText(t => {
      this.localityInput = t.inputEl; t.inputEl.addClass('charity-area-locality');
      t.inputEl.setAttribute('aria-label', 'Locality'); t.inputEl.setAttribute('list', this.localityOptions!.id);
      t.setPlaceholder('Riverside (optional)').setValue(this.selection.locality).onChange(value => {
        if (this.selection.town.trim()) this.townEdited = true; this.localityEdited = true; this.conflictPending = false; this.selection.locality = value; this.selection.localityPath = this.matchLocality(value)?.path;
        this.explanation = ''; this.sync(); this.changed();
      });
    });
    locality.addButton(b => { this.localityPicker = b; b.setButtonText('Choose saved area').onClick(() => {
      const choices = this.areas.filter(area => area.parentPath && this.belongs(area, this.selection.townPath));
      new AreaPicker(this.plugin, choices, area => this.choose(area), 'Search saved areas in this town').open();
    }); });
    locality.addButton(b => b.setButtonText('Use town only').onClick(() => {
      if (this.selection.town.trim()) this.townEdited = true;
      this.localityEdited = true; this.conflictPending = false;
      this.selection.locality = ''; this.selection.localityPath = undefined;
      this.explanation = 'Town only selected. No child locality will be assigned.';
      this.sync(); this.changed();
    }));
    this.evidence = wrap.createDiv({ cls: 'charity-area-evidence', attr: { role: 'status', 'aria-live': 'polite' } });
    this.staged = wrap.createDiv('charity-hint charity-area-staged'); this.sync();
  }
  choose(area: LocalityRecord): void {
    this.selection = areaSelectionFor(area.path, this.areas); this.townEdited = true; this.localityEdited = true; this.conflictPending = false;
    this.explanation = 'Selected saved area: ' + area.label + '.'; this.sync(); this.changed();
  }
  setAddress(address: string): void { this.address = address; this.applyHints(); this.sync(); this.changed(); }
  private matchTown(name: string): LocalityRecord | undefined {
    const matches = this.areas.filter(area => !area.parentPath && area.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    return matches.length === 1 ? matches[0] : undefined;
  }
  private belongs(area: LocalityRecord, townPath?: string): boolean {
    const town = this.areas.find(value => value.path === townPath);
    return !!town && area.segments[0] === town.name && area.path !== town.path;
  }
  private matchLocality(name: string): LocalityRecord | undefined {
    const matches = this.areas.filter(area => this.belongs(area, this.selection.townPath) && area.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    return matches.length === 1 ? matches[0] : undefined;
  }
  private applyHints(): void {
    if (!this.suggest) return;
    const address = getAddressHints(this.address), messages: string[] = [];
    if (!this.townEdited) {
      this.selection.town = address.town;
      this.selection.townPath = this.matchTown(address.town)?.path;
      if (address.town) messages.push('Town suggested by the address: ' + address.town + '.');
    }
    if (!this.localityEdited) {
      this.conflictPending = false;
      this.selection.locality = '';
      this.selection.localityPath = undefined;
      const matches = this.selection.townPath ? matchAreaHints(this.address, this.selection.townPath, this.plugin.settings.areaHints, this.areas) : [];
      const unique = [...new Map(matches.map(hint => [hint.localityPath || hint.townPath, hint])).values()];
      if (unique.length === 1) {
        const hint = unique[0], target = this.areas.find(area => area.path === (hint.localityPath || hint.townPath));
        if (target) { this.selection = areaSelectionFor(target.path, this.areas); messages.push('Remembered address phrase “' + hint.phrase + '”: ' + target.label + '.'); }
      } else if (unique.length > 1) { this.conflictPending = true; messages.push('Several remembered address rules match. Choose a locality or Use town only; none has been selected automatically.'); }
      else if (address.locality && (!this.townEdited || normalized(address.town) === normalized(this.selection.town))) {
        const saved = this.matchLocality(address.locality);
        this.selection.locality = saved?.name ?? address.locality; this.selection.localityPath = saved?.path;
        messages.push('Locality suggested by the address: ' + address.locality + '.');
      }
    }
    this.explanation = messages.join(' ');
  }
  private sync(): void {
    if (this.townInput && this.townInput.value !== this.selection.town) this.townInput.value = this.selection.town;
    if (this.localityInput && this.localityInput.value !== this.selection.locality) this.localityInput.value = this.selection.locality;
    this.localityPicker?.setDisabled(!this.areas.some(area => this.belongs(area, this.selection.townPath)));
    this.localityOptions?.empty();
    for (const area of this.areas.filter(area => this.belongs(area, this.selection.townPath))) this.localityOptions?.createEl('option', { value: area.name, text: area.label });
    this.evidence?.setText(this.explanation);
    const staged: string[] = [];
    if (this.selection.town.trim() && !this.selection.townPath) staged.push(this.selection.town.trim());
    if (this.selection.locality.trim() && !this.selection.localityPath) staged.push([this.selection.town.trim(), this.selection.locality.trim()].filter(Boolean).join(' → '));
    this.staged?.setText(staged.length ? 'Created when you save: ' + staged.join('; ') + '.' : '');
    const matching = this.areas.filter(area => this.belongs(area, this.selection.townPath) && area.name.trim().toLocaleLowerCase() === this.selection.locality.trim().toLocaleLowerCase());
    if (this.selection.locality && !this.selection.localityPath && matching.length > 1) this.staged?.setText('Several saved areas have this name. Choose a saved area to select the correct hierarchy.');
    if (this.selection.localityPath) {
      const selected = this.areas.find(area => area.path === this.selection.localityPath);
      if (selected && selected.segments.length > 2) this.staged?.setText('Selected hierarchy: ' + selected.label + '.');
    }
  }
}
