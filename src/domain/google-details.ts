import { readNote } from '../storage/markdown';

export function validSnapshotDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

/** A complete weekly capture is required; partial extraction cannot replace hours. */
export function validGoogleHours(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 7 || !value.every(row => typeof row === 'string')) return [];
  const rows = value.map(row => row.trim());
  const days = rows.map(row => /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), .+$/.exec(row)?.[1]);
  return days.every(Boolean) && new Set(days).size === 7 ? rows : [];
}

export interface GoogleHoursSnapshot { hours: string[]; checked: string; legacy: boolean; }

/** Prefer current structured hours, retaining the original dated callout as a legacy fallback. */
export function readGoogleHours(text: string): GoogleHoursSnapshot {
  let body = text, properties: Record<string, unknown> = {};
  try { const note = readNote(text); body = note.body; properties = note.properties; } catch { /* Do not hide readable legacy content. */ }
  if (Object.hasOwn(properties, 'google_hours')) {
    const current = Array.isArray(properties.google_hours) && properties.google_hours.every(row => typeof row === 'string')
      ? properties.google_hours.map(row => row.trim()).filter(Boolean) : [];
    return { hours: current, checked: validSnapshotDate(properties.google_hours_checked), legacy: false };
  }
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => /^> \[!info\]-? Opening hours and Google details[ \t]*$/.test(line));
  if (start < 0) return { hours: [], checked: '', legacy: false };
  const callout: string[] = [];
  for (let i = start + 1; i < lines.length && /^>/.test(lines[i]!); i++) callout.push(lines[i]!);
  const heading = callout.findIndex(line => /^> \*\*Opening hours\*\*[ \t]*$/.test(line));
  const rows: string[] = [];
  if (heading >= 0) for (const line of callout.slice(heading + 1)) {
    if (/^> \*\*/.test(line)) break;
    const row = /^> - (.+)$/.exec(line); if (row) rows.push(row[1]!.trim());
  }
  const hours = validGoogleHours(rows);
  if (!hours.length) return { hours: [], checked: '', legacy: false };
  const dated = callout.map(line => /\bchecked (\d{4}-\d{2}-\d{2})[ \t]*$/.exec(line)?.[1]).find(Boolean);
  // A later review refresh must not make an old hours block appear newly checked.
  const checked = validSnapshotDate(dated) || (!(Array.isArray(properties.source_refresh_receipts) && properties.source_refresh_receipts.length)
    ? validSnapshotDate(properties.google_checked) : '');
  return { hours, checked, legacy: true };
}

/** Topics in older notes share the original capture date, never a later review refresh date. */
export function readGoogleTopics(text: string): { topics: string[]; checked: string; legacy: boolean } {
  let body = text, properties: Record<string, unknown> = {};
  try { const note = readNote(text); body = note.body; properties = note.properties; } catch { return { topics: [], checked: '', legacy: false }; }
  const topics = Array.isArray(properties.google_review_topics) ? properties.google_review_topics.filter((value): value is string => typeof value === 'string' && !!value.trim()) : [];
  if (Object.hasOwn(properties, 'google_review_topics_checked')) return { topics, checked: validSnapshotDate(properties.google_review_topics_checked), legacy: false };
  const original = /(?:^|\n)> Google:[^\n]*\bchecked (\d{4}-\d{2}-\d{2})[ \t]*(?:\r?\n|$)/.exec(body)?.[1];
  const checked = validSnapshotDate(original) || (!(Array.isArray(properties.source_refresh_receipts) && properties.source_refresh_receipts.length) ? validSnapshotDate(properties.google_checked) : '');
  return { topics, checked, legacy: true };
}
