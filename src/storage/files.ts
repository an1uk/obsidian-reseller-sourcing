import type { TFile, Vault } from 'obsidian';
import { isRecord, isUnknownArray } from '../domain/guards';
const fileShape = (entry: unknown): entry is TFile => isRecord(entry) && typeof entry.path === 'string' && typeof entry.extension === 'string' && typeof entry.basename === 'string';

/** Traverse only an explicitly selected notebook subtree for routine browsing. */
export function notebookFiles(vault: Vault, root: string): TFile[] {
  const files: TFile[] = [];
  const visit = (entry: unknown): void => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || entry.path !== root && !entry.path.startsWith(root + '/')) return;
    if (fileShape(entry)) {
      files.push(entry);
    } else if (isUnknownArray(entry.children)) for (const child of entry.children) visit(child);
  };
  visit(vault.getAbstractFileByPath(root));
  return files;
}
