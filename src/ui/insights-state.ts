import type { InsightsState } from './visit-insights';

// Obsidian can replace a Markdown render child after metadata settles. Keep
// transient filters on its containing pane, without writing notebook settings.
const panes = new WeakMap<HTMLElement, Map<string, InsightsState>>();
export function embeddedInsightsState(element: HTMLElement, path: string): InsightsState {
  const pane = element.closest<HTMLElement>('.workspace-leaf') ?? element;
  let states = panes.get(pane);
  if (!states) { states = new Map(); panes.set(pane, states); }
  let state = states.get(path);
  if (!state) {
    state = {}; states.set(path, state);
    if (states.size > 24) states.delete(states.keys().next().value!);
  }
  return state;
}
