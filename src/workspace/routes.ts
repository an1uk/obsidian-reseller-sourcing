import type { WorkspaceRoute } from './types';
import { hasControlCharacters, isRecord } from '../domain/guards';

export function routeForPath(root: string, path: string): WorkspaceRoute | undefined {
  if (!path.startsWith(root + '/') || path.startsWith(root + '/Examples/') || path.includes('\\') || hasControlCharacters(path, false) || path.split('/').some(p => p === '..' || p === '.')) return;
  if (path === root + '/Home.md') return { screen: 'home' };
  if ([root + '/Sources.md', root + '/Parking.md', root + '/Localities.md'].includes(path)) return { screen: 'places' };
  if (path === root + '/Outings.md') return { screen: 'outings' };
  if (path === root + '/Visits.md') return { screen: 'history' };
  if (path.startsWith(root + '/Outings/') && path.endsWith('.md')) return { screen: 'outing', path };
  if (path.startsWith(root + '/Visits/') && path.endsWith('.md')) return { screen: 'visit', path };
  if (path.startsWith(root + '/Places/') && path.endsWith('/Area.md') || path.startsWith(root + '/Localities/') && path.endsWith('.md')) return { screen: 'area', path };
  if (/\.md$/.test(path) && ['Places', 'Sources', 'Shops', 'Parking'].some(folder => path.startsWith(root + '/' + folder + '/'))) return { screen: 'place', path };
}
export function checkedRoute(root: string, raw: unknown): WorkspaceRoute {
  if (!isRecord(raw)) return { screen: 'home' };
  const r = raw;
  if (r.screen === 'home' || r.screen === 'places' || r.screen === 'outings' || r.screen === 'history' || r.screen === 'more') return { screen: r.screen };
  if (typeof r.path !== 'string') return { screen: 'home' };
  const route = routeForPath(root,r.path);
  if (!route || route.screen !== r.screen) return { screen: 'home' };
  if (route.screen === 'place' && (r.section === 'overview' || r.section === 'map' || r.section === 'visits' || r.section === 'details')) route.section = r.section;
  return route;
}
