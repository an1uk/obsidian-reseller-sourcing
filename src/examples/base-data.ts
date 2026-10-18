import { parse } from 'yaml';
import { isRecord, isUnknownArray } from '../domain/guards';

interface ExampleBase {
  filters: { and: string[] };
  formulas: Record<string, string>;
  views: Record<string, unknown>[];
}

function isExampleBase(value: unknown): value is ExampleBase {
  return isRecord(value) && isRecord(value.filters)
    && isUnknownArray(value.filters.and) && value.filters.and.every(row => typeof row === 'string')
    && isRecord(value.formulas) && Object.values(value.formulas).every(formula => typeof formula === 'string')
    && isUnknownArray(value.views) && value.views.every(isRecord);
}

/** Validate before editing generated Bases; retain object order for frozen packs. */
export function parseExampleBase(text: string): ExampleBase {
  const value: unknown = parse(text);
  if (!isExampleBase(value)) throw Error('The example Base definition is invalid.');
  return value;
}
