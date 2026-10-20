import { resolveParking, safeFileName, validateCoordinates, validateRootPath } from '../domain';
import { hasControlCharacters } from '../domain/guards';
import type { PlaceRecord } from '../types';
import type { OutingPreparation } from '../workspace/types';
import { defaultPlanningOptions, resolvePlanningAnchor, validatePlanningOptions } from './planning';
import type { OutingGroup, OutingPlanningOptions, OutingRecord } from './types';

export interface RepeatOutingOptions { now?: Date; newId?: () => string; }
export interface RepeatedOutingPreparation { preparation: OutingPreparation; warnings: string[]; }

/** Suggest an editable filename-safe name that stays distinct when the same outing is repeated again. */
export function suggestedRepeatName(recordName: string, date: string, existingNames: readonly string[]): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00Z')) || new Date(date + 'T00:00Z').toISOString().slice(0, 10) !== date) {
    throw new Error('Choose a valid date for the repeated outing name.');
  }
  const stem = safeFileName(recordName.trim().replace(/\s+\(\d+\)$/, '').replace(/(?:^|\s+)\d{4}-\d{2}-\d{2}$/, '').trim(), 'Sourcing');
  const existing = new Set(existingNames.map(name => safeFileName(name).toLowerCase()));
  for (let copy = 1; ; copy++) {
    const suffix = ' ' + date + (copy > 1 ? ' (' + copy + ')' : '');
    const name = safeFileName(stem.slice(0, 180 - suffix.length).trimEnd() + suffix);
    if (!existing.has(name.toLowerCase())) return name;
  }
}
/** Build a new preparation from history, using only the current notebook's saved places. */
export function buildRepeatedOutingPreparation(record: OutingRecord, places: readonly PlaceRecord[], root: string, options: RepeatOutingOptions = {}): RepeatedOutingPreparation {
  const notebookRoot = validateRootPath(root);
  const inside = (path: string): boolean => path.startsWith(notebookRoot + '/') && !path.startsWith(notebookRoot + '/Examples/') &&
    !path.includes('\\') && !hasControlCharacters(path, false) && !path.split('/').some(part => !part || part === '.' || part === '..');
  if (!inside(record.path)) throw new Error('Repeat an outing from this notebook.');
  if (record.status !== 'finished') throw new Error('Finish this outing before repeating it.');
  if (record.operation || record.draft) throw new Error('Finish or discard the saved visit before repeating this outing.');
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Choose a valid date for the repeated outing.');
  const date = defaultPlanningOptions(now).date;
  const warnings = ['New outing date: ' + date + '. Review current opening hours before travelling.'];
  const unresolved = new Set<string>(), seenSources = new Set<string>(), stopIds = new Map<string, string>();
  const currentPlaces = places.filter(place => inside(place.path));
  const current = (path: string): PlaceRecord | undefined => {
    const matches = currentPlaces.filter(place => place.path === path);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const usedIds = new Set([record.id, record.preparationId ?? '', ...record.groups.flatMap(group => [group.id, ...group.stops.flatMap(stop => [stop.id, stop.visitId ?? '', stop.visitOperationId ?? ''])])]);
  const nextId = (): string => {
    const id = options.newId ? options.newId() : crypto.randomUUID();
    if (!id || usedIds.has(id)) throw new Error('A repeated outing needs fresh group and stop identifiers.');
    usedIds.add(id); return id;
  };
  const groups: OutingGroup[] = [];
  for (const original of record.groups) {
    const stops: OutingGroup['stops'] = [];
    for (const stop of original.stops) {
      if (!inside(stop.sourcePath)) {
        warnings.push('A source outside this notebook was omitted. Choose a source from this notebook if needed.'); continue;
      }
      if (seenSources.has(stop.sourcePath)) {
        warnings.push('A duplicate source was omitted: ' + stop.sourcePath + '.'); continue;
      }
      seenSources.add(stop.sourcePath);
      const id = nextId(), source = current(stop.sourcePath);
      stopIds.set(stop.id, id);
      stops.push({ id, sourcePath: stop.sourcePath, status: 'pending' });
      if (!source || source.kind !== 'shop' || source.properties.shop_closed === true) {
        unresolved.add(stop.sourcePath);
        warnings.push('Source unavailable or permanently closed: ' + (source?.name ?? stop.sourcePath) + '. Remove it before saving.');
      }
    }
    if (!stops.length) continue;
    let parkingPath = original.parkingPath;
    if (parkingPath) {
      const parking = current(parkingPath);
      const linked = parking?.kind === 'parking' && validateCoordinates(parking.coordinates) && stops.every(stop => {
        const source = current(stop.sourcePath);
        return source?.kind === 'shop' && resolveParking(source, currentPlaces).choices.some(choice => choice.path === parkingPath);
      });
      if (!linked) {
        parkingPath = '';
        stops.forEach(stop => unresolved.add(stop.sourcePath));
        warnings.push('The previous parking is missing, has no usable location, or is no longer linked to every source in its group. Choose parking or explicitly choose on foot.');
      }
    }
    groups.push({ id: nextId(), parkingPath, stops });
  }
  let planning: OutingPlanningOptions | undefined;
  if (record.planning) {
    try {
      const original = validatePlanningOptions(record.planning);
      const anchors = [original.start, original.end];
      if (!resolvePlanningAnchor(original.start, currentPlaces) || anchors.some(anchor => anchor &&
        anchor.kind !== 'last' && anchor.kind !== 'return' && (!resolvePlanningAnchor(anchor, currentPlaces) ||
          anchor.kind === 'record' && (!inside(anchor.path) || !current(anchor.path))))) {
        warnings.push('The previous journey endpoints are unavailable. Review journey planning again; its old settings were not carried forward.');
      } else {
        const stopOverrides: OutingPlanningOptions['stopOverrides'] = {};
        for (const [oldId, newId] of stopIds) {
          const visitMinutes = original.stopOverrides[oldId]?.visitMinutes;
          if (visitMinutes !== undefined) stopOverrides[newId] = { visitMinutes };
        }
        planning = { ...original, date, stopOverrides };
      }
      if (Object.values(original.stopOverrides).some(override => override.hours)) {
        warnings.push('Opening-hours overrides from the previous date were cleared. Review current saved hours and any changes for the new date.');
      }
    } catch {
      warnings.push('The previous journey settings need review and were not carried forward.');
    }
  }
  const preparation: OutingPreparation = {
    name: '', groups, step: 2, unresolved: [...unresolved], reviewWarnings: [...warnings],
    filter: { text: '', area: '', shortlist: false, type: '', view: 'list' },
    ...(planning ? { planning } : {}),
  };
  return { preparation, warnings };
}
