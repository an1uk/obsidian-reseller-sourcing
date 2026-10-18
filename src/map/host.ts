import type { App } from 'obsidian';
import type { Coordinates, Settings, PlaceRecord } from '../types';

/** All writes are delegated to the plugin's reviewed storage/UI workflow. */
export interface MapHost {
  app: App;
  settings: Settings;
  openParking(coordinates: Coordinates, shopPath?: string): void | Promise<void>;
  confirmMove(path: string, coordinates: Coordinates): void | Promise<void>;
  openFile?(path: string): void | Promise<void>;
  getPlaces?(): Promise<PlaceRecord[]>;
  mode?: 'real' | 'examples';
  ownsPath?(path: string): boolean;
  assertCurrent?(): void | Promise<void>;
  openExternal?(url: string, title?: string): void | Promise<void>;
  reportError?(error:unknown): void;
  resolveNotebook?(root: string): Promise<MapHost | undefined>;
  persistMapConfig?(path: string, view: string, key: 'center' | 'defaultZoom', value: unknown): Promise<void>;
}
