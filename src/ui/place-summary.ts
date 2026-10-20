import { TFile, type Component } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import { formatRating, googleMapsUrl, navigationUrl, resolveParking } from '../domain';
import { mountPlaceMap, type PlaceMap } from '../map';
import { detailMapPlaces } from '../map/detail';
import { validCoordinates } from '../map/policy';
import { button, external, pickPlace, propertyText, VisitModal } from '../ui';

export interface PlaceSummaryOptions {
  existingMap?: PlaceMap;
  isCurrent?: () => boolean;
  showAssessment?: boolean;
  showActions?: boolean;
  onEdit?: (section?: 'location') => void | Promise<void>;
  onOpenWorkspace?: () => void | Promise<void>;
}

/** A compact note surface; the workspace supplies deeper browsing and editing. */
export async function renderPlaceSummary(context: NotebookContext, owner: Component, el: HTMLElement, path: string, options: PlaceSummaryOptions = {}): Promise<PlaceMap | undefined> {
  const places = await context.store.listPlaces();
  if (options.isCurrent && !options.isCurrent()) return options.existingMap;
  const place = places.find(record => record.path === path);
  let map = options.existingMap;
  const disposeMap = () => { if (map) owner.removeChild(map); map = undefined; };
  let root = el.querySelector<HTMLElement>(':scope > .charity-place-summary');
  if (!root) root = el.createDiv('charity-place-summary');
  if (!place) {
    disposeMap(); root.empty();
    root.createEl('p', { text: 'This place is unavailable. Choose another from the places list.', cls: 'charity-hint' });
    return;
  }
  let mapSlot = root.querySelector<HTMLElement>(':scope > .charity-place-summary-map');
  if (!mapSlot) mapSlot = root.createDiv('charity-place-summary-map');
  if (validCoordinates(place.coordinates)) {
    const records = detailMapPlaces(place, places, context.mapHost);
    if (map) map.setRecords(records);
    else { mapSlot.empty(); map = mountPlaceMap(owner, mapSlot, context.mapHost, { records, focusPath: place.path }); }
  } else {
    disposeMap(); mapSlot.empty();
    const empty = mapSlot.createDiv({ cls: 'charity-place-location-empty', attr: { role: 'status' } });
    empty.createEl('p', { text: 'Location not set', cls: 'charity-place-location-label' });
    empty.createEl('p', { text: 'Add coordinates or choose a pin to show this place on the map.', cls: 'charity-hint' });
    if (options.onEdit) button(empty, 'Add location', () => options.onEdit?.('location'), true);
  }
  root.querySelector(':scope > .charity-place-summary-content')?.remove();
  const content = root.createDiv('charity-place-summary-content');
  if (place.properties.shop_closed === true) content.createEl('p', { text: 'Permanently closed', cls: 'charity-hint' });
  if (options.showAssessment !== false && place.kind === 'shop') {
    content.createEl('p', { text: formatRating(place.properties.rating), cls: 'charity-place-summary-assessment' });
    const takeaway = propertyText(place.properties.comments);
    if (takeaway) content.createEl('p', { text: takeaway, cls: 'charity-place-summary-takeaway' });
  }
  const parking = place.kind === 'shop' ? resolveParking(place, places) : { status: 'single', choices: [], destination: place };
  const destination = parking.status === 'choice' ? 'Driving: choose from linked parking.'
    : parking.status === 'invalid' ? 'Driving destination needs a parking choice or location.'
    : 'Driving destination: ' + (parking.destination?.name ?? 'not set');
  content.createEl('p', { text: destination, cls: 'charity-hint' });
  if (options.showActions !== false) {
    const actions = content.createDiv('charity-place-summary-actions');
    external(context, actions, 'Google Maps', googleMapsUrl(place));
    if (parking.status === 'choice') button(actions, 'Choose parking to drive to', () => pickPlace(context, parking.choices, selected => {
      const url = navigationUrl(selected.coordinates, 'driving');
      if (!url) throw Error('Add coordinates to this parking location first.');
      return context.openExternal(url, 'Drive to parking');
    }, 'Choose parking for this trip'));
    else external(context, actions, place.kind === 'shop' && parking.destination?.kind === 'parking' ? 'Drive to parking' : 'Drive here', navigationUrl(parking.destination?.coordinates ?? null, 'driving'));
    external(context, actions, 'Walk here', navigationUrl(place.coordinates, 'walking'));
    if (place.kind === 'shop') button(actions, 'Record visit', () => new VisitModal(context, place.path).open());
    if (options.onEdit) button(actions, 'Edit place', () => options.onEdit?.());
    button(actions, 'Edit notes', async () => {
      const file = context.app.vault.getAbstractFileByPath(place.path);
      if (!(file instanceof TFile)) throw Error('This note no longer exists.');
      await context.app.workspace.getLeaf('tab').openFile(file, { state: { mode: 'source' } });
    });
    if (options.onOpenWorkspace) button(actions, 'Open workspace', () => options.onOpenWorkspace?.());
  }
  return map;
}
