// Adapted from Obsidian Maps 0.2.2 (8703e98013fa20fb188746d24664452f41b17227).
// Copyright (c) 2025 Obsidian. MIT licence: licenses/obsidian-maps-MIT.txt.
import { BasesEntry, BasesPropertyId } from 'obsidian';

/** Resolved view configuration driving how the map and its markers render. */
export interface MapConfig {
	coordinatesProp: BasesPropertyId | null;
	markerIconProp: BasesPropertyId | null;
	markerColorProp: BasesPropertyId | null;
	mapHeight: number;
	defaultZoom: number;
	/** null when no center is configured, which is distinct from a center of [0, 0]. */
	center: [number, number] | null;
	maxZoom: number;
	minZoom: number;
	mapTiles: string[];
	mapTilesDark: string[];
	currentTileSetId: string | null;
}

export interface MapMarker {
	entry: BasesEntry;
	coordinates: [number, number];
	/** Lucide icon name, or null for a plain dot. */
	icon: string | null;
	color: string;
	/** Key of the composite image combining icon and color. */
	imageKey: string;
}

export interface MapMarkerProperties {
	entryIndex: number;
	icon: string; // Composite image key combining icon and color
}
