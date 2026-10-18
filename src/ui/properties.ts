import { MarkdownView } from 'obsidian';
import type { NotebookUiHost } from '../notebook-context';
import { isRecord } from '../domain/guards';

interface NativePropertiesEditor {
  containerEl: HTMLElement;
  headingEl?: HTMLElement;
  collapsed: boolean;
  setCollapse(collapsed: boolean, animateAndPersist?: boolean): void;
}
interface OpenPlaceState {
  path: string;
  applied: boolean;
  heading?: HTMLElement;
  detach?: () => void;
}

function element(value: unknown): value is HTMLElement {
  const isNode = (candidate: unknown): candidate is Node => isRecord(candidate) && typeof candidate.nodeType === 'number' && typeof candidate.instanceOf === 'function';
  return isNode(value) && value.instanceOf(HTMLElement);
}

/** The native API is internal: leave Properties unchanged if Obsidian changes it. */
function propertiesEditor(view: MarkdownView): NativePropertiesEditor | undefined {
  const native: unknown = view;
  if (!isRecord(native) || !isRecord(native.metadataEditor)) return;
  const value = native.metadataEditor;
  if (!element(value.containerEl) || typeof value.collapsed !== 'boolean' || typeof value.setCollapse !== 'function') return;
  const setCollapse = value.setCollapse;
  return { containerEl: value.containerEl, headingEl: element(value.headingEl) ? value.headingEl : undefined,
    collapsed: value.collapsed, setCollapse: (collapsed, animateAndPersist) => { setCollapse.call(value, collapsed, animateAndPersist); } };
}

function isPlacePath(path: string, root: string): boolean {
  return /\.md$/i.test(path) && (path === root + '/Home.md' || ['Places', 'Sources', 'Shops', 'Parking', 'Visits'].some(folder => path.startsWith(root + '/' + folder + '/')));
}

/**
 * Default inline native Properties to collapsed once for each opened place.
 * State belongs to the pane and file, so metadata refreshes and user expansion
 * do not reapply the default. No frontmatter or vault configuration is written.
 */
export function registerPlacePropertiesDefault(plugin: NotebookUiHost): void {
  const workspace = plugin.app.workspace;
  const states = new Map<MarkdownView, OpenPlaceState>();
  const timers = new Set<number>();
  let disposed = false;

  const forget = (view: MarkdownView): void => {
    states.get(view)?.detach?.();
    states.delete(view);
  };

  const scan = (applyDefault = true): void => {
    if (disposed) return;
    const seen = new Set<MarkdownView>();
    for (const leaf of workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      seen.add(view);
      const path = view.file?.path;
      const root = path ? plugin.contextRootForPath(path) : undefined;
      if (!path || !root || !isPlacePath(path, root)) { forget(view); continue; }

      let state = states.get(view);
      if (state?.path !== path) {
        forget(view);
        state = { path, applied: false };
        states.set(view, state);
      }
      if (state.applied || !applyDefault) continue;

      const editor = propertiesEditor(view);
      if (!editor || !editor.containerEl.isConnected || !view.contentEl.contains(editor.containerEl)) continue;
      const heading = element(editor.headingEl)
        ? editor.headingEl
        : editor.containerEl.querySelector<HTMLElement>('.metadata-properties-heading');
      if (!heading) continue;

      if (state.heading !== heading) {
        state.detach?.();
        const openState = state;
        // A user who interacts before the deferred default takes priority.
        const choseState = (): void => { openState.applied = true; };
        const keydown = (event: KeyboardEvent): void => {
          if (['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) choseState();
        };
        heading.addEventListener('click', choseState, true);
        heading.addEventListener('keydown', keydown, true);
        state.heading = heading;
        state.detach = () => {
          heading.removeEventListener('click', choseState, true);
          heading.removeEventListener('keydown', keydown, true);
        };
      }

      // Background tabs, raw Source mode and globally hidden Properties have no
      // visible native heading. Wait for a later pane/layout event in that case.
      if (!heading.getClientRects().length || !editor.containerEl.getClientRects().length) continue;
      if (editor.containerEl.contains(editor.containerEl.ownerDocument.activeElement)) {
        state.applied = true; continue;
      }

      state.applied = true;
      if (editor.collapsed) continue;
      try {
        // Verified in Obsidian 1.14.4: false skips animation and onMarkdownFold,
        // leaving native expansion available without saving a fold-state change.
        editor.setCollapse(true, false);
      } catch {
        // One attempt only. Future/unsupported hosts retain their native UI.
      }
    }
    for (const view of states.keys()) if (!seen.has(view)) forget(view);
  };

  const schedule = (): void => {
    if (disposed) return;
    // Observe file identity immediately, including rapid away-and-back switches,
    // while deferring native UI changes until the file-open event has settled.
    scan(false);
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    // Loading panes can expose their file before their native Properties exists.
    // These bounded retries cover that gap; no observer or recurring poll runs.
    for (const delay of [0, 80, 300, 900]) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        scan();
      }, delay);
      timers.add(timer);
    }
  };

  plugin.registerEvent(workspace.on('file-open', schedule));
  plugin.registerEvent(workspace.on('layout-change', schedule));
  plugin.registerEvent(workspace.on('active-leaf-change', schedule));
  plugin.register(() => {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    for (const view of states.keys()) forget(view);
  });
  workspace.onLayoutReady(schedule);
}
