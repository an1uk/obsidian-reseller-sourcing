import { markInputModal } from './modal-layout';
import { Component, Modal, TFile } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import { inspectHome, type ResumeItem } from '../home/overview';
import { button, details, errorText, pickPlace, renderContextBanner, renderExamplesEntry, SetupModal, VisitModal, propertyText } from '../ui';
import { OutingVisitModal } from './outings';
import { renderRecoveryOperation } from './visits';

async function currentItem(context: NotebookContext, item: ResumeItem): Promise<ResumeItem> {
  const overview = await inspectHome(context);
  const current = [overview.primary, ...overview.others].find(value => value?.id === item.id && value.kind === item.kind);
  if (!current || current.revision !== item.revision) throw Error('This saved work changed. Reopen Home to review its current details.');
  return current;
}
class ReviewVisitSaveModal extends Modal {
  private closed = false;
  constructor(private context: NotebookContext, private item: ResumeItem) { super(context.app); }
  onOpen(): void { markInputModal(this);
    this.titleEl.setText('Review interrupted visit save'); this.modalEl.addClass('charity-visit-modal');
    void (async () => {
      const item = await currentItem(this.context, this.item);
      const state = await this.context.store.visits.inspectSavedWork();
      const operation = state.operations.find(value => value.id === item.operationId);
      if (this.closed) return;
      if (!operation) throw Error('This visit save changed. Reopen Home to review it.');
      renderRecoveryOperation(this.context, this.contentEl, operation, () => this.close(), () => !this.closed);
    })().catch(error => { if (!this.closed) this.contentEl.createEl('p', { text: errorText(error), cls: 'charity-error' }); });
  }
  onClose(): void { this.closed = true; this.contentEl.empty(); }
}
export async function resume(context: NotebookContext, item: ResumeItem): Promise<void> {
  const fresh = await currentItem(context, item);
  if (fresh.kind === 'visit-operation') { new ReviewVisitSaveModal(context, fresh).open(); return; }
  if (fresh.kind === 'visit-draft' && fresh.sourcePath) { new VisitModal(context, fresh.sourcePath, fresh.visitPath).open(); return; }
  if (fresh.kind === 'outing-draft' && fresh.outingPath && fresh.stopId) { new OutingVisitModal(context, fresh.outingPath, fresh.stopId).open(); return; }
  await context.openFile(fresh.outingPath ?? fresh.path);
}
function resumeLabel(item: ResumeItem): string {
  return item.kind.endsWith('operation') ? 'Review interrupted save' : item.kind.endsWith('draft') ? 'Resume visit' : 'Continue outing';
}
function savedWork(context: NotebookContext, parent: HTMLElement, item: ResumeItem, primary = false): void {
  const row = parent.createDiv(primary ? 'charity-home-resume' : 'charity-home-saved-row');
  row.createEl(primary ? 'h2' : 'strong', { text: item.label });
  if (item.sourceName) row.createEl('p', { text: item.sourceName, cls: 'charity-hint' });
  row.createEl('p', { text: item.kind.endsWith('operation') ? 'Your saved details are kept. Review before completing the save.' : item.kind.endsWith('draft') ? 'Your unfinished details are saved. Continue when you are ready.' : 'Open your current stop and directions.', cls: 'charity-hint' });
  const action = button(row, resumeLabel(item), () => resume(context, item), primary);
  action.setAttribute('data-charity-focus', 'resume-' + item.id);
}

/** Source selection always means a standalone visit unless the user chooses the outing option. */
export async function chooseVisitSource(context: NotebookContext): Promise<void> {
  const overview = await inspectHome(context), active = overview.outings.find(outing => outing.status === 'active');
  if (!overview.sourcesAvailable) throw Error('Sources could not be read. Open Home to review the saved-record warning.');
  const sources = overview.sources.slice().sort((a, b) => propertyText(b.properties.last_visited).localeCompare(propertyText(a.properties.last_visited)) || a.name.localeCompare(b.name));
  class ChooseVisitModal extends Modal {
    onOpen(): void { markInputModal(this);
      this.titleEl.setText('Record a visit'); this.modalEl.addClass('charity-visit-modal'); renderContextBanner(context, this.contentEl);
      if (active) {
        const outing = this.contentEl.createDiv('charity-home-saved-row');
        outing.createEl('strong', { text: 'For your current outing' });
        outing.createEl('p', { text: active.name, cls: 'charity-hint' });
        button(outing, 'Open current outing', async () => { this.close(); await context.openFile(active.path); }, true);
      }
      this.contentEl.createEl('p', { text: 'Choose a source for a standalone visit. This does not change outing progress.', cls: 'charity-hint' });
      if (sources.length) button(this.contentEl, 'Choose source', () => { this.close(); pickPlace(context, sources, source => new VisitModal(context, source.path).open(), 'Search sources for a standalone visit'); }, !active);
      else button(this.contentEl, 'Add your first source', () => { this.close(); context.newPlace('shop'); }, true);
    }
  }
  if (!active && sources.length) { pickPlace(context, sources, source => new VisitModal(context, source.path).open(), 'Search sources to record a visit'); return; }
  new ChooseVisitModal(context.app).open();
}

export async function renderHome(context: NotebookContext, _owner: Component, el: HTMLElement, isCurrent: () => boolean): Promise<void> {
  const overview = await inspectHome(context); if (!isCurrent()) return;
  el.addClass('charity-home');
  if (context.kind === 'examples') el.createEl('p', { text: 'Examples: fictional practice data. Changes stay here; external links show previews.', cls: 'charity-examples-banner charity-hint' });
  el.createEl('h1', { text: context.kind === 'examples' ? 'Examples Home' : 'Reseller sourcing' });
  if (overview.primary) {
    savedWork(context, el, overview.primary, true);
    if (overview.others.length) {
      const other = details(el, 'Other unfinished work (' + overview.others.length + ')'); other.setAttribute('data-charity-section', 'other-work');
      for (const item of overview.others) savedWork(context, other, item);
    }
  } else if (overview.sourcesAvailable && !overview.sources.length) {
    const first = el.createDiv('charity-home-resume'); first.createEl('h2', { text: 'Start with one source' });
    first.createEl('p', { text: 'Add a place you know. You can fill in more details later.' });
    button(first, 'Add your first source', () => context.newPlace('shop'), true);
  } else el.createEl('h2', { text: 'What would you like to do?' });

  const tasks = el.createDiv('charity-home-tasks');
  const task = (label: string, description: string, run: () => unknown) => {
    const row = tasks.createDiv('charity-home-task');
    const action = button(row, label, run); action.setAttribute('data-charity-focus', 'task-' + label);
    row.createEl('p', { text: description, cls: 'charity-hint' });
  };
  task('Record a visit', 'Save a quick note and what you bought.', () => chooseVisitSource(context));
  task('Plan an outing', 'Choose sources and put a journey together.', () => context.newOuting());
  task('Find sources', 'Look up a place, browse the map or use your shortlist.', () => context.openFile(context.root + '/Sources.md'));
  const secondary = el.createDiv('charity-actions charity-home-secondary');
  button(secondary, 'Add source', () => context.newPlace('shop'));
  button(secondary, overview.captures ? 'Review captures (' + overview.captures + ')' : 'Review captures', () => context.reviewCaptures(true));

  const browse = details(el, 'Browse notebook'); browse.setAttribute('data-charity-section', 'browse');
  const links = browse.createDiv('charity-actions');
  for (const [label, suffix] of [['Sources', '/Sources.md'], ['Shortlist', '/System/Sources.base#Shortlist'], ['Outings', '/Outings.md'], ['Visits', '/Visits.md'], ['Areas', '/Localities.md'], ['Parking', '/Parking.md']] as const) button(links, label, () => context.openFile(context.root + suffix));

  const help = details(el, 'Help and notebook tools'); help.setAttribute('data-charity-section', 'help');
  const tools = help.createDiv('charity-actions');
  button(tools, 'Guide', () => context.openFile(context.root + '/Guide.md'));
  button(tools, 'Add parking', () => context.newPlace('parking'));
  renderExamplesEntry(context, tools);
  if (context.kind === 'real') {
    button(tools, 'Setup and repair', () => new SetupModal(context).open());
    button(tools, 'Web Clipper templates', () => context.openClipperSetup());
  } else {
    button(tools, 'Practice settings', () => context.openFile(context.root + '/Settings.md'));
    if (context.referencePath && context.app.vault.getAbstractFileByPath(context.referencePath) instanceof TFile) button(tools, 'Worked illustrations', () => context.openFile(context.referencePath!));
    button(tools, 'Open real notebook', () => context.host.contextForPath(context.root.slice(0, -'/Examples'.length) + '/Home.md').then(real => real?.home()));
  }
  for (const warning of overview.warnings) {
    const row = el.createDiv('charity-home-warning'); row.createEl('p', { text: warning.message, cls: 'charity-error' });
    if (warning.path) button(row, 'Open saved record for review', () => context.openFile(warning.path!));
  }
}
