import { runMapAction } from './actions';
// Adapted from Obsidian Maps 0.2.2 (8703e98013fa20fb188746d24664452f41b17227).
// Copyright (c) 2025 Obsidian. MIT licence: licenses/obsidian-maps-MIT.txt.
import {
	BasesView,
	debounce,
	Menu,
	Platform,
	QueryController,
	Value,
	StringValue,
	NullValue,
	BasesAllOptions,
	Notice,
} from 'obsidian';
import { Map } from 'maplibre-gl';
import type { MapHost } from './host';
import { MAP_VIEW_TYPE, fitOptions, FitPolicy, hostOwnsPath } from './policy';
import { appendNavigation } from './navigation';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from './constants';
import { CustomZoomControl } from './controls/zoom-control';
import { CustomGeolocateControl } from './controls/geolocate-control';
import { BackgroundSwitcherControl } from './controls/background-switcher';
import { StyleManager } from './style';
import { PopupManager } from './popup';
import { MarkerManager } from './markers';
import { MapConfig } from './types';
import { hasOwnProperty, coordinateFromValue, toLngLat, roundCoordinate, formatCoordinates, sameCoordinates } from './utils';
import { initializeMapRuntime } from './runtime';
import { copyTextOrShow } from '../platform/clipboard';

export const MapViewType = MAP_VIEW_TYPE;

/** Raw config values watched for changes. Values stay unknown; only equality matters. */
interface ConfigSnapshot {
	center: unknown;
	defaultZoom: unknown;
	minZoom: unknown;
	maxZoom: unknown;
	mapHeight: unknown;
	mapTiles: unknown;
	mapTilesDark: unknown;
}

export class MapView extends BasesView {
	type = MapViewType;
	scrollEl: HTMLElement;
	containerEl: HTMLElement;
	mapEl: HTMLElement;
	plugin: MapHost;
	private baseHost: MapHost;
	private contextGeneration = 0;
	private contextValid = false;

	// Internal rendering data
	private map: Map | null = null;
	private mapConfig: MapConfig | null = null;
	private pendingMapState: { center?: { lng: number, lat: number }, zoom?: number } | null = null;
	private isFirstLoad = true;
	private lastConfigSnapshot: ConfigSnapshot | null = null;
	private lastEvaluatedCenter: [number, number] | null = null;
	private fitPolicy = new FitPolicy();
	private disposed = false;
	private initializePromise: Promise<void> | null = null;
	private pickParking = false;
	private pickCopy = false;
	private mapFailed = false;
	private message: HTMLElement;
	private resizeObserver: ResizeObserver | null = null;
	private markersPending = false;
	private renderingMarkers = false;

	// Managers
	private styleManager: StyleManager;
	private popupManager: PopupManager;
	private markerManager: MarkerManager;

	constructor(controller: QueryController, scrollEl: HTMLElement, plugin: MapHost) {
		super(controller);
		this.scrollEl = scrollEl;
		this.plugin = plugin; this.baseHost = plugin;
		this.containerEl = scrollEl.createDiv({ cls: 'charity-map-container is-loading', attr: { tabIndex: 0 } });
		this.mapEl = this.containerEl.createDiv('charity-map');
		if (Platform.isMobileApp) this.containerEl.addClass('charity-map-mobile');
		this.message = this.containerEl.createDiv({cls:'charity-map-message', attr:{role:'status'}});

		// Initialize managers
		this.styleManager = new StyleManager(this.app);
		this.popupManager = new PopupManager(this.containerEl, this.app, (entry, container) => {
			void this.plugin.getPlaces?.().then(records => {
				if (this.disposed || !container.isConnected) return;
				const ownRecords = records.filter(p => hostOwnsPath(this.plugin,p.path));
				const place = ownRecords.find(p => p.path === entry.file.path);
				if (place) appendNavigation(container, place, ownRecords,this.plugin);
			}).catch(error => console.warn('Unable to load parking links:', error));
		});
		this.markerManager = new MarkerManager(
			this.app,
			this.mapEl,
			this.popupManager,
			(path, newLeaf) => { runMapAction(() => this.app.workspace.openLinkText(path, '', newLeaf)); },
			() => this.mapData(),
			() => this.mapConfig,
			(prop) => this.config.getDisplayName(prop)
		);
	}

	onload(): void {
		this.disposed = false;
		this.resizeObserver = new ResizeObserver(() => this.onResize());
		this.resizeObserver.observe(this.containerEl);
		this.register(() => this.resizeObserver?.disconnect());
		const toolbar = this.containerEl.createDiv('charity-map-actions');
		const fit = toolbar.createEl('button', {text: 'Fit all'});
		this.registerDomEvent(fit, 'click', () => { this.fitPolicy.resume(); this.fitAll(); });
		const parking = toolbar.createEl('button', {text: 'Add parking'});
		this.registerDomEvent(parking, 'click', () => {
			this.pickCopy = false;
			this.pickParking = !this.pickParking;
			parking.setText(this.pickParking ? 'Cancel pin placement' : 'Add parking');
			this.mapEl.toggleClass('charity-map-picking', this.pickParking);
			if (this.pickParking) new Notice('Tap the map where you want to add parking.');
		});
		const actions = toolbar.createEl('button', {text:'Map actions'});
		this.registerDomEvent(actions, 'click', event => this.showMapActions(event));
		// Listen for theme changes to update map tiles
		this.registerEvent(this.app.workspace.on('css-change', this.onThemeChange, this));

		// Add context menu to map
		this.registerDomEvent(this.mapEl, 'contextmenu', (evt) => {
			evt.preventDefault();
			this.showMapContextMenu(evt);
		});
	}

	onunload() {
		this.disposed = true;
		this.destroyMap();
		this.containerEl.remove();
	}

	/** Reduce flashing due to map re-rendering by debouncing while resizes are still ocurring. */
	private onResizeDebounce = debounce(
		() => { if (this.map) this.map.resize() },
		100,
		true);

	onResize(): void {
		this.onResizeDebounce();
	}

	public focus(): void {
		this.containerEl.focus({ preventScroll: true });
	}

	private onThemeChange = (): void => {
		if (this.map) {
			void this.updateMapStyle();
		}
	};

	private async updateMapStyle(): Promise<void> {
		if (!this.map || !this.mapConfig) return;
		const map = this.map;
		try {
			const newStyle = await this.styleManager.getMapStyle(this.mapConfig.mapTiles, this.mapConfig.mapTilesDark);
			if (this.map !== map || this.disposed) return;
			map.setStyle(newStyle);
			this.markerManager.clearLoadedIcons();

			// Style listeners flush this only once the replacement style is ready.
			this.markersPending = true;
		} catch (error) {
			if (this.map !== map || this.disposed) return;
			console.warn('Reseller sourcing map background:', error);
			this.showMapFailure();
		}
	}

	private async switchToTileSet(tileSetId: string): Promise<void> {
		const tileSet = this.plugin.settings.tileSets.find(ts => ts.id === tileSetId);
		if (!tileSet || !this.mapConfig) return;

		this.mapConfig.currentTileSetId = tileSetId;

		// Update the current tiles
		this.mapConfig.mapTiles = tileSet.lightTiles ? [tileSet.lightTiles] : [];
		this.mapConfig.mapTilesDark = tileSet.darkTiles
			? [tileSet.darkTiles]
			: (tileSet.lightTiles ? [tileSet.lightTiles] : []);

		// Update the map style
		await this.updateMapStyle();
	}

	private initializeMap(): Promise<void> {
		if (!this.initializePromise) this.initializePromise = this.initializeMapInner().finally(() => { this.initializePromise = null; });
		return this.initializePromise;
	}

	private async initializeMapInner(): Promise<void> {
		if (this.map) return;
		this.mapFailed = false;
		this.message.setText('Loading map…');

		initializeMapRuntime();

		// Load config first
		const currentTileSetId = this.mapConfig?.currentTileSetId || null;
		this.mapConfig = this.loadConfig(currentTileSetId);

		// Set initial map height based on context
		this.applyMapHeight();

		// Get the map style (may involve fetching remote style JSON)
		const mapStyle = await this.styleManager.getMapStyle(this.mapConfig.mapTiles, this.mapConfig.mapTilesDark);
		if (this.disposed) return;

		// Determine initial position: prefer ephemeral state if available, otherwise use config.
		// An unconfigured center starts at the default and is corrected to the marker
		// bounds once the style has loaded.
		let initialCenter = toLngLat(this.mapConfig.center ?? DEFAULT_MAP_CENTER);
		let initialZoom = this.mapConfig.defaultZoom;

		// Capture if we are starting with a pending state restoration
		const isRestoringState = this.pendingMapState !== null;

		const pendingCenter = this.pendingMapState?.center;
		if (pendingCenter) initialCenter = [pendingCenter.lng, pendingCenter.lat];
		initialZoom = this.pendingMapState?.zoom ?? initialZoom;

		// Initialize MapLibre GL JS map with configured tiles or default style
		this.map = new Map({
			container: this.mapEl,
			style: mapStyle,
			center: initialCenter,
			zoom: initialZoom,
			minZoom: this.mapConfig.minZoom,
			maxZoom: this.mapConfig.maxZoom,
			attributionControl: { compact: false },
		});
		for (const event of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) {
			this.map.on(event, e => { if (e.originalEvent) this.fitPolicy.userMoved(); });
		}
		this.map.on('click', e => {
			if (this.pickCopy) {
				e.preventDefault(); e.originalEvent?.preventDefault();
				this.pickCopy = false; this.mapEl.removeClass('charity-map-picking'); this.message.empty();
				void copyTextOrShow(this.app, formatCoordinates(roundCoordinate(e.lngLat.lat), roundCoordinate(e.lngLat.lng)), 'Coordinates');
				return;
			}
			if (!this.pickParking) return;
			e.preventDefault(); e.originalEvent?.preventDefault();
			this.pickParking = false;
			this.mapEl.removeClass('charity-map-picking');
			const button = this.containerEl.querySelector('.charity-map-actions button:nth-child(2)');
			if (button) button.textContent = 'Add parking';
			runMapAction(()=>this.plugin.openParking([roundCoordinate(e.lngLat.lat), roundCoordinate(e.lngLat.lng)], this.shopContext()));
		});

		// Set map reference in managers
		this.popupManager.setMap(this.map);
		this.markerManager.setMap(this.map);
		for (const event of ['style.load', 'load', 'idle'] as const) this.map.on(event, () => { void this.flushMarkers(); });
		this.markersPending = true;

		this.map.addControl(new CustomZoomControl(), 'top-right');

		// Desktop Electron grants the geolocation permission but has no location
		// provider behind it, so requests hang until they time out
		if (Platform.isMobileApp) {
			this.map.addControl(new CustomGeolocateControl(), 'top-right');
		}

		// Add background switcher if multiple tile sets are available
		if (this.plugin.settings.tileSets.length > 1) {
			const currentId = this.mapConfig.currentTileSetId || this.plugin.settings.tileSets[0]?.id || '';
			if (currentId) {
				this.map.addControl(
					new BackgroundSwitcherControl(
						this.plugin.settings.tileSets,
						currentId,
						(tileSetId) => void this.switchToTileSet(tileSetId)
					),
					'top-right'
				);
			}
		}

		this.map.on('error', (e) => {
			console.warn('Map error:', e);
			this.showMapFailure();
		});

		this.map.on('webglcontextlost', () => this.showMapFailure());

		// Ensure the center and zoom are set after map loads (in case the style loading overrides it)
		this.map.on('load', () => {
			if (!this.map || !this.mapConfig) return;
			if (!this.mapFailed) this.message.empty();

			// If we were restoring state, do not reset to defaults
			if (isRestoringState || this.pendingMapState) return;

			const configuredCenter = this.mapConfig.center;

			// Set center based on configuration
			if (configuredCenter) {
				this.map.setCenter(toLngLat(configuredCenter));
			}
			else {
				const bounds = this.markerManager.getBounds();
				if (bounds && !bounds.isEmpty()) {
					this.map.setCenter(bounds.getCenter()); // Center on markers
				}
			}

			// Set zoom based on configuration
			if (this.hasConfiguredZoom()) {
				this.map.setZoom(this.mapConfig.defaultZoom); // Use configured zoom
			}
			else {
				const bounds = this.markerManager.getBounds();
				if (bounds && !bounds.isEmpty()) {
					this.fitAll();
				}
			}
		});

		// Hide tooltip on the map element.
		this.mapEl.querySelector('canvas')?.setCssProps({ '--no-tooltip': 'true' });
	}

	private destroyMap(): void {
		this.popupManager.destroy();
		if (this.map) {
			this.map.remove();
			this.map = null;
		}
		this.markerManager.setMap(null);
	}

	public onDataUpdated(): void {
    const generation = ++this.contextGeneration;
    void this.resolveContext(generation).then(() => {
      if (!this.disposed && generation === this.contextGeneration) this.updateContextData();
    }).catch(error => {
      this.contextValid = false; this.destroyMap();
      if (!this.disposed) { this.message.setText('Notebook context unavailable: ' + String(error)); this.containerEl.removeClass('is-loading'); }
    });
  }

  private async resolveContext(generation = this.contextGeneration): Promise<void> {
    const raw = this.config.get('notebookRoot');
    const root = typeof raw === 'string' && raw ? raw : this.baseHost.settings.root;
    const host = root === this.baseHost.settings.root ? this.baseHost : await this.baseHost.resolveNotebook?.(root);
    if (!host) throw new Error('The example notebook is missing or this map has an invalid context.');
    await host.assertCurrent?.();
    if(this.disposed || generation !== this.contextGeneration) return;
    if (host !== this.plugin) { this.destroyMap(); this.lastConfigSnapshot = null; this.isFirstLoad = true; this.plugin = host; }
    this.contextValid = true;
  }

  private saveMapConfig(key:'center'|'defaultZoom', value:unknown): void {
    if(this.plugin.mode !== 'examples') { this.config.set(key,value); return; }
    void Promise.resolve().then(async () => {
      await this.plugin.assertCurrent?.();
      if (!this.contextValid || this.disposed) return;
      if (this.plugin.mode === 'examples') {
        const path = this.config.get('notebookBasePath');
        if (typeof path !== 'string' || !this.plugin.persistMapConfig) throw new Error('This practice map has no writable Base path.');
        await this.plugin.persistMapConfig(path,this.config.name,key,value);
      } else this.config.set(key,value);
      new Notice(key === 'center' ? 'Map centre saved' : 'Map zoom saved');
    }).catch(error => new Notice(String(error)));
  }

  private updateContextData(): void {
		if (this.disposed) return;
		this.containerEl.removeClass('is-loading');

		const configSnapshot = this.getConfigSnapshot();
		const configChanged = JSON.stringify(this.lastConfigSnapshot) !== JSON.stringify(configSnapshot);

		const currentTileSetId = this.mapConfig?.currentTileSetId || null;
		this.mapConfig = this.loadConfig(currentTileSetId);

		// Check if the evaluated center coordinates have changed
		const centerChanged = !sameCoordinates(this.mapConfig.center, this.lastEvaluatedCenter);

		void this.initializeMap().then(async () => {
			if (this.disposed) return;
			// Apply config to map on first load or when config changes
			if (configChanged) {
				await this.applyConfigToMap(this.lastConfigSnapshot, configSnapshot);
				this.lastConfigSnapshot = configSnapshot;
				this.isFirstLoad = false;
			}
			// Update center when the evaluated center coordinates change
			// (e.g., due to formula re-evaluation when active file changes)
			// But skip if we're restoring ephemeral state
			else if (this.map && !this.isFirstLoad && centerChanged && this.pendingMapState === null) {
				this.updateCenter();
			}

			if (this.map && this.data) {
				this.markersPending = true;
				await this.flushMarkers();

				// Apply pending map state if available (for restoring ephemeral state)
				if (this.pendingMapState && this.map) {
					const { center, zoom } = this.pendingMapState;
					if (center) {
						this.map.setCenter(center);
					}
					if (zoom !== null && zoom !== undefined) {
						this.map.setZoom(zoom);
					}
					this.pendingMapState = null;
				}
			}

			// Track state for next comparison
			if (this.mapConfig) {
				const center = this.mapConfig.center;
				this.lastEvaluatedCenter = center && [center[0], center[1]];
			}
		}).catch(error => { console.error('Reseller sourcing map:', error); if (!this.disposed) this.showMapFailure(); });
	}

	private showMapFailure(): void {
		if (this.disposed || (this.mapFailed && this.message.querySelector('button'))) return;
		this.mapFailed = true;
		this.containerEl.addClass('charity-map-tile-error');
		this.message.empty();
		this.message.createSpan({text:'Map unavailable or incomplete. Your notes remain available in the table. '});
		const retry = this.message.createEl('button', {text:'Retry map'});
		retry.addEventListener('click', () => { void this.retryMap(); }, {once:true});
	}

	private async retryMap(): Promise<void> {
		if (this.disposed) return;
		if (this.map) {
			const center = this.map.getCenter();
			this.pendingMapState = {center:{lat:center.lat,lng:center.lng},zoom:this.map.getZoom()};
			this.fitPolicy.userMoved();
		}
		this.destroyMap();
		this.containerEl.removeClass('charity-map-tile-error');
		this.markersPending = true;
		try { await this.initializeMap(); this.pendingMapState = null; await this.flushMarkers(); }
		catch (error) { console.warn('Reseller sourcing map retry:', error); this.showMapFailure(); }
	}

	private showMapActions(event: MouseEvent): void {
		const menu = new Menu();
		if (this.mapFailed) menu.addItem(item => item.setTitle('Retry map').setIcon('refresh-cw').onClick(() => { void this.retryMap(); }));
		menu.addItem(item => item.setTitle(this.pickCopy ? 'Cancel coordinate picking' : 'Copy coordinates from map…').setIcon('copy').onClick(() => {
			this.pickParking = false;
			const parking = this.containerEl.querySelector('.charity-map-actions button:nth-child(2)');
			if (parking) parking.textContent = 'Add parking';
			this.pickCopy = !this.pickCopy;
			this.mapEl.toggleClass('charity-map-picking', this.pickCopy);
			this.message.setText(this.pickCopy ? 'Tap the map to copy coordinates for that point.' : '');
		}));
		if (this.map && this.mapConfig) {
			menu.addItem(item => item.setTitle('Save current centre').setIcon('map-pin').onClick(() => {
				if (!this.map || !this.mapConfig) return;
				const center = this.map.getCenter();
				const lat = roundCoordinate(center.lat), lng = roundCoordinate(center.lng);
				this.mapConfig.center = [lat,lng];
				this.saveMapConfig('center', '[' + lat + ', ' + lng + ']');
				new Notice('Map centre saved');
			}));
			const zoom = Math.round(this.map.getZoom() * 10) / 10;
			menu.addItem(item => item.setTitle('Save current zoom (' + zoom + ')').setIcon('crosshair').onClick(() => {
				if (!this.map) return;
				this.saveMapConfig('defaultZoom', Math.round(this.map.getZoom() * 10) / 10);
				new Notice('Map zoom saved');
			}));
		}
		menu.showAtMouseEvent(event);
	}

	private mapData() {
		return {data: (this.data?.data ?? []).filter(entry => this.contextValid && hostOwnsPath(this.plugin,entry.file.path)), properties: this.data?.properties ?? []};
	}

	private async flushMarkers(): Promise<void> {
		if (this.renderingMarkers || !this.map?.isStyleLoaded() || this.disposed || !this.markersPending) return;
		this.renderingMarkers = true;
		try {
			while (this.markersPending && this.map?.isStyleLoaded() && !this.disposed) {
				this.markersPending = false;
				await this.markerManager.updateMarkers(this.mapData());
			}
			if (this.fitPolicy.automatic && !this.mapConfig?.center && !this.hasConfiguredZoom() && !this.pendingMapState) this.fitAll();
		} catch (error) {
			console.warn('Reseller sourcing marker rendering:', error);
		} finally { this.renderingMarkers = false; }
	}

	private shopContext(): string | undefined {
		const value = this.config.getEvaluatedFormula(this, 'shopPath');
		const path = value instanceof StringValue ? value.toString() : '';
		return path && hostOwnsPath(this.plugin,path) ? path : undefined;
	}

	private fitAll(): void {
		const bounds = this.markerManager.getBounds();
		if (this.map && bounds && !bounds.isEmpty()) this.map.fitBounds(bounds, fitOptions(Platform.isMobile));
	}

	/** A zoom of 0 is valid, so this tests for presence rather than truthiness. */
	private hasConfiguredZoom(): boolean {
		return Number.isNumber(this.config.get('defaultZoom'));
	}

	private updateZoom(): void {
		if (!this.map || !this.mapConfig) return;

		if (this.hasConfiguredZoom()) {
			this.map.setZoom(this.mapConfig.defaultZoom);
		}
	}

	private updateCenter(): void {
		if (!this.map || !this.mapConfig) return;

		const configuredCenter = this.mapConfig.center;
		if (configuredCenter) {
			// Only recenter if the evaluated coordinates actually changed
			const currentCenter = this.map.getCenter();
			if (!currentCenter) return; // Map not fully initialized yet

			const targetCenter = toLngLat(configuredCenter);
			const centerActuallyChanged = Math.abs(currentCenter.lng - targetCenter[0]) > 0.00001 ||
				Math.abs(currentCenter.lat - targetCenter[1]) > 0.00001;
			if (centerActuallyChanged) {
				this.map.setCenter(targetCenter);
			}
		}
	}

	private async applyConfigToMap(oldConfig: ConfigSnapshot | null, newConfig: ConfigSnapshot): Promise<void> {
		if (!this.map || !this.mapConfig) return;

		// Detect what changed
		const centerConfigChanged = oldConfig?.center !== newConfig.center;
		const zoomConfigChanged = oldConfig?.defaultZoom !== newConfig.defaultZoom;
		const tilesChanged = JSON.stringify(oldConfig?.mapTiles) !== JSON.stringify(newConfig.mapTiles) ||
			JSON.stringify(oldConfig?.mapTilesDark) !== JSON.stringify(newConfig.mapTilesDark);
		const heightChanged = oldConfig?.mapHeight !== newConfig.mapHeight;

		// Update map constraints
		this.map.setMinZoom(this.mapConfig.minZoom);
		this.map.setMaxZoom(this.mapConfig.maxZoom);

		// Clamp current zoom to new min/max bounds
		const currentZoom = this.map.getZoom();
		if (currentZoom < this.mapConfig.minZoom) {
			this.map.setZoom(this.mapConfig.minZoom);
		} else if (currentZoom > this.mapConfig.maxZoom) {
			this.map.setZoom(this.mapConfig.maxZoom);
		}

		// Skip updating zoom/center if we have pending ephemeral state to restore
		// (e.g., when navigating back in history to restore the user's last pan/zoom)
		const hasEphemeralState = this.pendingMapState !== null;

		// Only update zoom on first load or when zoom config explicitly changed
		// But skip if we're restoring ephemeral state
		if (!hasEphemeralState && (this.isFirstLoad || zoomConfigChanged)) {
			this.updateZoom();
		}

		// Update center on first load or when center config changed
		// But skip if we're restoring ephemeral state
		if (!hasEphemeralState && (this.isFirstLoad || centerConfigChanged)) {
			this.updateCenter();
		}

		// Update map style if tiles configuration changed
		if (this.isFirstLoad || tilesChanged) {
			const newStyle = await this.styleManager.getMapStyle(this.mapConfig.mapTiles, this.mapConfig.mapTilesDark);
			if (!this.map || this.disposed) return;
			const currentStyle = this.map.getStyle();
			if (JSON.stringify(newStyle) !== JSON.stringify(currentStyle)) {
				this.map.setStyle(newStyle);
				this.markerManager.clearLoadedIcons();
				this.markersPending = true;
			}
		}

		// Update map height for embedded views if height changed
		if (this.isFirstLoad || heightChanged) {
			this.applyMapHeight();
			// Resize map after height changes
			this.map.resize();
		}
	}

	isEmbedded(): boolean {
		// Check if this map view is embedded in a markdown file rather than opened directly
		// If the scrollEl has a parent with 'bases-embed' class, it's embedded
		return this.scrollEl.parentElement?.matchParent('.bases-embed, .block-language-base') != null;
	}

	/** Embedded views size to the configured height; direct views let CSS drive it. */
	private applyMapHeight(): void {
		const embedded = this.isEmbedded();
		this.mapEl.toggleClass('charity-map-embedded', embedded);
		if (embedded && this.mapConfig) this.mapEl.style.setProperty('--charity-map-embed-height', `min(${this.mapConfig.mapHeight}px, 80vh)`);
		else this.mapEl.style.removeProperty('--charity-map-embed-height');
	}

	private loadConfig(currentTileSetId: string | null): MapConfig {
		// Load property configurations
		const coordinatesProp = this.config.getAsPropertyId('coordinates');
		const markerIconProp = this.config.getAsPropertyId('markerIcon');
		const markerColorProp = this.config.getAsPropertyId('markerColor');

		// Load numeric configurations with validation
		const minZoom = this.getNumericConfig('minZoom', 0, 0, 24);
		const maxZoom = this.getNumericConfig('maxZoom', 18, 0, 24);
		const defaultZoom = this.getNumericConfig('defaultZoom', DEFAULT_MAP_ZOOM, minZoom, maxZoom);

		// Load center coordinates
		const center = this.getCenterFromConfig();

		// Load map height for embedded views
		const mapHeight = this.isEmbedded()
			? this.getNumericConfig('mapHeight', DEFAULT_MAP_HEIGHT, 100, 2000)
			: DEFAULT_MAP_HEIGHT;

		// Load map tiles configurations
		// Use view-specific tiles if configured, otherwise fall back to plugin defaults
		const viewSpecificTiles = this.getArrayConfig('mapTiles');
		const viewSpecificTilesDark = this.getArrayConfig('mapTilesDark');

		let mapTiles: string[];
		let mapTilesDark: string[];
		let selectedTileSetId: string | null;

		if (viewSpecificTiles.length > 0) {
			// View has specific tiles configured
			mapTiles = viewSpecificTiles;
			mapTilesDark = viewSpecificTilesDark;
			selectedTileSetId = null;
		} else if (this.plugin.settings.tileSets.length > 0) {
			// Use first tile set from plugin settings (or previously selected one)
			const tileSet = currentTileSetId
				? this.plugin.settings.tileSets.find(ts => ts.id === currentTileSetId)
				: null;
			const selectedTileSet = tileSet || this.plugin.settings.tileSets[0];

			selectedTileSetId = selectedTileSet.id;
			mapTiles = selectedTileSet.lightTiles ? [selectedTileSet.lightTiles] : [];
			mapTilesDark = selectedTileSet.darkTiles
				? [selectedTileSet.darkTiles]
				: (selectedTileSet.lightTiles ? [selectedTileSet.lightTiles] : []);
		} else {
			// No tiles configured, will fall back to default style
			mapTiles = [];
			mapTilesDark = [];
			selectedTileSetId = null;
		}

		return {
			coordinatesProp,
			markerIconProp,
			markerColorProp,
			mapHeight,
			defaultZoom,
			center,
			maxZoom,
			minZoom,
			mapTiles,
			mapTilesDark,
			currentTileSetId: selectedTileSetId,
		};
	}

	private getNumericConfig(key: string, defaultValue: number, min: number, max: number): number {
		const value = this.config.get(key);
		if (value == null || typeof value !== 'number') return defaultValue;

		return Math.min(max, Math.max(min, value));
	}

	private getArrayConfig(key: string): string[] {
		const value = this.config.get(key);
		if (!value) return [];

		// Handle array values
		if (Array.isArray(value)) {
			return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
		}

		// Handle single string value
		if (typeof value === 'string' && value.trim().length > 0) {
			return [value.trim()];
		}

		return [];
	}

	/** Returns null when no usable center is configured, so [0, 0] stays a real center. */
	private getCenterFromConfig(): [number, number] | null {
		let centerConfig: Value | null = null;

		try {
			centerConfig = this.config.getEvaluatedFormula(this, 'center');
		} catch {
			// Formula evaluation failed (e.g., this.file is null when no active file)
		}

		// Fall back to the raw config value, which also supports the legacy string format
		if (!centerConfig || Value.equals(centerConfig, NullValue.value)) {
			const centerConfigStr = this.config.get('center');
			if (!String.isString(centerConfigStr)) return null;
			centerConfig = new StringValue(centerConfigStr);
		}

		return coordinateFromValue(centerConfig);
	}

	private getConfigSnapshot(): ConfigSnapshot {
		// Create a snapshot of config values that affect map display
		return {
			center: this.config.get('center'),
			defaultZoom: this.config.get('defaultZoom'),
			minZoom: this.config.get('minZoom'),
			maxZoom: this.config.get('maxZoom'),
			mapHeight: this.config.get('mapHeight'),
			mapTiles: this.config.get('mapTiles'),
			mapTilesDark: this.config.get('mapTilesDark'),
		};
	}

	private showMapContextMenu(evt: MouseEvent): void {
		if (!this.map || !this.mapConfig) return;

		const currentZoom = Math.round(this.map.getZoom() * 10) / 10; // Round to 1 decimal place

		// Get coordinates from the location of the right-click event, not the map center
		const rect = this.mapEl.getBoundingClientRect();
		const clickPoint: [number, number] = [evt.clientX - rect.left, evt.clientY - rect.top];
		const clickedCoords = this.map.unproject(clickPoint);
		const currentLat = roundCoordinate(clickedCoords.lat);
		const currentLng = roundCoordinate(clickedCoords.lng);

		const menu = Menu.forEvent(evt);
		menu.addItem(item => item.setTitle('Add parking here').setIcon('square-parking').onClick(() => {
			runMapAction(()=>this.plugin.openParking([currentLat, currentLng], this.shopContext()));
		}));
		menu.addItem(item => item
			.setTitle('Copy coordinates')
			.setSection('action')
			.setIcon('copy')
			.onClick(() => {
				void copyTextOrShow(this.app, formatCoordinates(currentLat, currentLng), 'Coordinates');
			})
		);

		menu.addItem(item => item
			.setTitle('Set default center point')
			.setSection('action')
			.setIcon('map-pin')
			.onClick(() => {
				// Set the current center as the default coordinates
				const coordListStr = `[${currentLat}, ${currentLng}]`;

				// 1. Update the component's internal state immediately.
				// This ensures that if a re-render is triggered, its logic will use the
				// new coordinates and prevent the map from recentering on markers.
				if (this.mapConfig) {
					this.mapConfig.center = [currentLat, currentLng];
				}

				// 2. Set the config value, which will be saved.
				this.saveMapConfig('center', coordListStr);

				// 3. Immediately move the map for instant user feedback.
				this.map?.setCenter(toLngLat([currentLat, currentLng]));
			})
		);

		menu.addItem(item => item
			.setTitle(`Set default zoom (${currentZoom})`)
			.setSection('action')
			.setIcon('crosshair')
			.onClick(() => {
				this.saveMapConfig('defaultZoom', currentZoom);
			})
		);
	}

	public setEphemeralState(state: unknown): void {
		if (!state) {
			this.pendingMapState = null;
			return;
		}

		this.pendingMapState = {};
		if (hasOwnProperty(state, 'center') && hasOwnProperty(state.center, 'lng') && hasOwnProperty(state.center, 'lat')) {
			const lng = state.center.lng;
			const lat = state.center.lat;

			if (typeof lng === 'number' && typeof lat === 'number') {
				this.pendingMapState.center = { lng, lat };
			}
		}
		if (hasOwnProperty(state, 'zoom') && typeof state.zoom === 'number') {
			this.pendingMapState.zoom = state.zoom;
		}
	}

	public getEphemeralState(): unknown {
		if (!this.map) return {};

		const center = this.map.getCenter();
		return {
			center: { lng: center.lng, lat: center.lat },
			zoom: this.map.getZoom(),
		};
	}

	static getViewOptions(): BasesAllOptions[] {
		return [
			{
				displayName: 'Embedded height',
				type: 'slider',
				key: 'mapHeight',
				min: 200,
				max: 800,
				step: 20,
				default: DEFAULT_MAP_HEIGHT,
			},
			{
				displayName: 'Display',
				type: 'group',
				items: [

					{
						displayName: 'Center coordinates',
						type: 'formula',
						key: 'center',
						placeholder: '[latitude, longitude]',
					},
					{
						displayName: 'Default zoom',
						type: 'slider',
						key: 'defaultZoom',
						min: 1,
						max: 18,
						step: 1,
						default: DEFAULT_MAP_ZOOM,
					},
					{
						displayName: 'Minimum zoom',
						type: 'slider',
						key: 'minZoom',
						min: 0,
						max: 24,
						step: 1,
						default: 0,
					},
					{
						displayName: 'Maximum zoom',
						type: 'slider',
						key: 'maxZoom',
						min: 0,
						max: 24,
						step: 1,
						default: 18,
					},
				]
			},
			{
				displayName: 'Markers',
				type: 'group',
				items: [
					{
						displayName: 'Marker coordinates',
						type: 'property',
						key: 'coordinates',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Marker icon',
						type: 'property',
						key: 'markerIcon',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Marker color',
						type: 'property',
						key: 'markerColor',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
				]
			},
			{
				displayName: 'Background',
				type: 'group',
				items: [
					{
						displayName: 'Map tiles',
						type: 'multitext',
						key: 'mapTiles',
					},
					{
						displayName: 'Map tiles in dark mode',
						type: 'multitext',
						key: 'mapTilesDark',
					},
				]
			},
		];
	}
}
