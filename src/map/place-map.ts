import { runMapAction } from './actions';
import { Component, Menu, Platform, setIcon } from 'obsidian';
import { Map as LibreMap, Marker, Popup, LngLatBounds } from 'maplibre-gl';
import type { Coordinates, PlaceRecord } from '../types';
import { formatRating } from '../domain';
import type { MapHost } from './host';
import { StyleManager } from './style';
import { CustomZoomControl } from './controls/zoom-control';
import { CustomGeolocateControl } from './controls/geolocate-control';
import { BackgroundSwitcherControl } from './controls/background-switcher';
import { FitPolicy, fitOptions, PLACE_ZOOM, mapCoordinates, ratingColour, visiblePlaces, validCoordinates, hostOwnsPath } from './policy';
import { appendNavigation } from './navigation';
import { initializeMapRuntime } from './runtime';
import { copyTextOrShow } from '../platform/clipboard';
import { MobileMapPopup } from './mobile-popup';

export interface PlaceMapOptions {
  records: PlaceRecord[];
  focusPath?: string;
  locality?: boolean;
  readOnly?: boolean;
  onPick?: (coordinates: Coordinates) => void;
  selectionLabel?: string;
}

/** Inline map: shares upstream tile styles and controls, with reviewed note writes. */
export class PlaceMap extends Component {
  private map: LibreMap | null = null;
  private records: PlaceRecord[];
  private markers: Marker[] = [];
  private popups: Popup[] = [];
  private camera = new FitPolicy();
  private disposed = false;
  private style: StyleManager;
  private root: HTMLElement;
  private canvas: HTMLElement;
  private message: HTMLElement;
  private toolbar: HTMLElement;
  private pickMode: 'parking' | 'move' | 'copy' | null = null;
  private failed = false;
  private retryCamera: {center:[number,number];zoom:number} | null = null;
  private activeTileSet: string | undefined;
  private generation = 0;
  private touchPopup: MobileMapPopup;

  constructor(container: HTMLElement, private host: MapHost, private options: PlaceMapOptions) {
    super();
    this.records = options.records.filter(p => hostOwnsPath(host,p.path));
    this.style = new StyleManager(host.app);
    this.activeTileSet = host.settings.tileSets[0]?.id;
    this.root = container.createDiv('charity-map-container charity-place-map');
    if (Platform.isMobileApp) this.root.addClass('charity-map-mobile');
    this.canvas = this.root.createDiv('charity-map charity-place-map-canvas');
    if (options.locality) this.root.addClass('charity-locality-map');
    this.touchPopup = new MobileMapPopup(this.root);
    this.toolbar = this.root.createDiv('charity-map-actions');
    this.message = this.root.createDiv({cls:'charity-map-message', attr:{role:'status'}});
  }

  onload(): void {
    this.disposed = false;
    this.makeActions();
    const observer = new ResizeObserver(() => this.map?.resize());
    observer.observe(this.canvas);
    this.register(() => observer.disconnect());
    this.registerEvent(this.host.app.workspace.on('css-change', () => { void this.updateStyle(); }));
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    const generation = ++this.generation;
    this.failed = false;
    this.message.setText('Loading map…');
    try {
      initializeMapRuntime();
      const tile = this.host.settings.tileSets.find(t => t.id === this.activeTileSet);
      const style = await this.style.getMapStyle(tile?.lightTiles ? [tile.lightTiles] : [], tile?.darkTiles ? [tile.darkTiles] : []);
      if (this.disposed || generation !== this.generation) return;
      const focus = this.records.find(r => r.path === this.options.focusPath);
      const first = validCoordinates(focus?.coordinates) ? focus.coordinates : this.places()[0]?.coordinates;
      const map = this.map = new LibreMap({container:this.canvas, style, center:this.retryCamera?.center ?? (first ? mapCoordinates(first) : [0, 0]),
        zoom: this.retryCamera?.zoom ?? (first && !this.options.locality ? PLACE_ZOOM : 3), maxZoom:22,
        attributionControl:{compact:false}});
      map.addControl(new CustomZoomControl(), 'top-right');
      if (Platform.isMobileApp) map.addControl(new CustomGeolocateControl(), 'top-right');
      if (this.host.settings.tileSets.length > 1) {
        map.addControl(new BackgroundSwitcherControl(this.host.settings.tileSets, this.activeTileSet ?? '', id => {
          this.activeTileSet = id; void this.updateStyle();
        }), 'top-right');
      }
      for (const event of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) map.on(event, e => {
        if (e.originalEvent) this.camera.userMoved();
      });
      map.on('load', () => {
        if (this.disposed || this.map !== map) return;
        if (!this.failed) this.message.empty();
        this.renderMarkers();
        if (!this.retryCamera && (this.options.locality || (this.options.onPick && !validCoordinates(this.records.find(r => r.path === this.options.focusPath)?.coordinates)))) this.fitAll();
        this.retryCamera = null;
      });
      map.on('error', error => {
        console.warn('Reseller sourcing map tiles:', error.error);
        if (this.map === map) this.showMapFailure();
      });
      map.on('webglcontextlost', () => { if (this.map === map) this.showMapFailure(); });
      map.on('click', event => {
        if (!this.pickMode) return;
        runMapAction(() => this.pick([event.lngLat.lat, event.lngLat.lng]));
      });
      map.on('contextmenu', event => {
        event.preventDefault();
        const coordinates: Coordinates = [event.lngLat.lat, event.lngLat.lng];
        const menu = new Menu();
        menu.addItem(item => item.setTitle('Copy coordinates').setIcon('copy').onClick(() => { void this.copy(coordinates); }));
        if (this.options.readOnly) { /* Outing maps show saved locations without editing them. */ }
        else if (this.options.onPick) menu.addItem(item => item.setTitle('Use this location').setIcon('map-pin').onClick(() => this.options.onPick?.(coordinates)));
        else {
          menu.addItem(item => item.setTitle('Add parking here').setIcon('square-parking').onClick(() => { runMapAction(()=>this.host.openParking(coordinates, this.shopPath())); }));
          const focusPath = this.options.focusPath;
          if (focusPath) menu.addItem(item => item.setTitle('Move this place here…').setIcon('move').onClick(() => { runMapAction(()=>this.host.confirmMove(focusPath, coordinates)); }));
        }
        menu.showAtMouseEvent(event.originalEvent);
      });
      this.renderMarkers();
    } catch (error) {
      if (this.disposed) return;
      console.error('Reseller sourcing map initialization:', error);
      this.showMapFailure();
    }
  }

  private showMapFailure(): void {
    if (this.disposed || (this.failed && this.message.querySelector('button'))) return;
    this.failed = true;
    this.message.empty();
    this.message.createSpan({text:'Map unavailable or incomplete. Your notes and coordinates remain available. '});
    const retry = this.message.createEl('button', {text:'Retry map'});
    retry.addEventListener('click', () => { this.retryMap(); }, {once:true});
  }

  private retryMap(): void {
    if (this.disposed) return;
    if (this.map) { const center = this.map.getCenter(); this.retryCamera = {center:[center.lng,center.lat],zoom:this.map.getZoom()}; }
    this.markers.forEach(marker => marker.remove()); this.popups.forEach(popup => popup.remove());
    this.touchPopup.close(false);
    this.markers = []; this.popups = [];
    this.map?.remove(); this.map = null;
    void this.initialize();
  }

  private async updateStyle(): Promise<void> {
    const map = this.map;
    if (!map) return;
    const tile = this.host.settings.tileSets.find(t => t.id === this.activeTileSet);
    try {
      const style = await this.style.getMapStyle(tile?.lightTiles ? [tile.lightTiles] : [], tile?.darkTiles ? [tile.darkTiles] : []);
      if (!this.disposed && this.map === map) map.setStyle(style);
    } catch (error) { console.warn('Reseller sourcing map background:', error); this.showMapFailure(); }
  }

  private makeActions(): void {
    this.toolbar.empty();
    const add = (label: string, callback: () => void) => {
      const button = this.toolbar.createEl('button', {text:label});
      button.addEventListener('click', callback);
    };
    add('Fit all', () => this.fitAll());
    const actions = this.toolbar.createEl('button', {text:'Map actions'});
    actions.addEventListener('click', event => {
      const menu = new Menu();
      if (this.failed) menu.addItem(item => item.setTitle('Retry map').setIcon('refresh-cw').onClick(() => this.retryMap()));
      menu.addItem(item => item.setTitle(this.pickMode === 'copy' ? 'Cancel coordinate picking' : 'Copy coordinates from map…').setIcon('copy').onClick(() => this.setPickMode(this.pickMode === 'copy' ? null : 'copy')));
      menu.showAtMouseEvent(event);
    });
    if (this.options.readOnly) { if (this.pickMode === 'copy') add('Cancel picking', () => this.setPickMode(null)); return; }
    if (this.options.onPick) add('Choose pin location', () => this.setPickMode('move'));
    else {
      add('Add parking', () => this.setPickMode('parking'));
      if (this.options.focusPath) add('Move pin', () => this.setPickMode('move'));
    }
    if (this.pickMode) add('Cancel placement', () => this.setPickMode(null));
  }

  private shopPath(): string | undefined {
    return this.records.find(r => r.path === this.options.focusPath)?.kind === 'shop' ? this.options.focusPath : undefined;
  }
  private places(): PlaceRecord[] { return visiblePlaces(this.records, this.host.settings.root); }

  setPickMode(mode: 'parking' | 'move' | 'copy' | null): void {
    if (this.options.readOnly && mode && mode !== 'copy') return;
    this.pickMode = mode;
    this.canvas.toggleClass('charity-map-picking', mode !== null);
    this.message.setText(mode ? `Tap the map to ${mode === 'parking' ? 'add parking' : mode === 'copy' ? 'copy coordinates' : 'choose the new location'}.` : '');
    this.makeActions();
  }
  private async pick(coordinates: Coordinates): Promise<void> {
    const mode = this.pickMode;
    this.setPickMode(null);
    try { await this.host.assertCurrent?.(); } catch { return; }
    if (mode === 'copy') { void this.copy(coordinates); return; }
    if (this.options.onPick) this.options.onPick(coordinates);
    else if (mode === 'parking') runMapAction(()=>this.host.openParking(coordinates, this.shopPath()));
    else if (mode === 'move' && this.options.focusPath) {
      const focusPath = this.options.focusPath;
      runMapAction(()=>this.host.confirmMove(focusPath, coordinates));
    }
  }

  setRecords(records: PlaceRecord[]): void {
    this.records = records.filter(p => hostOwnsPath(this.host,p.path));
    if (!this.map || this.disposed) return;
    this.renderMarkers();
    if (!this.camera.automatic) return;
    if (this.options.locality) this.fitAll();
    else {
      const focus = this.records.find(r => r.path === this.options.focusPath);
      if (validCoordinates(focus?.coordinates)) this.map.jumpTo({center:mapCoordinates(focus.coordinates), zoom:PLACE_ZOOM});
      else if (this.options.onPick) this.fitAll();
    }
  }
  fitAll(): void {
    this.camera.resume();
    const places = this.places();
    if (!this.map || !places.length) return;
    const bounds = new LngLatBounds();
    places.forEach(p => { if (validCoordinates(p.coordinates)) bounds.extend(mapCoordinates(p.coordinates)); });
    this.map.fitBounds(bounds, fitOptions(Platform.isMobile));
  }

  private renderMarkers(): void {
    this.markers.forEach(marker => marker.remove());
    this.popups.forEach(popup => popup.remove());
    this.touchPopup.close(false);
    this.markers = []; this.popups = [];
    if (!this.map) return;
    for (const place of this.places()) {
      if (!validCoordinates(place.coordinates)) continue;
      const button = createEl('button', {cls: 'charity-place-marker'});
      const label = `${place.name}${place.kind === 'shop' ? ': ' + formatRating(place.properties.rating) : ': Parking'}`;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.style.setProperty('--charity-marker-colour', place.kind === 'parking' ? '#7c3aed' : ratingColour(place.properties.rating));
      setIcon(button, place.kind === 'parking' ? 'square-parking' : 'store');
      if (place.kind === 'shop') {
        const score = button.createSpan('charity-marker-score');
        score.textContent = typeof place.properties.rating === 'number' ? String(place.properties.rating) : '0';
      }
      const marker = new Marker({element:button}).setLngLat(mapCoordinates(place.coordinates)).addTo(this.map);
      if (Platform.isMobileApp) {
        button.addEventListener('click', event => {
          event.stopPropagation();
          this.touchPopup.open(this.popup(place), place.name, button);
        });
      } else {
        const popup = new Popup({offset:20, closeButton:true, maxWidth:'320px'}).setDOMContent(this.popup(place));
        marker.setPopup(popup);
        this.popups.push(popup);
      }
      this.markers.push(marker);
    }
  }

  private popup(place: PlaceRecord): HTMLElement {
    const content = createDiv('charity-map-popup');
    if (Platform.isMobileApp) content.addClass('charity-map-mobile');
    const title = content.createEl(this.options.onPick ? 'span' : 'button', {text:place.name, cls:'charity-popup-title'});
    if (this.options.selectionLabel) title.setText(this.options.selectionLabel + ': ' + place.name);
    if (!this.options.onPick) title.addEventListener('click', () => {
      if (this.host.openFile) runMapAction(()=>this.host.openFile?.(place.path));
      else runMapAction(() => this.host.app.workspace.openLinkText(place.path, '', false));
    });
    if (place.kind === 'shop') content.createEl('p', {text:formatRating(place.properties.rating)});
    for (const [key, label] of (place.kind === 'shop' ? [['comments','Takeaway'],['last_visited','Last visit']] : [['parking_cost','Cost'],['parking_availability','Usual availability']])) {
      const value = place.properties[key];
      if ((typeof value === 'string' && value !== '') || typeof value === 'number' || typeof value === 'boolean') content.createEl('p', {text:`${label}: ${String(value)}`});
    }
    appendNavigation(content,place,this.records,this.host);
    const copy = content.createEl('button',{text:'Copy coordinates'});
    copy.addEventListener('click',() => { if (validCoordinates(place.coordinates)) void this.copy(place.coordinates); });
    return content;
  }
  private async copy(coordinates: Coordinates): Promise<void> {
    await copyTextOrShow(this.host.app, coordinates.join(', '), 'Coordinates');
  }
  destroy(): void { this.unload(); }
  onunload(): void {
    this.disposed = true; this.generation++;
    this.markers.forEach(m => m.remove()); this.popups.forEach(p => p.remove());
    this.touchPopup.destroy();
    this.markers = []; this.popups = [];
    this.map?.remove(); this.map = null;
    this.root.remove();
  }
}

export function mountPlaceMap(owner: Component, container: HTMLElement, host: MapHost, options: PlaceMapOptions): PlaceMap {
  const map = new PlaceMap(container,host,options);
  owner.addChild(map);
  return map;
}
