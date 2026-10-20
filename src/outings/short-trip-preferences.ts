import { hasControlCharacters } from '../domain/guards';
import { validateShortTripDefaults, type ShortTripDefaults } from './short-trip';

/** A remembered starting record is a capability within one notebook, never a device location. */
export function checkedShortTripDefaults(value: unknown, root: string): ShortTripDefaults {
  const result = validateShortTripDefaults(value);
  const path = result.startPath;
  if (path && (!path.startsWith(root + '/') || path.startsWith(root + '/Examples/') ||
    path.includes('\\') || hasControlCharacters(path, false) || path.split('/').some(part => !part || part === '.' || part === '..')))
    throw Error('The saved short-trip starting point belongs to another notebook.');
  return result;
}
export function isShortTripDefaultsForRoot(value: unknown, root: string): value is ShortTripDefaults {
  try { checkedShortTripDefaults(value, root); return true; } catch { return false; }
}
