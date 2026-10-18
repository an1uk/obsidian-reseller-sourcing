import { markInputModal } from './modal-layout';
import { Component, Modal, Notice, Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { Coordinates, PlaceRecord } from '../types';
import type { OutingGroup, OutingRecord, OutingPlanningOptions, OutingOptimisationPreview, PlanningAnchor } from '../outings/types';
import { buildOutingOptimisationPreview, defaultPlanningOptions, formatPlanningTime } from '../outings/planning';
import { mountPlaceMap, type PlaceMap } from '../map';
import { details, errorText, renderContextBanner } from '../ui';
import { linkPath } from '../storage/markdown';
import { normaliseDistanceUnit, distanceFromKm, distanceToKm, formatDistance, speedSuffix, type DistanceUnit } from '../units';

const clone = <T>(value: T): T => structuredClone(value);
type Controls = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;
interface DraftPlan {
  draft(): OutingRecord;
  onApplyDraft(groups: OutingGroup[], options: OutingPlanningOptions): void;
}
type PlannerTarget = { path: string } | DraftPlan;
type HoursOverride = NonNullable<OutingPlanningOptions['stopOverrides'][string]['hours']>;

/** Deliberately accepts only explicit clock intervals; uncertain hours stay unconfirmed. */
export function parsePlanningHoursOverride(value: string): HoursOverride {
  const parts = value.split(';').map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw Error('Enter opening intervals, for example 09:00-12:00; 13:00-17:00.');
  const clock = '(?:[01]\\d|2[0-3]):[0-5]\\d';
  const pattern = new RegExp('^(' + clock + ')\\s*[-–]\\s*(' + clock + '|24:00)$');
  const intervals = parts.map(part => {
    const found = pattern.exec(part);
    if (!found || found[1] === found[2]) throw Error('Use opening intervals such as 09:00-12:00; 13:00-17:00. Overnight closing times are allowed.');
    return { open: found[1], close: found[2] };
  });
  return { closed: false, intervals };
}

/** Reviewed, local suggestions. This modal never changes parking or launches a route. */
export class OutingPlannerModal extends Modal {
  private options: OutingPlanningOptions = defaultPlanningOptions();
  private places: PlaceRecord[] = [];
  private record?: OutingRecord;
  private preview?: OutingOptimisationPreview;
  private owner = new Component();
  private map?: PlaceMap;
  private mapContainer?: HTMLElement;
  private previewEl!: HTMLElement;
  private status!: HTMLElement;
  private form!: HTMLElement;
  private applyButton!: HTMLButtonElement;
  private finishEditing?: () => void;
  private closed = false;
  private busy = false;
  private generation = 0;
  private disabled = new Map<Controls, boolean>();
  private errors = new Map<string, string>();
  private overridesEl?: HTMLDetailsElement;
  private changeMessage = '';
  private distanceUnit: DistanceUnit = 'miles';
  constructor(private context: NotebookContext, private target: PlannerTarget) { super(context.app); }

  onOpen(): void { markInputModal(this);
    if (!(this.finishEditing = this.context.beginEditing())) { this.close(); return; }
    this.owner.load();
    this.titleEl.setText('Plan journey');
    this.modalEl.addClass('charity-outing-planner-modal');
    this.status = this.contentEl.createDiv({ cls: 'charity-planner-status', attr: { role: 'status', 'aria-live': 'polite' } });
    void this.perform(() => this.load());
  }

  private async load(): Promise<void> {
    const [places, record] = await Promise.all([
      this.context.store.listPlaces(),
      'path' in this.target ? this.context.store.outings.get(this.target.path) : Promise.resolve(this.target.draft()),
    ]);
    if (this.closed) return;
    this.places = places; this.record = clone(record);
    this.options = record.planning ? clone(record.planning) : defaultPlanningOptions();
    if (record.operation || record.draft) {
      this.status.setText('Finish, resume or discard the saved visit draft before planning this outing.');
      this.status.addClass('charity-error'); return;
    }
    this.render();
  }

  private render(): void {
    this.distanceUnit = normaliseDistanceUnit(this.context.settings.distanceUnit);
    this.contentEl.empty();
    renderContextBanner(this.context, this.contentEl);
    this.contentEl.createEl('p', { text: 'Compare a local estimate before changing your outing. Google Maps calculates road routes after you open it.', cls: 'charity-hint' });
    this.form = this.contentEl.createDiv('charity-planner-form');
    new Setting(this.form).setName('Planning priority').addDropdown(control => {
      control.selectEl.setAttribute('aria-label', 'Planning priority');
      control.addOption('hours', 'Fit opening hours').addOption('distance', 'Shorter distance').setValue(this.options.mode);
      control.onChange(value => { this.options.mode = value as OutingPlanningOptions['mode']; this.changed(); });
    });
    this.text(this.form, 'Outing date', this.options.date, value => {
      if (value !== this.options.date) {
        const cleared = Object.values(this.options.stopOverrides).some(override => !!override.hours);
        for (const override of Object.values(this.options.stopOverrides)) delete override.hours;
        this.errors.clear();
        if (cleared) this.changeMessage = 'Date changed; date-specific hours were cleared. Visit durations are retained. Preview again to review.';
      }
      this.options.date = value; this.renderOverrides();
    }, 'date');
    this.text(this.form, 'Departure time', this.options.departureTime, value => this.options.departureTime = value, 'time');
    this.text(this.form, 'Timezone', this.options.timeZone, value => this.options.timeZone = value);
    this.form.createEl('p', { text: 'New plans start today at 09:00 in the device timezone. Review the date, use one timezone for the outing and check holiday hours.', cls: 'charity-hint' });
    this.anchorEditor(this.form, 'Starting point', this.options.start, value => this.options.start = value);
    let lastEndpoint: PlanningAnchor | null = this.options.end.kind === 'record' || this.options.end.kind === 'coordinates' ? clone(this.options.end) : null;
    new Setting(this.form).setName('Finish').addDropdown(control => {
      control.selectEl.setAttribute('aria-label', 'Journey finish');
      control.addOption('return', 'Return to starting point').addOption('last', 'Finish at last source').addOption('another', 'Choose another endpoint');
      control.setValue(this.options.end.kind === 'return' || this.options.end.kind === 'last' ? this.options.end.kind : 'another');
      control.onChange(value => {
        this.options.end = value === 'return' ? { kind: 'return' } : value === 'last' ? { kind: 'last' } : clone(lastEndpoint ?? { kind: 'coordinates', coordinates: [NaN, NaN] });
        endpoint.toggle(value === 'another'); this.changed();
      });
    });
    const endpoint = this.form.createDiv();
    this.anchorEditor(endpoint, 'Finishing point', this.options.end.kind === 'record' || this.options.end.kind === 'coordinates' ? this.options.end : null, value => {
      lastEndpoint = value ? clone(value) : null;
      if (this.options.end.kind !== 'return' && this.options.end.kind !== 'last') this.options.end = clone(value ?? { kind: 'coordinates', coordinates: [NaN, NaN] });
    });
    endpoint.toggle(this.options.end.kind !== 'return' && this.options.end.kind !== 'last');
    this.number(this.form, 'Minutes per source', this.options.defaultVisitMinutes, value => this.options.defaultVisitMinutes = value, 1, 1440, 1);
    this.text(this.form, 'Latest finish (optional)', this.options.latestFinishTime ?? '', value => this.options.latestFinishTime = value || undefined, 'time');
    this.renderOverrides();
    const estimates = details(this.form, 'Travel and parking assumptions');
    estimates.createEl('p', { text: 'Estimates use straight-line distance with the multipliers below. Roads, traffic, access and walking restrictions can change the result.', cls: 'charity-hint' });
    for (const [key, label, min, max, step] of [
      ['driveMultiplier', 'Driving distance multiplier', 1, 10, .1],
      ['walkMultiplier', 'Walking distance multiplier', 1, 10, .1],
      ['parkingMinutes', 'Parking minutes per group', 0, 120, 1],
    ] as const) this.number(estimates, label, this.options.estimates[key], value => this.options.estimates[key] = value, min, max, step);
    this.speed(estimates, 'driveKph', 'Driving speed', 1, 200, 1);
    this.speed(estimates, 'walkKph', 'Walking speed', .5, 20, .1);
    const tools = this.contentEl.createDiv('charity-actions');
    this.action(tools, 'Preview suggested plan', () => this.makePreview(), true);
    this.status = this.contentEl.createDiv({ cls: 'charity-planner-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.previewEl = this.contentEl.createDiv('charity-planner-preview');
    const footer = this.contentEl.createDiv('charity-modal-footer charity-actions');
    this.applyButton = this.action(footer, 'Use suggested plan', () => this.apply(), true, true); this.applyButton.disabled = true;
    this.action(footer, 'Keep current plan', async () => this.close());
  }

  private text(parent: HTMLElement, label: string, value: string, set: (value: string) => void, type = 'text'): HTMLInputElement {
    let input!: HTMLInputElement;
    new Setting(parent).setName(label).addText(control => {
      input = control.inputEl; input.type = type; input.setAttribute('aria-label', label);
      control.setValue(value).onChange(next => { set(next); this.changed(); });
    });
    return input;
  }
  private number(parent: HTMLElement, label: string, value: number, set: (value: number) => void, min: number, max: number, step: number): HTMLInputElement {
    const input = this.text(parent, label, Number.isFinite(value) ? String(value) : '', next => set(next.trim() ? Number(next) : NaN), 'number');
    input.min = String(min); input.max = String(max); input.step = String(step); return input;
  }

  private speed(parent: HTMLElement, key: 'driveKph' | 'walkKph', label: string, minKph: number, maxKph: number, metricStep: number): void {
    const original = this.options.estimates[key], unit = this.distanceUnit;
    const converted = distanceFromKm(original, unit), minimum = distanceFromKm(minKph, unit), maximum = distanceFromKm(maxKph, unit);
    const rounded = Number(converted.toFixed(1));
    const display = Number.isFinite(converted) ? String(rounded < minimum || rounded > maximum ? converted : rounded) : '';
    const input = this.text(parent, label + ' (' + speedSuffix(unit) + ')', display, raw => {
      const value = raw.trim() ? Number(raw) : NaN;
      // Display rounding and unit changes must never change saved physical assumptions.
      this.options.estimates[key] = raw.trim() && value === Number(display) ? original : distanceToKm(value, unit);
    }, 'number');
    input.min = String(minimum); input.max = String(maximum); input.step = unit === 'miles' ? 'any' : String(metricStep);
  }

  private anchorEditor(parent: HTMLElement, label: string, initial: PlanningAnchor | null, set: (anchor: PlanningAnchor | null) => void): void {
    const section = details(parent, label); section.open = label === 'Starting point';
    let method: string = initial?.kind ?? 'record', recordPath = initial?.kind === 'record' ? linkPath(initial.path) : '';
    let latitude = initial?.kind === 'coordinates' ? String(initial.coordinates[0]) : '';
    let longitude = initial?.kind === 'coordinates' ? String(initial.coordinates[1]) : '';
    const anchor = (): PlanningAnchor | null => method === 'record'
      ? (recordPath ? { kind: 'record', path: recordPath } : null)
      : { kind: 'coordinates', coordinates: [latitude.trim() ? Number(latitude) : NaN, longitude.trim() ? Number(longitude) : NaN] };
    const update = () => { set(anchor()); this.changed(); };
    new Setting(section).setName('Location method').addDropdown(control => {
      control.selectEl.setAttribute('aria-label', label + ' location method');
      control.addOption('record', 'Saved source or parking').addOption('coordinates', 'Coordinates / map point').setValue(method);
      control.onChange(value => { method = value; records.toggle(value === 'record'); coordinates.toggle(value === 'coordinates'); update(); });
    });
    const records = section.createDiv();
    new Setting(records).setName('Saved location').addDropdown(control => {
      control.selectEl.setAttribute('aria-label', label + ' saved location');
      control.addOption('', 'Choose a source or parking');
      for (const place of [...this.places].sort((a, b) => a.name.localeCompare(b.name))) control.addOption(place.path, place.name + (place.kind === 'parking' ? ' (parking)' : '') + (!place.coordinates ? ' (needs coordinates)' : ''));
      if (recordPath && !this.places.some(place => place.path === recordPath)) control.addOption(recordPath, 'Missing saved location');
      control.setValue(recordPath).onChange(value => { recordPath = value; update(); });
    });
    const coordinates = section.createDiv();
    const lat = this.text(coordinates, label + ' latitude', latitude, value => { latitude = value; update(); }, 'number');
    lat.min = '-90'; lat.max = '90'; lat.step = 'any';
    const lng = this.text(coordinates, label + ' longitude', longitude, value => { longitude = value; update(); }, 'number');
    lng.min = '-180'; lng.max = '180'; lng.step = 'any';
    const use = (value: Coordinates) => {
      if (this.closed) return;
      method = 'coordinates'; latitude = String(value[0]); longitude = String(value[1]); lat.value = latitude; lng.value = longitude;
      records.hide(); coordinates.show();
      section.querySelector<HTMLSelectElement>('select')!.value = method; update();
    };
    const actions = coordinates.createDiv('charity-actions');
    this.action(actions, 'Pick ' + label.toLocaleLowerCase() + ' on map', async () => this.pickPoint(section, use));
    this.action(actions, 'Use current location', async () => this.currentLocation(use)).setAttribute('aria-label', label + ' current location');
    coordinates.createEl('p', { text: 'Current location is requested once, only when you press the button. Nothing is saved to a place note.', cls: 'charity-hint' });
    records.toggle(method === 'record'); coordinates.toggle(method === 'coordinates');
  }

  private pickPoint(parent: HTMLElement, select: (coordinates: Coordinates) => void): void {
    this.map?.destroy(); this.map = undefined; this.mapContainer?.remove();
    const picker = this.mapContainer = parent.createDiv('charity-planner-map-picker');
    picker.createEl('p', { text: 'Choose pin location, then tap the map. Only this journey endpoint changes.', cls: 'charity-hint' });
    this.map = mountPlaceMap(this.owner, picker, this.context.mapHost, {
      records: this.places, locality: true,
      onPick: coordinates => { if (!this.closed && !this.busy) { select(coordinates); picker.hide(); } },
    });
    this.map.setPickMode('move');
  }
  private async currentLocation(select: (coordinates: Coordinates) => void): Promise<void> {
    if (!navigator.geolocation) throw Error('Location is unavailable. Choose a saved location, map point or coordinates.');
    const generation = this.generation;
    const coordinates = await new Promise<Coordinates>((resolve, reject) => navigator.geolocation.getCurrentPosition(
      position => resolve([position.coords.latitude, position.coords.longitude]),
      () => reject(Error('Location was not available or permission was declined. Choose another starting point.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    ));
    if (!this.closed && generation === this.generation) select(coordinates);
  }

  private renderOverrides(): void {
    this.overridesEl?.remove();
    const section = this.overridesEl = details(this.form, 'Source durations and date-specific hours');
    section.createEl('p', { text: 'Overrides apply only to the selected outing date. Captured Google hours remain unchanged; visited and skipped stops keep their history.', cls: 'charity-hint' });
    for (const stop of this.record!.groups.flatMap(group => group.stops).filter(stop => stop.status === 'pending')) {
      const source = this.places.find(place => place.path === stop.sourcePath);
      const row = details(section, source?.name ?? stop.sourcePath);
      let existing = this.options.stopOverrides[stop.id] ?? {};
      let duration = existing.visitMinutes === undefined ? '' : String(existing.visitMinutes);
      const minutesInput = this.text(row, 'Visit minutes for ' + (source?.name ?? stop.id), duration, value => {
        duration = value; existing = this.options.stopOverrides[stop.id] ?? {};
        this.options.stopOverrides[stop.id] = { ...existing, visitMinutes: value.trim() ? Number(value) : undefined };
      }, 'number');
      minutesInput.min = '1'; minutesInput.max = '1440'; minutesInput.step = '1';
      let hoursMode = existing.hours?.closed ? 'closed' : existing.hours ? 'open' : 'captured';
      let raw = existing.hours?.intervals.map(interval => interval.open + '-' + interval.close).join('; ') ?? '';
      const update = () => {
        this.errors.delete(stop.id); existing = this.options.stopOverrides[stop.id] ?? {};
        try {
          this.options.stopOverrides[stop.id] = { ...existing, hours: hoursMode === 'closed' ? { closed: true, intervals: [] } : hoursMode === 'open' ? parsePlanningHoursOverride(raw) : undefined };
        } catch (error) { this.errors.set(stop.id, (source?.name ?? 'Source') + ': ' + errorText(error)); }
        this.changed();
      };
      new Setting(row).setName('Hours on this date').addDropdown(control => {
        control.selectEl.setAttribute('aria-label', 'Hours override for ' + (source?.name ?? stop.id));
        control.addOption('captured', 'Use captured weekly hours').addOption('closed', 'Closed on this date').addOption('open', 'Set opening intervals').setValue(hoursMode);
        control.onChange(value => { hoursMode = value; intervals.toggle(value === 'open'); update(); });
      });
      const intervals = row.createDiv();
      this.text(intervals, 'Opening intervals for ' + (source?.name ?? stop.id), raw, value => { raw = value; update(); });
      intervals.createEl('p', { text: '24-hour clock, for example 09:00-12:00; 13:00-17:00. A closing time before opening means overnight.', cls: 'charity-hint' });
      intervals.toggle(hoursMode === 'open');
    }
  }

  private changed(): void {
    this.generation++;
    this.preview = undefined;
    if (this.previewEl) this.previewEl.empty();
    if (this.applyButton) this.applyButton.disabled = true;
    if (this.status && !this.busy) { this.status.setText(this.changeMessage || 'Preview again to review these changes.'); this.changeMessage = ''; this.status.removeClass('charity-error'); }
  }
  private async readPreview(): Promise<OutingOptimisationPreview> {
    if (this.errors.size) throw Error([...this.errors.values()].join('\n'));
    for (const [key, label, minimum, maximum] of [['driveKph', 'Driving speed', 1, 200], ['walkKph', 'Walking speed', .5, 20]] as const) {
      const value = this.options.estimates[key];
      if (!Number.isFinite(value) || value < minimum || value > maximum) throw Error(label + ' must be between ' + distanceFromKm(minimum, this.distanceUnit).toFixed(2) + ' and ' + distanceFromKm(maximum, this.distanceUnit).toFixed(2) + ' ' + speedSuffix(this.distanceUnit) + '.');
    }
    if ('path' in this.target) return this.context.store.outings.previewPlanning(this.target.path, clone(this.options));
    const record = clone(this.target.draft());
    const [places, hours] = await Promise.all([this.context.store.listPlaces(), this.context.store.outings.planningHours(record)]);
    if (this.closed) throw Error('Journey planner closed.');
    return buildOutingOptimisationPreview(record, places, hours, clone(this.options));
  }
  private async makePreview(): Promise<void> {
    const generation = this.generation;
    const preview = await this.readPreview(); if (this.closed) return;
    if (generation !== this.generation) {
      this.status.setText('Inputs changed while calculating. Preview again to review these changes.');
      this.status.removeClass('charity-error'); return;
    }
    this.preview = preview; this.options = clone(preview.options); this.renderPreview(preview);
    this.status.setText(preview.blockers.length ? 'Resolve the problems below, then preview again.' : 'Review the suggestion. No changes have been saved.');
    this.status.toggleClass('charity-error', preview.blockers.length > 0);
  }
  private renderPreview(preview: OutingOptimisationPreview): void {
    this.previewEl.empty(); this.previewEl.createEl('h3', { text: 'Suggested journey' });
    const comparison = this.previewEl.createDiv('charity-planner-comparison');
    for (const [label, estimate] of [['Current order', preview.current], ['Suggested order', preview.proposed]] as const) {
      const row = comparison.createDiv(); row.createEl('strong', { text: label });
      row.createEl('p', { text: formatDistance(estimate.totalKm, this.distanceUnit) + ' estimated; ' + estimate.openingConflicts + ' opening conflicts; ' + Math.round(estimate.waitingMinutes) + ' minutes waiting.' });
      row.createEl('p', { text: 'Finish ' + formatPlanningTime(estimate.finishAt, preview.options) + (estimate.latestFinishMissed ? ' (after latest finish)' : '') });
    }
    this.previewEl.createEl('p', { text: 'Suggested travel: ' + formatDistance(preview.proposed.drivingKm, this.distanceUnit) + ' driving, ' + formatDistance(preview.proposed.walkingKm, this.distanceUnit) + ' walking, including returns to selected parking.', cls: 'charity-hint' });
    if (preview.blockers.length) {
      const list = this.previewEl.createEl('ul', { cls: 'charity-error' });
      for (const issue of preview.blockers) list.createEl('li', { text: issue });
    }
    if (preview.warnings.length) {
      const list = this.previewEl.createEl('ul', { cls: 'charity-hint' });
      for (const warning of preview.warnings) list.createEl('li', { text: warning });
    }
    const timeline = this.previewEl.createEl('ol', { cls: 'charity-planner-timeline' });
    let lastGroup = '';
    for (const step of preview.proposed.timeline) {
      const row = timeline.createEl('li');
      if (step.groupId !== lastGroup) {
        lastGroup = step.groupId;
        const group = preview.groups.find(group => group.id === step.groupId);
        row.createEl('p', { text: group?.parkingPath ? 'Park at ' + (this.places.find(place => place.path === group.parkingPath)?.name ?? group.parkingPath) : 'On foot / source location', cls: 'charity-hint' });
      }
      row.createEl('strong', { text: this.places.find(place => place.path === step.sourcePath)?.name ?? step.sourcePath });
      row.createEl('p', { text: 'Arrive ' + formatPlanningTime(step.arrival, preview.options) + ', wait ' + Math.round(step.waitMinutes) + ' min, visit ' + step.visitMinutes + ' min, leave ' + formatPlanningTime(step.departure, preview.options) + '.' });
      row.createEl('p', { text: 'Visit starts ' + formatPlanningTime(step.visitStarts, preview.options) + '. ' + (step.hoursStatus === 'open' ? 'Within opening hours' : step.hoursStatus === 'closed' ? 'Opening-hours conflict' : 'Hours unconfirmed') + (step.hoursChecked ? '. Hours checked ' + step.hoursChecked : '. No hours check date'), cls: 'charity-hint' });
    }
    this.applyButton.disabled = preview.blockers.length > 0;
    // Keep the reviewed comparison visible without scrolling the underlying note.
    this.contentEl.scrollTop = Math.max(0, this.contentEl.scrollTop + this.previewEl.getBoundingClientRect().top - this.contentEl.getBoundingClientRect().top);
  }
  private async apply(): Promise<void> {
    const preview = this.preview;
    if (!preview || preview.blockers.length) throw Error('Create a valid preview before using a suggestion.');
    if ('path' in this.target) {
      try {
        await this.context.store.outings.applyPlanning(this.target.path, clone(this.options), preview.fingerprint);
      } catch (error) {
        if (!this.closed) {
          try {
            const fresh = await this.readPreview();
            if (!this.closed && fresh.fingerprint !== preview.fingerprint) {
              this.preview = fresh; this.renderPreview(fresh);
              throw Error('The outing or its places changed. Review the refreshed comparison before using the suggestion.');
            }
          } catch (comparisonError) {
            if (comparisonError instanceof Error && comparisonError.message.startsWith('The outing or its places changed.')) throw comparisonError;
          }
        }
        throw error;
      }
    } else {
      const fresh = await this.readPreview(); if (this.closed) return;
      if (fresh.fingerprint !== preview.fingerprint) {
        this.preview = fresh; this.renderPreview(fresh);
        throw Error('The outing or its places changed. Review the refreshed comparison before using the suggestion.');
      }
      this.target.onApplyDraft(clone(fresh.groups), clone(fresh.options));
    }
    if (this.closed) return;
    new Notice('path' in this.target ? 'Journey plan saved' : 'Suggestion added to the outing draft. Save outing to keep it.');
    this.close();
  }
  private action(parent: HTMLElement, label: string, run: () => Promise<void>, primary = false, reportAfterClose = false): HTMLButtonElement {
    const button = parent.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' });
    button.onclick = () => { if (!this.closed && !this.busy) void this.perform(run, reportAfterClose); }; return button;
  }
  private setBusy(value: boolean): void {
    this.busy = value;
    if (this.mapContainer) this.mapContainer.inert = value;
    if (value) {
      this.disabled.clear();
      this.contentEl.querySelectorAll<Controls>('input,select,textarea,button').forEach(control => { this.disabled.set(control, control.disabled); control.disabled = true; });
    } else {
      for (const [control, disabled] of this.disabled) if (control.isConnected) control.disabled = disabled;
      this.disabled.clear();
      if (this.applyButton) this.applyButton.disabled = !this.preview || this.preview.blockers.length > 0;
    }
  }
  private async perform(run: () => Promise<void>, reportAfterClose = false): Promise<void> {
    if (this.busy || this.closed) return;
    this.setBusy(true);
    this.status?.setText('Working...'); this.status?.removeClass('charity-error');
    try { await run(); }
    catch (error) {
      if (!this.closed) { this.status.setText(errorText(error)); this.status.addClass('charity-error'); }
      else if (reportAfterClose) new Notice('Journey planner: ' + errorText(error));
    } finally {
      this.setBusy(false);
      if (this.closed) this.release();
    }
  }
  private release(): void { this.finishEditing?.(); this.finishEditing = undefined; }
  close(): void { this.closed = true; this.generation++; super.close(); }
  onClose(): void { this.closed = true; this.generation++; this.owner.unload(); this.contentEl.empty(); if (!this.busy) this.release(); }
}
