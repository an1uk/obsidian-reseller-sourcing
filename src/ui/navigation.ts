import type { NotebookContext } from '../notebook-context';
import { button } from '../ui';

export function renderNotebookNavigation(context: NotebookContext, parent: HTMLElement): void {
  const nav = parent.createEl('nav', { cls: 'charity-notebook-nav', attr: { 'aria-label': context.kind === 'examples' ? 'Examples navigation' : 'Sourcing notebook navigation' } });
  const home = button(nav, context.kind === 'examples' ? 'Examples Home' : 'Home', () => context.home());
  home.setAttribute('data-charity-focus', 'notebook-home');
}
