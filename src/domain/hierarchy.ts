import type { LocalityRecord } from '../types';
import { safeFileName } from './index';

export interface LocalityInput { path: string; name: string; parentPath: string; }
export function validLocalityName(value: string): string {
  const name = value.trim();
  if (!name || safeFileName(name) !== name || name.length > 80) throw new Error('Use an area name without filename punctuation (up to 80 characters).');
  return name;
}
/** Parent links, rather than physical folder names, define the hierarchy. Invalid trees are excluded. */
export function resolveLocalities(input: LocalityInput[]): LocalityRecord[] {
  const byPath = new Map(input.map(entry => [entry.path, entry]));
  const resolved = new Map<string, LocalityRecord | null>();
  const visiting = new Set<string>();
  const visit = (entry: LocalityInput): LocalityRecord | null => {
    if (resolved.has(entry.path)) return resolved.get(entry.path)!;
    if (visiting.has(entry.path)) return null;
    visiting.add(entry.path);
    const parent = entry.parentPath ? byPath.get(entry.parentPath) : undefined;
    const record = entry.parentPath && (!parent || !visit(parent)) ? null : (() => {
      const segments = [...(parent ? visit(parent)!.segments : []), entry.name];
      return { ...entry, segments, label: segments.join(' → ') };
    })();
    visiting.delete(entry.path); resolved.set(entry.path, record); return record;
  };
  for (const entry of input) visit(entry);
  const records = [...resolved.values()].filter((value): value is LocalityRecord => !!value);
  const siblingKeys = records.map(record => (record.parentPath + '/' + record.name).toLocaleLowerCase());
  return records.filter((_, i) => siblingKeys.indexOf(siblingKeys[i]!) === siblingKeys.lastIndexOf(siblingKeys[i]!))
    .sort((a, b) => a.label.localeCompare(b.label));
}
export function localitySubtree(path: string, localities: LocalityRecord[]): LocalityRecord[] {
  const paths = new Set([path]);
  let previous = 0;
  while (previous !== paths.size) {
    previous = paths.size;
    for (const locality of localities) if (paths.has(locality.parentPath)) paths.add(locality.path);
  }
  return localities.filter(locality => paths.has(locality.path));
}
