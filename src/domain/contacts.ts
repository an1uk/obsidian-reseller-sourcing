/** Produce a browser link only for ordinary HTTP(S) websites. */
export function websiteUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || /[\s\\\u0000-\u001f\u007f]/.test(raw)) return '';
  const explicit = /^https?:\/\//i.test(raw);
  if (!explicit && (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//'))) return '';
  try {
    const url = new URL(explicit ? raw : 'https://' + raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return '';
    const host = url.hostname.replace(/\.$/, '');
    if (!host.startsWith('[')) {
      if (host.split('.').some(label => !label || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))) return '';
      if (!explicit && !host.includes('.')) return '';
    } else if (!explicit) return '';
    return url.href;
  } catch { return ''; }
}

/** Keep the human number in the note; normalize punctuation only for the dial link. */
export function telephoneUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  let number = value.trim();
  if (!number || /[\u0000-\u001f\u007f]/.test(number)) return '';
  let extension = '';
  const match = number.match(/(?:\s*(?:ext\.?|extension|x)\s*|;ext=)(\d{1,10})$/i);
  if (match) { extension = ';ext=' + match[1]; number = number.slice(0, match.index).trim(); }
  if (!/^\+?[\d\s().-]+$/.test(number)) return '';
  const dial = number.replace(/[\s().-]/g, '');
  return /^\+?\d{1,30}$/.test(dial) ? 'tel:' + dial + extension : '';
}
