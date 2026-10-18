// Adapted from Obsidian Maps 0.2.2 (8703e98013fa20fb188746d24664452f41b17227).
// Copyright (c) 2025 Obsidian. MIT licence: licenses/obsidian-maps-MIT.txt.
import { setIcon } from 'obsidian';
import { IControl, Map } from 'maplibre-gl';

export class CustomZoomControl implements IControl {
	private containerEl: HTMLElement;

	constructor() {
		this.containerEl = createDiv('maplibregl-ctrl maplibregl-ctrl-group canvas-control-group mod-raised');
	}

	onAdd(map: Map): HTMLElement {
		const zoomInButton = this.containerEl.createEl('button', {
			cls: 'maplibregl-ctrl-zoom-in canvas-control-item',
			attr: { 'aria-label': 'Zoom in' }
		});
		setIcon(zoomInButton, 'plus');

		zoomInButton.addEventListener('click', event => {
			map.zoomIn({}, {originalEvent:event});
		});

		const zoomOutButton = this.containerEl.createEl('button', {
			cls: 'maplibregl-ctrl-zoom-out canvas-control-item',
			attr: { 'aria-label': 'Zoom out' }
		});
		setIcon(zoomOutButton, 'minus');

		zoomOutButton.addEventListener('click', event => {
			map.zoomOut({}, {originalEvent:event});
		});

		return this.containerEl;
	}

	onRemove(): void {
		this.containerEl.detach();
	}
}
