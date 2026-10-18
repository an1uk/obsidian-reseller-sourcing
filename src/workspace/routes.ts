import type { WorkspaceRoute } from './types';

export function routeForPath(root: string, path: string): WorkspaceRoute | undefined {
  if (!path.startsWith(root + '/') || path.startsWith(root + '/Examples/') || /[\\\x00-\x1f]/.test(path) || path.split('/').some(p => p === '..' || p === '.')) return;
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
  if (!raw || typeof raw !== 'object') return { screen: 'home' };
  const r = raw as Record<string, unknown>;
  if (['home','places','outings','history','more'].includes(String(r.screen))) return { screen: r.screen } as WorkspaceRoute;
  if (typeof r.path !== 'string') return { screen: 'home' };
  const route = routeForPath(root,r.path);
  if (!route || route.screen !== r.screen) return { screen: 'home' };
  if (route.screen === 'place' && ['overview','map','visits','details'].includes(String(r.section))) route.section = r.section as 'overview'|'map'|'visits'|'details';
  return route;
}
