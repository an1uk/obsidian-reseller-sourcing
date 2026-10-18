/** Narrow untrusted parsed objects without widening their members to any. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Array.isArray alone widens elements to any; storage boundaries retain unknown. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Check ASCII controls without embedding control ranges in a regular expression. */
export function hasControlCharacters(value: string, includeDelete = true): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || (includeDelete && code === 127);
  });
}
/** Display scalar note properties without exposing object coercions in the UI. */
export function propertyText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' ? String(value) : fallback;
}
