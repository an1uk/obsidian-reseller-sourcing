import { Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { LocalityRecord, PlaceRecord } from '../types';
import type { PlanningHours } from '../outings/types';
import type { OutingPreparation } from '../workspace/types';
import { PreparationModal } from '../workspace/preparation-modal';
import { buildShortTripPreview, defaultShortTripOptions, shortTripForm, shortTripHoursSources, type ShortTripForm, type ShortTripOptions, type ShortTripPreview } from '../outings/short-trip';
import { formatPlanningTime } from '../outings/planning';
import { validateCoordinates } from '../domain/coordinates';
import { formatDistance, normaliseDistanceUnit } from '../units';
import { button, details, PickModal } from '../ui';

/** An optional recommendation becomes an ordinary saved preparation only after explicit review. */
export class ShortTripModal extends PreparationModal<OutingPreparation> {
  private places: PlaceRecord[] = [];
  private areas: LocalityRecord[] = [];
  private previewEl?: HTMLElement;
  private useButton?: HTMLButtonElement;
  private suggestButton?: HTMLButtonElement;
  private comparison?: ShortTripPreview;
  private generation = 0;
  constructor(context: NotebookContext, private onUse: (draftId: string) => Promise<void> | void, draftId?: string, criteria?: { areaPath?: string; shortlist?: boolean }) {
    const shortTrip = defaultShortTripOptions();
    shortTrip.areaPath = criteria?.areaPath ?? ''; shortTrip.shortlist = criteria?.shortlist ?? false;
    super(context, 'outing', { name: '', groups: [], step: 1, unresolved: [], shortTrip,
      filter: { text: '', area: shortTrip.areaPath, shortlist: shortTrip.shortlist, type: '', view: 'list' } }, draftId);
  }
  protected meaningful(): boolean { return !!this.draft.data.shortTrip || !!this.draft.data.groups.length; }
  protected footer(): HTMLElement {
    const footer = super.footer();
    if (this.draft.phase === 'editing') {
      const close = footer.querySelector('button');
      this.useButton = footer.createEl('button', { text: 'Use suggestion', cls: 'mod-cta' });
      this.useButton.onclick = () => { void this.finish(); };
      footer.insertBefore(this.useButton, close);
      this.reviewed(!!this.comparison?.estimate && !this.comparison.blockers.length);
    }
    return footer;
  }
  private reviewed(value: boolean): void {
    if (this.useButton) this.useButton.disabled = !value;
    this.suggestButton?.toggleClass('mod-cta', !value);
  }
  private options(): ShortTripOptions {
    const options = this.draft.data.shortTrip;
    if (!options) throw Error('This suggestion has already moved to outing preparation. Reopen the saved preparation.');
    options.form ??= shortTripForm(options); return options;
  }
  private edited(): void {
    this.generation++; this.comparison = undefined; this.previewEl?.empty();
    this.reviewed(false);
    this.changed();
  }
  private async redraw(): Promise<void> { this.edited(); await this.render(); }
  async renderStep(): Promise<void> {
    const token = ++this.generation;
    const [places, areas] = await Promise.all([this.context.store.listPlaces(), this.context.store.listLocalities()]);
    if (this.closed || token !== this.generation) return;
    this.places = places; this.areas = areas;
    const options = this.options(), form = options.form!;
    this.titleEl.setText('I have about an hour');
    this.contentEl.createEl('p', { text: 'Choose your start and available time. Review one small driving journey before preparing an outing.', cls: 'charity-hint' });
    this.number(this.contentEl, 'Available minutes', form.budgetMinutes, value => { form.budgetMinutes = value; this.edited(); }, 1, 1440);
    const budgets = this.contentEl.createDiv('charity-actions');
    for (const minutes of [30, 60, 90, 120]) button(budgets, minutes + ' minutes', () => { form.budgetMinutes = String(minutes); return this.redraw(); }).setAttribute('aria-pressed', String(form.budgetMinutes === String(minutes)));
    this.startingPoint(form);
    const area = options.areaPath === 'unassigned' ? 'Unassigned' : this.areas.find(item => item.path === options.areaPath)?.label ?? (options.areaPath ? 'Area unavailable' : 'All areas');
    const selection = this.contentEl.createDiv('charity-actions');
    button(selection, area, () => new PickModal(this.context, [{ path: '', label: 'All areas' }, { path: 'unassigned', label: 'Unassigned' }, ...this.areas],
      item => item.label, item => { options.areaPath = item.path; return this.redraw(); }, 'Sources to consider').open());
    const shortlist = button(selection, 'Shortlist only', () => { options.shortlist = !options.shortlist; return this.redraw(); }); shortlist.setAttribute('aria-pressed', String(options.shortlist));
    this.text(this.contentEl, 'Outing date', form.date, value => { form.date = value; this.edited(); }, 'date');
    this.text(this.contentEl, 'Departure time', form.departureTime, value => { form.departureTime = value; this.edited(); }, 'time');
    this.text(this.contentEl, 'Time zone', form.timeZone, value => { form.timeZone = value; this.edited(); });
    const assumptions = details(this.contentEl, 'Adjust the small journey');
    this.number(assumptions, 'Maximum stops', form.maxStops, value => { form.maxStops = value; this.edited(); }, 1, 5);
    this.number(assumptions, 'Minutes per source', form.visitMinutes, value => { form.visitMinutes = value; this.edited(); }, 1, 1440);
    new Setting(assumptions).setName('Return to starting point').addToggle(control => control.setValue(options.planning.end.kind === 'return').onChange(value => {
      options.planning.end = { kind: value ? 'return' : 'last' }; this.edited();
    }));
    this.contentEl.createEl('p', { text: 'Only sources with usable coordinates and a single or preferred saved parking location can be suggested. Missing or uncertain parking needs a choice in standard outing preparation.', cls: 'charity-hint' });
    this.suggestButton = button(this.contentEl, 'Suggest a small journey', () => this.preview(), true);
    this.previewEl = this.contentEl.createDiv({ cls: 'charity-short-trip-preview', attr: { 'aria-live': 'polite' } });
    // The initial time and location method are meaningful work even before the first keystroke.
    this.changed();
  }
  private startingPoint(form: ShortTripForm): void {
    const el = this.contentEl.createEl('section');
    const method = new Setting(el).setName('Starting point');
    button(method.settingEl, form.startKind === 'record' ? 'Saved source or parking' : 'Entered coordinates', () => new PickModal(this.context,
      [{ kind: 'record' as const, label: 'Choose a saved source or parking' }, { kind: 'coordinates' as const, label: 'Enter coordinates' }],
      item => item.label, item => { form.startKind = item.kind; return this.redraw(); }, 'Starting point method').open()).setAttribute('aria-label', 'Starting point method');
    if (form.startKind === 'record') {
      const counts = new Map<string, number>(); for (const place of this.places) counts.set(place.path, (counts.get(place.path) ?? 0) + 1);
      const choices = this.places.filter(place => counts.get(place.path) === 1 && validateCoordinates(place.coordinates)).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
      const selected = choices.find(place => place.path === form.savedPath);
      const saved = new Setting(el).setName('Saved starting point');
      button(saved.settingEl, selected?.name ?? (form.savedPath ? 'Saved starting point unavailable' : 'Choose a starting point'), () => new PickModal(this.context, choices,
        place => place.name + (place.kind === 'parking' ? ' (parking)' : ' (source)'), place => { form.savedPath = place.path; return this.redraw(); }, 'Saved starting point').open()).setAttribute('aria-label', 'Saved starting point');
    } else {
      this.text(el, 'Starting latitude', form.latitude, value => { form.latitude = value; this.edited(); });
      this.text(el, 'Starting longitude', form.longitude, value => { form.longitude = value; this.edited(); });
      el.createEl('p', { text: 'Enter latitude, then longitude. Your device location is never requested.', cls: 'charity-hint' });
    }
  }
  private text(parent: HTMLElement, name: string, value: string, change: (value: string) => void, type = 'text'): void {
    new Setting(parent).setName(name).addText(control => {
      control.inputEl.type = type; control.inputEl.setAttribute('aria-label', name); control.setValue(value).onChange(change);
    });
  }
  private number(parent: HTMLElement, name: string, value: string, change: (value: string) => void, min: number, max: number): void {
    new Setting(parent).setName(name).addText(control => {
      control.inputEl.type = 'number'; control.inputEl.min = String(min); control.inputEl.max = String(max); control.inputEl.step = '1';
      control.inputEl.setAttribute('aria-label', name); control.setValue(value).onChange(change);
    });
  }
  private async fresh(options: ShortTripOptions): Promise<{ preview: ShortTripPreview; places: PlaceRecord[] }> {
    const [places, areas] = await Promise.all([this.context.store.listPlaces(), this.context.store.listLocalities()]);
    const sources = shortTripHoursSources(places, areas, options);
    const hours: Record<string, PlanningHours> = await this.context.store.outings.planningHours({ groups: [{ id: 'short-trip-hours', parkingPath: '',
      stops: sources.map(source => ({ id: 'short-trip:source:' + source.path, sourcePath: source.path, status: 'pending' })) }] });
    return { preview: buildShortTripPreview(places, areas, hours, options), places };
  }
  private drawPreview(preview: ShortTripPreview, places: PlaceRecord[]): void {
    const el = this.previewEl; if (!el) return; el.empty();
    const name = (path: string) => places.find(place => place.path === path)?.name ?? path;
    if (preview.estimate) {
      const estimate = preview.estimate;
      el.createEl('h3', { text: preview.groups.flatMap(group => group.stops).length + ' source(s) in about ' + Math.ceil(estimate.totalMinutes) + ' minutes' });
      el.createEl('p', { text: formatDistance(estimate.totalKm, normaliseDistanceUnit(this.context.settings.distanceUnit)) + ' estimated; finish about ' + formatPlanningTime(estimate.finishAt, preview.planning) });
      el.createEl('p', { text: preview.planning.date + ' at ' + preview.planning.departureTime + ' (' + preview.planning.timeZone + ')' });
      const list = el.createEl('ol');
      for (const group of preview.groups) list.createEl('li', { text: 'Drive to ' + name(group.parkingPath) + '; walk to ' + group.stops.map(stop => name(stop.sourcePath)).join(', ') + '; return to the car.' });
      if (preview.planning.end.kind === 'return') el.createEl('p', { text: 'Return drive to your starting point is included.' });
      else el.createEl('p', { text: 'Ends at the final parking location. No return drive to your starting point is included.' });
      for (const stop of estimate.timeline) el.createEl('p', { text: name(stop.sourcePath) + ': ' + (stop.hoursStatus === 'unconfirmed' ? 'Hours unconfirmed' : 'Visit fits captured hours') + (stop.hoursChecked ? ' (checked ' + stop.hoursChecked + ')' : '') + '.' });
    }
    for (const warning of preview.warnings) el.createEl('p', { text: warning, cls: 'charity-hint' });
    for (const blocker of preview.blockers) el.createEl('p', { text: blocker, cls: 'charity-error' });
    this.reviewed(!!preview.estimate && !preview.blockers.length);
  }
  private async preview(): Promise<void> {
    if (this.busy || this.closed) return;
    const options = structuredClone(this.options()), token = ++this.generation;
    this.setBusy(true); this.comparison = undefined; this.reviewed(false);
    this.status?.setText('Preparing suggestion...');
    try {
      const fresh = await this.fresh(options);
      if (this.closed || token !== this.generation) return;
      this.comparison = fresh.preview; this.drawPreview(fresh.preview, fresh.places);
      this.status?.setText(fresh.preview.estimate ? 'Review the suggestion, then choose Use suggestion.' : 'Adjust these choices to try again.');
    } catch (error) { if (!this.closed && token === this.generation) this.failure(error); }
    finally { if (!this.closed) this.setBusy(false); }
  }
  protected async finish(): Promise<void> {
    const reviewed = this.comparison;
    if (this.busy || this.closed || !reviewed?.estimate || reviewed.blockers.length) return;
    const token = ++this.generation; this.setBusy(true);
    try {
      const fresh = await this.fresh(structuredClone(this.options()));
      if (this.closed || token !== this.generation) return;
      if (fresh.preview.fingerprint !== reviewed.fingerprint) {
        this.comparison = undefined; this.drawPreview(fresh.preview, fresh.places); this.reviewed(false);
        this.status?.setText('Places, parking or hours changed. Request a fresh suggestion and review it before continuing.'); return;
      }
      if (!fresh.preview.estimate || fresh.preview.blockers.length) throw Error('This journey is no longer available. Request another suggestion.');
      const before = structuredClone(this.draft.data), data = this.draft.data, result = fresh.preview;
      data.groups = structuredClone(result.groups); data.planning = structuredClone(result.planning); data.step = 2; data.unresolved = [];
      data.filter.area = result.options.areaPath; data.filter.shortlist = result.options.shortlist;
      data.reviewWarnings = ['Short-trip suggestion: about ' + Math.ceil(result.estimate!.totalMinutes) + ' minutes of ' + result.options.budgetMinutes + ' available; ' +
        formatDistance(result.estimate!.totalKm, normaliseDistanceUnit(this.context.settings.distanceUnit)) + ' estimated. Recheck estimates after changing this journey.', ...result.warnings];
      delete data.shortTrip;
      this.setBusy(false); this.changed();
      await this.closeAndContinue(() => this.onUse(this.draft.id));
      if (!this.closed) { this.draft.data = before; this.changed(); }
    } catch (error) { this.failure(error); }
    finally { if (!this.closed) this.setBusy(false); }
  }
  onClose(): void { this.generation++; super.onClose(); }
}
