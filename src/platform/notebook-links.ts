import { hasControlCharacters } from '../domain/guards';

export interface NotebookNavigationHandlers {
  root: () => string;
  rootForPath?: (path:string) => string|undefined;
  navigate: (path: string, action: 'drive' | 'walk' | 'listing') => Promise<void>;
  onError: (error: unknown) => void;
}
interface LinkElement {
  nodeType: number; tagName?: string; parentElement?: LinkElement | null;
  closest?: (selector: string) => LinkElement | null;
  getAttribute?: (name: string) => string | null;
}
function localPlacePath(path: string, root: string): boolean {
  return path.endsWith('.md') && ['Sources', 'Shops', 'Parking'].some(folder => path.startsWith(root + '/' + folder + '/')) &&
    !path.includes('\\') && !hasControlCharacters(path, false) && !path.split('/').some(part => !part || part === '.' || part === '..');
}
/**
 * Synced Bases may retain the vault name from their creation device. Route only
 * this plugin's place actions clicked inside a rendered Base to the current app.
 * Do not rewrite the Base or intercept explicit cross-vault links in note prose.
 */
export function handleNotebookNavigationClick(event: Event, handlers: NotebookNavigationHandlers): boolean {
  if (event.defaultPrevented) return false;
  const button = (event as MouseEvent).button;
  if (typeof button === 'number' && button !== 0 && button !== 1) return false;
  const target = event.target as LinkElement | null;
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  const anchor = element?.closest?.('a[href]');
  if (!anchor?.getAttribute || !anchor.closest?.('.bases-table-container, .bases-embed')) return false;
  const href = anchor.getAttribute('href'); if (!href) return false;
  let parsed: URL;
  try { parsed = new URL(href); } catch { return false; }
  if (parsed.protocol !== 'obsidian:' || parsed.hostname !== 'charity-sourcing' || parsed.pathname ||
    parsed.username || parsed.password || parsed.port || parsed.hash) return false;
  if (parsed.searchParams.getAll('action').length !== 1 || parsed.searchParams.getAll('path').length !== 1 ||
    parsed.searchParams.getAll('vault').length > 1) return false;
  const action = parsed.searchParams.get('action'), path = parsed.searchParams.get('path');
  if (!path) return false;
  if (action !== 'drive' && action !== 'walk' && action !== 'listing') return false;
  let root: string; try { root = handlers.rootForPath?.(path) ?? handlers.root(); } catch { return false; }
  if (!localPlacePath(path, root)) return false;
  // Prevent Obsidian's external URI routing synchronously, before resolving the
  // saved record and its parking destination in navigate().
  event.preventDefault(); event.stopImmediatePropagation();
  try { void Promise.resolve(handlers.navigate(path, action)).catch(handlers.onError); }
  catch (error) { handlers.onError(error); }
  return true;
}
