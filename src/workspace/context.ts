import type { NotebookContext } from '../notebook-context';

export type WorkspaceContextActions = Pick<NotebookContext, 'openFile' | 'home' | 'newPlace' | 'newOuting'>;

/** Navigation is pane-local; every other capability reads the original live context. */
export function workspaceContext(original: NotebookContext, actions: WorkspaceContextActions): NotebookContext {
  return {
    get kind() { return original.kind; },
    get root() { return original.root; },
    get label() { return original.label; },
    get externalActions() { return original.externalActions; },
    get host() { return original.host; },
    get app() { return original.app; },
    get manifest() { return original.manifest; },
    get basesReady() { return original.basesReady; },
    get settings() { return original.settings; },
    get store() { return original.store; },
    get mapHost() { return { ...original.mapHost, openFile: (path: string) => actions.openFile(path) }; },
    get referencePath() { return original.referencePath; },
    get tourPath() { return original.tourPath; },
    beginEditing: () => original.beginEditing(),
    runRootOperation: (run, recovery) => original.runRootOperation(run, recovery),
    openExternal: (url, title) => original.openExternal(url, title),
    openFile: path => actions.openFile(path),
    home: () => actions.home(),
    newPlace: (kind, coordinates, shopPath) => actions.newPlace(kind, coordinates, shopPath),
    newOuting: () => actions.newOuting(),
    newLocality: () => original.newLocality(),
    reviewCaptures: explicit => original.reviewCaptures(explicit),
    saveSettings: () => original.saveSettings(),
    openClipperSetup: () => original.openClipperSetup(),
    openClipperImportTools: () => original.openClipperImportTools(),
    revealTemplates: kind => original.revealTemplates(kind),
    notifyClipperStatusChanged: () => original.notifyClipperStatusChanged(),
    onClipperStatusChanged: callback => original.onClipperStatusChanged(callback),
  };
}
