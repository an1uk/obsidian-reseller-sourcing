import type { BasesViewRegistration } from 'obsidian';
import { MapView } from './base-view';
import type { MapHost } from './host';
export { MAP_VIEW_TYPE } from './policy';
export type { MapHost } from './host';
export { mountPlaceMap, PlaceMap } from './place-map';
export type { PlaceMapOptions } from './place-map';
export { shutdownMapRuntime } from './runtime';
export function createMapRegistration(host: MapHost): BasesViewRegistration {
  return {name:'Sourcing map', icon:'map', factory:(controller,container) => new MapView(controller,container,host), options:() => MapView.getViewOptions()};
}
