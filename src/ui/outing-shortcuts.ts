import { Notice } from 'obsidian';
import type { NotebookContext } from '../notebook-context';
import { OutingPreparationModal } from '../workspace/outing-preparation';
import { ShortTripModal } from './short-trip';
import { buildRepeatedOutingPreparation, suggestedRepeatName } from '../outings/repeat';
import { localDate } from '../storage/markdown';

export function openShortTripPreparation(context: NotebookContext, draftId?: string): void {
  new ShortTripModal(context, id => { new OutingPreparationModal(context, undefined, id).open(); }, draftId, undefined, { defaults: context.settings.shortTripDefaults, remember: value => context.store.rememberShortTripDefaults(value) }).open();
}

/** A damaged historical record must not hide an unrelated active outing. */
export async function resumeCurrentOuting(context: NotebookContext): Promise<void> {
  const { records, problems } = await context.store.outings.inspect();
  if (problems.length) new Notice(problems.map(problem => problem.path + ': ' + problem.message).join('\n'));
  await context.openFile(records.find(outing => outing.status === 'active')?.path ?? context.root + '/Outings.md');
}

/** Read current records before preparing a fresh outing; history is never changed here. */
export async function repeatOuting(context: NotebookContext, path: string, isCurrent: () => boolean = () => true): Promise<void> {
  const [record, places, inspection] = await Promise.all([context.store.outings.get(path), context.store.listPlaces(), context.store.outings.inspect()]);
  if (!isCurrent()) return;
  const { preparation } = buildRepeatedOutingPreparation(record, places, context.root);
  preparation.name = suggestedRepeatName(record.name, preparation.planning?.date ?? localDate(), [
    ...inspection.records.flatMap(outing => [outing.name, outing.path.split('/').pop()?.replace(/\.md$/, '') ?? '']),
    ...inspection.problems.map(problem => problem.path.split('/').pop()?.replace(/\.md$/, '') ?? ''),
  ]);
  preparation.reviewWarnings = [...(preparation.reviewWarnings ?? []), ...inspection.problems.map(problem => problem.path + ': ' + problem.message)];
  new OutingPreparationModal(context, undefined, undefined, undefined, preparation).open();
}
