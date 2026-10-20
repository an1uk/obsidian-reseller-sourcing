import type { NotebookContext } from '../notebook-context';
import { OutingPreparationModal } from '../workspace/outing-preparation';
import { ShortTripModal } from './short-trip';
import { buildRepeatedOutingPreparation, suggestedRepeatName } from '../outings/repeat';
import { localDate } from '../storage/markdown';

export function openShortTripPreparation(context: NotebookContext, draftId?: string): void {
  new ShortTripModal(context, id => { new OutingPreparationModal(context, undefined, id).open(); }, draftId).open();
}

/** Read current records before preparing a fresh outing; history is never changed here. */
export async function repeatOuting(context: NotebookContext, path: string, isCurrent: () => boolean = () => true): Promise<void> {
  const [record, places, outings] = await Promise.all([context.store.outings.get(path), context.store.listPlaces(), context.store.outings.list()]);
  if (!isCurrent()) return;
  const { preparation } = buildRepeatedOutingPreparation(record, places, context.root);
  preparation.name = suggestedRepeatName(record.name, preparation.planning?.date ?? localDate(), outings.flatMap(outing => [outing.name, outing.path.split('/').pop()?.replace(/\.md$/, '') ?? '']));
  new OutingPreparationModal(context, undefined, undefined, undefined, preparation).open();
}
