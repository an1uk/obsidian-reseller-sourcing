import { isMap, parse, parseDocument, stringify } from 'yaml';
import type { VisitInput } from '../types';
import { isRecord, propertyText } from '../domain/guards';

export function readNote(text: string): { properties: Record<string, unknown>; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { properties: {}, body: text };
  const properties: unknown = parse(match[1]);
  if (!isRecord(properties)) throw new Error('Invalid note properties.');
  return { properties, body: text.slice(match[0].length) };
}
export function writeNote(properties: Record<string, unknown>, body: string): string {
  return '---\n' + stringify(properties, { lineWidth: 0 }) + '---\n' + body;
}
export function wiki(path: string): string { return '[[' + path.replace(/\.md$/, '') + ']]'; }
export function linkPath(value: unknown): string {
  const raw = propertyText(value).trim();
  const target = raw.startsWith('[[') && raw.endsWith(']]') ? raw.slice(2, -2).split('|')[0].split('#')[0] : raw;
  return target && !target.endsWith('.md') ? target + '.md' : target;
}
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export function appendVisit(text: string, input: VisitInput, now = new Date()): string {
  if (![input.observations, input.finds, input.nextTime].some(v => v.trim())) throw new Error('Add some visit details before saving.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.visitDate) || !Number.isFinite(Date.parse(input.visitDate)) || new Date(input.visitDate).toISOString().slice(0, 10) !== input.visitDate) throw new Error('Choose a valid visit date.');
  if (input.rating !== undefined && (typeof input.rating !== 'number' || !Number.isFinite(input.rating) || input.rating < 0 || input.rating > 5 || input.rating * 2 !== Math.round(input.rating * 2))) throw new Error('Use a sourcing rating from 0 to 5 in half-star steps.');
  if (input.comments !== undefined && typeof input.comments !== 'string') throw new Error('Use text for the sourcing takeaway.');
  const note = readNote(text);
  const recorded = localDate(now) + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const entry = `### ${recorded}\n\nVisit date: ${input.visitDate}\n\n` +
    [['Observations', input.observations], ['Useful finds', input.finds], ['Next time', input.nextTime]]
      .filter(([, v]) => v.trim()).map(([label, value]) => `**${label}**\n\n${value.trim()}\n\n`).join('');
  const heading = /^## Visit log[ \t]*\r?\n/m;
  const body = heading.test(note.body) ? note.body.replace(heading, match => match + '\n' + entry) : note.body.trimEnd() + '\n\n## Visit log\n\n' + entry;
  let result = text.slice(0, text.length - note.body.length) + body;
  if (input.updateLastVisited) result = updateNoteProperty(result, 'last_visited', input.visitDate);
  if (input.rating !== undefined) result = updateNoteProperty(result, 'rating', input.rating);
  if (input.comments !== undefined) result = updateNoteProperty(result, 'comments', input.comments);
  return result;
}
export async function hashText(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Update one property while retaining YAML comments/styles and the exact note body. */
export function updateNoteProperty(text: string, key: string, value: unknown): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('The note has no properties section.');
  const document = parseDocument(match[1]);
  if (document.errors.length || !isMap(document.contents)) throw new Error('Invalid note properties.');
  document.set(key, value);
  const newline = text.startsWith('---\r\n') ? '\r\n' : '\n';
  const yaml = document.toString({ lineWidth: 0 }).replace(/\n/g, newline);
  return '---' + newline + yaml + '---' + (match[0].endsWith('\n') ? newline : '') + text.slice(match[0].length);
}
