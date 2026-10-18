import type { Coordinates, PlaceKind } from '../types';
import type { NotebookContext, NotebookUiHost } from '../notebook-context';
import type { ExamplesSession } from './state';
import type { MapHost } from '../map';
import { CaptureModal, LocalityModal, VisitModal, manualDraft } from '../ui';
import { NewOutingModal } from '../ui/outings';
import { Notice, TFile } from 'obsidian';
import { showSelectableText } from '../platform/clipboard';
import { openSourcingWorkspace, routeForPath } from '../workspace/view';
import { PlacePreparationModal } from '../workspace/place-preparation';

export interface ContextServices extends NotebookUiHost {
  beginEditing(): (() => void) | undefined;
  runRootOperation<T>(run: () => Promise<T>, recovery?: boolean): Promise<T>;
  reviewContextCaptures(context: NotebookContext, explicit?: boolean): Promise<void>;
  confirmContextMove(context: NotebookContext, path: string, coordinates: Coordinates): void;
}

/** A practice pane retains one session. No operation reassigns the real store. */
export class ExamplesContext implements NotebookContext {
  readonly kind = 'examples' as const;
  readonly externalActions = 'preview' as const;
  readonly label = 'Fictional examples';
  readonly mapHost: MapHost;
  get root() { return this.session.root; }
  get settings() { return this.session.settings; }
  get store() { return this.session.store; }
  get app() { return this.host.app; }
  get manifest() { return this.host.manifest; }
  get basesReady() { return this.host.basesReady; }
  get referencePath() { return this.root + '/Reference/Overview.md'; }
  get tourPath() { return this.root + '/Guided tour/Start here.md'; }
  constructor(readonly host: ContextServices, readonly session: ExamplesSession) {
    this.mapHost = {
      app: this.app, settings: this.settings, mode: 'examples', reportError:error=>new Notice(String(error)),
      ownsPath: path => this.store.scoped(path),
      assertCurrent: () => this.session.assertCurrent(),
      getPlaces: () => this.store.listPlaces(),
      openFile: path => this.openFile(path),
      openExternal: (url,title) => this.openExternal(url,title),
      openParking: (coordinates,path) => this.newPlace('parking',coordinates,path),
      confirmMove: (path,coordinates) => this.host.confirmContextMove(this,path,coordinates),
      persistMapConfig: (path,view,key,value) => this.store.updateMapView(path,view,key,value),
    };
  }
  beginEditing() {
    try { this.session.assertCurrent(); if (this.store.migrationActive) throw new Error('Open Practice settings to recover the example organisation first.'); }
    catch (error) { new Notice(String(error)); return; }
    return this.host.beginEditing();
  }
  runRootOperation<T>(run: () => Promise<T>, recovery = false) {
    this.session.assertCurrent();
    return this.host.runRootOperation(run,recovery);
  }
  openExternal(url: string, title = 'Destination') {
    this.session.assertCurrent();
    showSelectableText(this.app,'FICTIONAL EXAMPLE - destination preview only. No external app was opened.\n\n' + url,title + ' - fictional preview');
  }
  async openFile(path: string): Promise<void> {
    this.session.assertCurrent();
    const route = routeForPath(this.root, path); if (route) return openSourcingWorkspace(this.host, this, route);
    const hash = path.indexOf('#'), filePath = hash < 0 ? path : path.slice(0, hash), fragment = hash < 0 ? '' : path.slice(hash + 1);
    if (!filePath.startsWith(this.root + '/') || /[\\\x00-\x1f]/.test(filePath) || filePath.split('/').some(part => !part || part === '..' || part === '.') ||
        /[\x00-\x1f]/.test(fragment)) throw new Error('Choose a note inside Examples.');
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) throw new Error('This example note no longer exists. It will not be recreated automatically.');
    if (fragment) await this.app.workspace.openLinkText(file.path + '#' + fragment, this.root + '/Home.md', false);
    else await this.app.workspace.getLeaf(false).openFile(file);
  }
  home(): Promise<void> { return this.openFile(this.root + '/Home.md'); }
  newPlace(kind: PlaceKind, coordinates: Coordinates | null = null, shopPath?: string) {
    this.session.assertCurrent();
    new PlacePreparationModal(this,manualDraft(kind,coordinates),shopPath).open();
  }
  newOuting() { this.session.assertCurrent(); new NewOutingModal(this).open(); }
  newLocality() { this.session.assertCurrent(); new LocalityModal(this).open(); }
  reviewCaptures(explicit = true) { return explicit ? this.host.reviewContextCaptures(this,true) : Promise.resolve(); }
  saveSettings() { return this.session.save(); }
  openClipperSetup() { void this.openFile(this.referencePath); }
  openClipperImportTools() { this.openClipperSetup(); return Promise.resolve(false); }
  async revealTemplates() { await this.openFile(this.referencePath); }
  notifyClipperStatusChanged() {}
  onClipperStatusChanged(_callback: () => void) { return () => {}; }
}
