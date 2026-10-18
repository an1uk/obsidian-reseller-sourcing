import { localDate } from '../storage/markdown';

export type VisitPeriod = 'all' | 'this-week' | 'previous-week' | 'custom';
export interface VisitDateRange { from?: string; to?: string; }

/** Actual visit dates are calendar dates. UTC arithmetic avoids DST-short or DST-long days. */
export function validVisitDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function visitPeriodRange(period: VisitPeriod, today = localDate(), custom: VisitDateRange = {}): VisitDateRange {
  if (period === 'all') return {};
  if (period === 'custom') {
    if (custom.from && !validVisitDate(custom.from) || custom.to && !validVisitDate(custom.to)) throw Error('Choose valid visit dates.');
    if (custom.from && custom.to && custom.from > custom.to) throw Error('The end date must be on or after the start date.');
    return { ...(custom.from ? { from: custom.from } : {}), ...(custom.to ? { to: custom.to } : {}) };
  }
  if (!validVisitDate(today)) throw Error('Choose a valid reference date.');
  const date = new Date(today + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7 - (period === 'previous-week' ? 7 : 0));
  const from = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { from, to: date.toISOString().slice(0, 10) };
}
export function isVisitDateInRange(date: string, range: VisitDateRange): boolean {
  return validVisitDate(date) && (!range.from || date >= range.from) && (!range.to || date <= range.to);
}
