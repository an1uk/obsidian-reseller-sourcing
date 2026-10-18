import { DropdownComponent, Modal, Platform, Setting } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import type { PlaceRecord } from '../types';
import type { OutingRecord } from '../outings/types';
import { buildOutingRoutePreview, type OutingRouteDestination, type OutingRoutePreview, type OutingRouteScope, type RouteExportTarget, ROUTE_TARGET_LABELS } from '../outings/routes';
import { navigationUrl } from '../domain';
import { copyTextOrShow } from '../platform/clipboard';
import { errorText, renderContextBanner } from '../ui';

/** Reviewed transient route export; never updates an outing or a place. */
export class OutingRouteModal extends Modal {
  private routeScope: OutingRouteScope = 'remaining';
  private routeTarget: RouteExportTarget = Platform.isAndroidApp ? 'android-app' : Platform.isMobileApp || Platform.isMobile ? 'mobile-browser' : 'desktop';
  private exclusions = new Set<string>();
  private preview?: OutingRoutePreview;
  private record?: OutingRecord;
  private places: PlaceRecord[] = [];
  private finishEditing?: () => void;
  private closed = false;
  private busy = false;
  private failed = false;
  private scopeControl?: DropdownComponent;
  private targetControl?: DropdownComponent;
  private previewEl!: HTMLElement;
  private status!: HTMLElement;
  constructor(private plugin: NotebookContext, private path: string) { super(plugin.app); }

  onOpen(): void {
    if (!(this.finishEditing = this.plugin.beginEditing())) { this.close(); return; }
    this.modalEl.addClass('charity-outing-route-modal'); this.titleEl.setText(this.plugin.externalActions === 'preview' ? 'Preview route in Google Maps' : 'Open route in Google Maps'); renderContextBanner(this.plugin, this.contentEl);
    this.contentEl.createEl('p',{text:'Review driving destinations in your saved outing order. Open one part at a time and check the stops in Google Maps.',cls:'charity-hint'});
    new Setting(this.contentEl).setName('Include').addDropdown(control => {
      this.scopeControl = control; control.selectEl.setAttribute('aria-label','Route scope');
      control.addOption('remaining','Remaining stops').addOption('all','All stops').setValue(this.routeScope);
      control.onChange(value => {
        if (this.busy || this.closed) { control.setValue(this.routeScope); return; }
        void this.perform(async () => { this.routeScope = value as OutingRouteScope; await this.refresh(); });
      });
    });
    new Setting(this.contentEl).setName('Open with').setDesc('Choose where the link will open. If Android opens a browser, choose Mobile browser.').addDropdown(control => {
      this.targetControl = control; control.selectEl.setAttribute('aria-label','Google Maps export target');
      for (const [value,label] of Object.entries(ROUTE_TARGET_LABELS)) control.addOption(value,label);
      control.setValue(this.routeTarget).onChange(value => {
        if (this.busy || this.closed) { control.setValue(this.routeTarget); return; }
        void this.perform(async () => { this.routeTarget = value as RouteExportTarget; await this.refresh(); });
      });
    });
    this.action(this.contentEl.createDiv('charity-actions charity-outing-route-tools'),'Refresh preview',() => this.refresh('Preview refreshed.'));
    this.status = this.contentEl.createDiv({cls:'charity-outing-route-status',attr:{role:'status','aria-live':'polite'}});
    this.previewEl = this.contentEl.createDiv('charity-outing-route-preview');
    void this.perform(() => this.refresh());
  }
  private async read(): Promise<OutingRoutePreview> {
    if (this.plugin.store.migrationActive) throw Error('Finish organisation recovery in Setup / help before exporting a route.');
    const [record,places] = await Promise.all([this.plugin.store.outings.get(this.path),this.plugin.store.listPlaces()]);
    if (this.closed) throw Error('Route preview closed.');
    this.record = record; this.places = places;
    const hours = record.planning ? await this.plugin.store.outings.planningHours(record) : {};
    if (this.closed) throw Error('Route preview closed.');
    return buildOutingRoutePreview(record,places,this.routeScope,[...this.exclusions],this.routeTarget,hours);
  }
  private async refresh(message = ''): Promise<void> {
    const preview = await this.read(); if (this.closed) return;
    this.preview = preview; this.failed = false;
    this.status.setText(message); this.status.removeClass('charity-error'); this.render();
  }
  private async perform(run: () => Promise<void>): Promise<void> {
    if (this.closed || this.busy) return;
    this.busy = true; this.setBusy(true);
    try { await run(); }
    catch (error) {
      if (!this.closed) {
        this.failed = true; this.status.setText('Route unavailable: ' + errorText(error)); this.status.addClass('charity-error'); this.render();
      }
    } finally { this.busy = false; if (!this.closed) this.setBusy(false); }
  }
  private setBusy(busy: boolean): void {
    this.scopeControl?.setDisabled(busy); this.targetControl?.setDisabled(busy);
    for (const control of this.contentEl.querySelectorAll<HTMLButtonElement>('button')) control.disabled = busy || control.dataset.routeDisabled === 'true';
  }
  private action(parent: HTMLElement, label: string, run: () => Promise<void>, disabled = false, aria?: string): HTMLButtonElement {
    const control = parent.createEl('button',{text:label});
    control.dataset.routeDisabled = String(disabled); control.disabled = disabled || this.busy;
    if (aria) control.setAttribute('aria-label',aria);
    control.onclick = () => { void this.perform(run); }; return control;
  }
  private ready(preview: OutingRoutePreview): boolean {
    return !this.failed && !preview.blockers.length && preview.parts.length > 0 && !preview.problems.some(problem => !this.exclusions.has(problem.groupId));
  }
  /** Re-read before every external action, copy, or note opening. */
  private async guarded(run: (fresh: OutingRoutePreview) => Promise<void>, needsRoute = true): Promise<void> {
    const expected = this.preview?.fingerprint;
    if (!expected || this.failed) { this.status.setText('Refresh the preview before choosing an action.'); return; }
    const fresh = await this.read(); if (this.closed) return;
    this.preview = fresh; this.failed = false;
    if (fresh.fingerprint !== expected) {
      this.status.setText('Route changed. Review the updated preview and choose the action again.');
      this.status.removeClass('charity-error'); this.render(); return;
    }
    if (needsRoute && !this.ready(fresh)) { this.status.setText('Resolve or exclude the problems before opening a route.'); this.render(); return; }
    if (!this.closed) await run(fresh);
  }
  private sourceNames(groupId: string): string {
    const group = this.record?.groups.find(value => value.id === groupId);
    return (group?.stops.filter(stop => this.routeScope === 'all' || stop.status === 'pending') ?? []).map(stop =>
      this.places.find(place => place.path === stop.sourcePath)?.name ?? stop.sourcePath.split('/').at(-1)?.replace(/\.md$/i,'') ?? 'Missing source').join(', ');
  }
  private openNote(parent: HTMLElement, path: string, name: string): void {
    this.action(parent,'Open note',() => this.guarded(async () => { this.close(); await this.plugin.openFile(path); },false),this.failed,'Open note for ' + name);
  }
  private render(): void {
    if (this.closed || !this.previewEl) return;
    this.previewEl.empty(); const preview = this.preview;
    if (!preview) { this.previewEl.createEl('p',{text:this.failed ? 'Preview unavailable. Check the error and refresh.' : 'Loading route preview…',cls:'charity-hint'}); return; }
    if (this.record) this.previewEl.createEl('h3',{text:this.record.name});
    this.previewEl.createEl('p',{text:ROUTE_TARGET_LABELS[preview.target] + ': up to ' + preview.destinationLimit + ' destinations per journey, including the final destination.',cls:'charity-hint'});
    this.previewEl.createEl('p',{text:'Start: ' + (preview.start?.name ?? 'Current location in Google Maps') + ' · Finish: ' + (preview.finish?.name ?? preview.destinations.at(-1)?.name ?? 'Last included stop'),cls:'charity-hint'});
    if (preview.blockers.length) {
      const blockers = this.previewEl.createDiv('charity-outing-route-blockers charity-error');
      for (const message of preview.blockers) blockers.createEl('p',{text:message});
      if (this.record?.operation) this.action(blockers,'Open outing',() => this.guarded(async () => { this.close(); await this.plugin.openFile(this.path); },false),this.failed);
    }
    const problems = preview.problems.filter(problem => !this.exclusions.has(problem.groupId));
    if (problems.length) {
      const section = this.previewEl.createDiv('charity-outing-route-problems');
      section.createEl('h3',{text:'Resolve before opening a route'});
      section.createEl('p',{text:'Fix the saved note or outing, then refresh. Excluding a group applies only to this route preview.',cls:'charity-hint'});
      for (const groupId of [...new Set(problems.map(problem => problem.groupId))]) {
        const values = problems.filter(problem => problem.groupId === groupId);
        const row = section.createDiv('charity-outing-route-problem'); row.dataset.groupId = groupId;
        row.createEl('strong',{text:values[0]!.name});
        for (const problem of values) row.createEl('p',{text:problem.message,cls:'charity-error'});
        row.createEl('p',{text:'Sources served: ' + this.sourceNames(groupId),cls:'charity-hint'});
        const actions = row.createDiv('charity-actions');
        for (const path of [...new Set(values.map(problem => problem.path))]) {
          const place = this.places.find(place => place.path === path); if (place) this.openNote(actions,path,place.name);
        }
        this.action(actions,'Open outing',() => this.guarded(async () => { this.close(); await this.plugin.openFile(this.path); },false),this.failed);
        this.action(actions,'Exclude from this route',async () => { this.exclusions.add(groupId); await this.refresh(); },false,'Exclude group for ' + values[0]!.name + ' from this route');
      }
    }
    const excluded = preview.excluded.map(group => group.groupId);
    if (excluded.length) {
      const section = this.previewEl.createDiv('charity-outing-route-excluded'); section.createEl('h3',{text:'Excluded from this route'});
      for (const groupId of excluded) {
        const row = section.createDiv('charity-outing-route-excluded-item'); row.dataset.groupId = groupId;
        row.createEl('p',{text:preview.excluded.find(value => value.groupId === groupId)?.label ?? this.sourceNames(groupId)});
        this.action(row,'Restore',async () => { this.exclusions.delete(groupId); await this.refresh(); },false,'Restore ' + this.sourceNames(groupId) + ' to this route');
      }
    }
    if (preview.parts.length && this.ready(preview)) {
      this.previewEl.createEl('p',{text:preview.destinations.length + ' driving destinations · ' + preview.parts.length + (preview.parts.length === 1 ? ' part' : ' parts'),cls:'charity-outing-route-summary'});
      let offset = 1;
      for (const part of preview.parts) {
        const section = this.previewEl.createDiv('charity-outing-route-part'); section.dataset.partIndex = String(part.index);
        section.createEl('h3',{text:'Part ' + (part.index + 1) + ' of ' + preview.parts.length});
        section.createEl('p',{text:part.origin ? (part.index ? 'Starts at the previous part’s final destination: ' : 'Starts at: ') + part.origin.name : 'Google Maps uses your current location when available, or asks for a starting point.',cls:'charity-hint'});
        const actions = section.createDiv('charity-actions charity-outing-route-part-actions');
        this.action(actions,(this.plugin.externalActions === 'preview' ? 'Preview part ' : 'Open part ') + (part.index + 1),() => this.guarded(async fresh => {
          const current = fresh.parts.find(value => value.index === part.index); if (current && !this.closed) await this.plugin.openExternal(current.url, 'Outing route part ' + (part.index + 1));
        }),false,'Open part ' + (part.index + 1) + ' in Google Maps');
        this.action(actions,'Copy link',() => this.guarded(async fresh => {
          const current = fresh.parts.find(value => value.index === part.index);
          if (current && !this.closed) {
            const copied = await copyTextOrShow(this.app,current.url,'Google Maps route — part ' + (part.index + 1),() => !this.closed);
            if (copied && !this.closed) this.status.setText('Route link copied.');
          }
        }),false,'Copy link for part ' + (part.index + 1));
        const list = section.createEl('ol',{cls:'charity-outing-route-destinations'}); list.start = offset;
        for (const destination of part.destinations) this.destination(list,destination,true);
        offset += part.destinations.length;
      }
      for (const warning of preview.warnings) this.previewEl.createEl('p',{text:warning,cls:'charity-hint'});
      this.previewEl.createEl('p',{text:'Opening a route does not mark stops visited.',cls:'charity-hint'});
    } else if (preview.destinations.length) {
      this.previewEl.createEl('h3',{text:'Destinations to review'});
      const list = this.previewEl.createEl('ol',{cls:'charity-outing-route-destinations'});
      for (const destination of preview.destinations) this.destination(list,destination,false);
    }
    this.setBusy(this.busy);
  }
  private destination(parent: HTMLElement, destination: OutingRouteDestination, routable: boolean): void {
    const row = parent.createEl('li',{cls:'charity-outing-route-destination'}); row.dataset.path = destination.path;
    row.createEl('p',{text:destination.endpoint === 'return' ? 'Return to start' : destination.endpoint === 'finish' ? 'Finishing point' : destination.kind === 'parking' ? 'Parking' : 'Source — no parking selected',cls:'charity-outing-route-kind'});
    row.createEl('strong',{text:destination.name});
    if (destination.sources.length) row.createEl('p',{text:'Sources served: ' + destination.sources.map(source => source.name + (source.status === 'pending' ? '' : ' (' + source.status + ')')).join(', '),cls:'charity-hint'});
    const actions = row.createDiv('charity-actions');
    this.action(actions,this.plugin.externalActions === 'preview' ? 'Preview driving link' : 'Drive here',() => this.guarded(async fresh => {
      const current = fresh.destinations.find(value => value.path === destination.path && value.groupIds.join('\n') === destination.groupIds.join('\n'));
      if (!current || this.closed) return;
      const url = navigationUrl(current.coordinates,'driving'); if (url) await this.plugin.openExternal(url, 'Drive to ' + destination.name);
    }),!routable || this.failed,'Drive to ' + destination.name);
    if (destination.path) this.openNote(actions,destination.path,destination.name);
  }
  close(): void {
    // Mobile dismissals animate before onClose; invalidate pending actions immediately.
    this.closed = true; super.close();
  }
  onClose(): void { this.closed = true; this.finishEditing?.(); this.contentEl.empty(); }
}
