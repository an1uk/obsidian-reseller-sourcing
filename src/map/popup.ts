// Adapted from Obsidian Maps 0.2.2 (8703e98013fa20fb188746d24664452f41b17227).
// Copyright (c) 2025 Obsidian. MIT licence: licenses/obsidian-maps-MIT.txt.
import { App, BasesEntry, BasesPropertyId, ListValue, Platform, Value } from 'obsidian';
import { Popup, Map } from 'maplibre-gl';
import { MobileMapPopup } from './mobile-popup';
import { runMapAction } from './actions';

/** Cap on how many properties a popup will consider rendering. */
const MAX_POPUP_PROPERTIES = 20;

interface PopupProperty {
	prop: BasesPropertyId;
	value: Value;
}

export class PopupManager {
	private map: Map | null = null;
	private sharedPopup: Popup | null = null;
	private persistent = false;
	private popupHideTimeout: number | null = null;
	private popupHideTimeoutWin: Window | null = null;
	private containerEl: HTMLElement;
	private app: App;
	private touchPopup: MobileMapPopup;

	constructor(containerEl: HTMLElement, app: App, private appendActions?: (entry: BasesEntry, container: HTMLElement) => void) {
		this.containerEl = containerEl;
		this.app = app;
		this.touchPopup = new MobileMapPopup(containerEl);
	}

	setMap(map: Map | null): void {
		this.map = map;
	}

	showPopup(
		entry: BasesEntry,
		coordinates: [number, number],
		properties: BasesPropertyId[],
		hiddenProps: BasesPropertyId[],
		getDisplayName: (prop: BasesPropertyId) => string,
		persistent = false
	): void {
		if (!this.map) return;

		// Only show popup if there are properties to display
		const propertiesWithValues = this.collectDisplayProperties(entry, properties, hiddenProps);
		if (propertiesWithValues.length === 0 && !persistent) return;

		this.clearPopupHideTimeout();
		this.persistent = persistent;
		if (Platform.isMobileApp) {
			this.touchPopup.open(this.createPopupContent(entry, propertiesWithValues, getDisplayName), entry.file.basename, this.containerEl);
			return;
		}

		// Create shared popup if it doesn't exist
		if (!this.sharedPopup) {
			const sharedPopup = this.sharedPopup = new Popup({
				closeButton: Platform.isMobileApp,
				closeOnClick: false,
				offset: 25
			});

			// Add hover handlers to the popup itself
			sharedPopup.on('open', () => {
				const popupEl = sharedPopup.getElement();
				if (popupEl) {
					popupEl.addEventListener('mouseenter', () => {
						this.clearPopupHideTimeout();
					});
					popupEl.addEventListener('mouseleave', () => {
						this.hidePopup();
					});
				}
			});
		}

		// Update popup content and position
		const [lat, lng] = coordinates;
		const popupContent = this.createPopupContent(entry, propertiesWithValues, getDisplayName);
		this.sharedPopup
			.setDOMContent(popupContent)
			.setLngLat([lng, lat])
			.addTo(this.map);
	}

	hidePopup(): void {
		this.clearPopupHideTimeout();
		if (this.persistent) return;

		const win = this.popupHideTimeoutWin = this.containerEl.win;
		this.popupHideTimeout = win.setTimeout(() => {
			if (this.sharedPopup) {
				this.sharedPopup.remove();
			}
			this.popupHideTimeout = null;
			this.popupHideTimeoutWin = null;
		}, 150); // Small delay to allow moving to popup
	}

	clearPopupHideTimeout(): void {
		if (this.popupHideTimeout) {
			const win = this.popupHideTimeoutWin || this.containerEl.win;
			win.clearTimeout(this.popupHideTimeout);
		}

		this.popupHideTimeoutWin = null;
		this.popupHideTimeout = null;
	}

	destroy(): void {
		this.clearPopupHideTimeout();
		this.touchPopup.destroy();
		if (this.sharedPopup) {
			this.sharedPopup.remove();
			this.sharedPopup = null;
		}
		this.persistent = false;
		this.map = null;
	}

	/** Collects the renderable properties of an entry, skipping the marker-driven ones. */
	private collectDisplayProperties(
		entry: BasesEntry,
		properties: BasesPropertyId[],
		hiddenProps: BasesPropertyId[]
	): PopupProperty[] {
		if (!properties) return [];

		const propertiesWithValues: PopupProperty[] = [];

		for (const prop of properties.slice(0, MAX_POPUP_PROPERTIES)) {
			if (hiddenProps.includes(prop)) continue;

			try {
				const value = entry.getValue(prop);
				if (value && this.hasNonEmptyValue(value)) {
					propertiesWithValues.push({ prop, value });
				}
			}
			catch {
				// Skip properties that can't be rendered
			}
		}

		return propertiesWithValues;
	}

	private createPopupContent(
		entry: BasesEntry,
		propertiesWithValues: PopupProperty[],
		getDisplayName: (prop: BasesPropertyId) => string
	): HTMLElement {
		const containerEl = createDiv('charity-map-popup');
		if (Platform.isMobileApp) containerEl.addClass('charity-map-mobile');

		// Use first property as title (still acts as a link to the file)
		if (propertiesWithValues.length > 0) {
			const firstProperty = propertiesWithValues[0];
			const titleEl = containerEl.createDiv('charity-map-popup-title');

			// Create a clickable link that opens the file
			const titleLinkEl = titleEl.createEl('a', {
				href: entry.file.path,
				cls: 'internal-link'
			});

			// Render the first property value inside the link
			firstProperty.value.renderTo(titleLinkEl, this.app.renderContext);

			// Show remaining properties (excluding the first one used as title)
			const remainingProperties = propertiesWithValues.slice(1);
			if (remainingProperties.length > 0) {
				const propContainerEl = containerEl.createDiv('charity-map-popup-properties');
				for (const { prop, value } of remainingProperties) {
					const propEl = propContainerEl.createDiv('charity-map-popup-property');
					const labelEl = propEl.createDiv('charity-map-popup-property-label');
					labelEl.textContent = getDisplayName(prop);
					const valueEl = propEl.createDiv('charity-map-popup-property-value');
					value.renderTo(valueEl, this.app.renderContext);
				}
			}
		}

		if (this.persistent) {
			if (propertiesWithValues.length === 0) containerEl.createEl('p', {text:entry.file.basename});
			const open = containerEl.createEl('button', {text:'Open note', cls:'charity-popup-open-note'});
			open.addEventListener('click', () => { runMapAction(() => this.app.workspace.openLinkText(entry.file.path, '', false)); });
		}
		this.appendActions?.(entry, containerEl);
		return containerEl;
	}

	private hasNonEmptyValue(value: Value): boolean {
		if (!value) return false;
		// Zero is an important sourcing value: Not rated.
		if (value.toString() === '0') return true;
		if (!value.isTruthy()) return false;

		// Handle ListValue - check if it has any non-empty items
		if (value instanceof ListValue) {
			for (let i = 0; i < value.length(); i++) {
				const item = value.get(i);
				if (item && this.hasNonEmptyValue(item)) {
					return true;
				}
			}
			return false;
		}

		return true;
	}
}
