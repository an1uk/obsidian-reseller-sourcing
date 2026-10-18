interface RenderState {
  sections: Map<string, boolean>;
  values: Map<string, string>;
  focus?: string;
  selection?: [number | null, number | null];
  scroll: number;
}
const panes = new WeakMap<HTMLElement, Map<string, RenderState>>();
function elements(container: HTMLElement): HTMLElement[] { return Array.from(container.querySelectorAll<HTMLElement>('button,a,input,textarea,select,summary')); }
function key(element: HTMLElement, all: HTMLElement[]): string {
  const explicit = element.getAttribute('data-charity-focus'); if (explicit) return explicit;
  const identity = (value: HTMLElement) => value.tagName + ':' + (value.getAttribute('aria-label') || value.getAttribute('placeholder') || (value.textContent ?? '').trim());
  const same = all.filter(value => identity(value) === identity(element));
  return identity(element) + ':' + same.indexOf(element);
}
function sectionKey(section: HTMLDetailsElement, index: number): string {
  return section.getAttribute('data-charity-section') || (section.querySelector('summary')?.textContent ?? '').replace(/\s*\(\d+\)$/, '') + ':' + index;
}
/** Preserve transient pane state; never save form values into notebook settings. */
export function rememberRenderState(container: HTMLElement, path: string): () => void {
  const pane = container.closest<HTMLElement>('.workspace-leaf') ?? container;
  let states = panes.get(pane); if (!states) { states = new Map(); panes.set(pane, states); }
  const scroll = container.closest<HTMLElement>('.markdown-preview-view,.cm-scroller');
  const all = elements(container), active = container.ownerDocument.activeElement as HTMLElement | null;
  let state = states.get(path);
  if (all.length) {
    state = { sections: new Map(), values: new Map(), scroll: scroll?.scrollTop ?? 0 };
    container.querySelectorAll<HTMLDetailsElement>('details').forEach((section, index) => state!.sections.set(sectionKey(section, index), section.open));
    for (const element of all) if (element instanceof HTMLInputElement && element.type === 'search') state.values.set(key(element, all), element.value);
    if (active && container.contains(active)) {
      state.focus = key(active, all);
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) state.selection = [active.selectionStart, active.selectionEnd];
    }
    states.set(path, state); if (states.size > 24) states.delete(states.keys().next().value!);
  }
  const saved = state;
  return () => {
    if (!saved || !container.isConnected) return;
    container.querySelectorAll<HTMLDetailsElement>('details').forEach((section, index) => { const open = saved.sections.get(sectionKey(section, index)); if (open !== undefined) section.open = open; });
    const current = elements(container);
    for (const element of current) {
      const value = saved.values.get(key(element, current));
      if (value !== undefined && element instanceof HTMLInputElement && element.type === 'search' && element.value !== value) { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    const now = container.ownerDocument.activeElement;
    if (saved.focus && (!now || now === container.ownerDocument.body || now === active)) {
      const target = current.find(element => key(element, current) === saved.focus);
      target?.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && saved.selection && ['text','search'].includes(target.type)) target.setSelectionRange(...saved.selection);
    }
    if (scroll) scroll.scrollTop = saved.scroll;
  };
}
