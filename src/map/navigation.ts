import { runMapAction } from './actions';
import { googleMapsUrl, navigationUrl, resolveParking } from '../domain';
import type { MapHost } from './host';
import type { PlaceRecord } from '../types';

/** Derived action state is shared by both map surfaces; a filtered Base is not a parking source. */
export function placeNavigation(place: PlaceRecord, allPlaces: PlaceRecord[]) {
  const parking = place.kind === 'shop' ? resolveParking(place,allPlaces) : null;
  const destination = parking ? parking.destination : place;
  return {
    listing:googleMapsUrl(place),
    drive: destination ? navigationUrl(destination.coordinates,'driving') : '',
    walk:navigationUrl(place.coordinates,'walking'),
    choices: parking?.status === 'choice' ? parking.choices.map(p => ({name:p.name,url:navigationUrl(p.coordinates,'driving')})).filter(p => p.url) : [],
  };
}

export function appendNavigation(container: HTMLElement, place: PlaceRecord, allPlaces: PlaceRecord[], host?: MapHost): void {
  const navigation = placeNavigation(place,allPlaces);
  const actions = container.createDiv('charity-popup-links');
  const link = (name:string, url:string, parent:HTMLElement = actions) => {
    if (!url) return;
    if (host?.mode === 'examples') {
      const control = parent.createEl('button', {text:'Preview ' + name});
      control.addEventListener('click', () => { runMapAction(()=>host.openExternal?.(url,name),host.reportError); });
    } else {
      const anchor = parent.createEl('a',{text:name,href:url,attr:{target:'_blank',rel:'noopener noreferrer'}});
      if (host?.openExternal) for (const event of ['click','auxclick']) anchor.addEventListener(event, e => { e.preventDefault(); runMapAction(()=>host.openExternal?.(url,name),host.reportError); });
    }
  };
  link('Google Maps',navigation.listing); link('Drive here',navigation.drive); link('Walk here',navigation.walk);
  if (navigation.choices.length) {
    const choices = container.createEl('details'); choices.createEl('summary',{text:'Choose parking to drive to'});
    for (const choice of navigation.choices) link(choice.name,choice.url,choices);
  }
}
