import type { ColumnDefinition } from '../schema/definition.js';
import type { RuleIssue } from './issue.js';

/** `iso` is the normalized date for date columns, supplied by the caller from `checkDate`. */
export type RangeRule = (trimmed: string, iso?: string) => RuleIssue | null;

type Bounds = Pick<ColumnDefinition, 'type' | 'min' | 'max'>;

/** Inclusive bounds: numeric value, character count (code points), or ISO date (FR-M1 to FR-M3). Null when no bounds apply. */
export function createRangeRule({ type, min, max }: Bounds): RangeRule | null {
  if (min === undefined && max === undefined) return null;

  switch (type) {
    case 'integer':
    case 'decimal':
      return bounded(
        (trimmed) => Number(trimmed),
        min as number | undefined,
        max as number | undefined,
        (n) => String(n),
        (bound, side) =>
          `Expected a value ${side === 'min' ? 'of at least' : 'of at most'} ${bound}`,
      );
    case 'string':
    case 'email':
      return bounded(
        (trimmed) => codePointLength(trimmed),
        min as number | undefined,
        max as number | undefined,
        (n) => `${n} characters`,
        (bound, side) =>
          `Expected a length ${side === 'min' ? 'of at least' : 'of at most'} ${bound} characters`,
      );
    case 'date':
      return bounded(
        (_trimmed, iso) => {
          if (iso === undefined) throw new Error('date range rule needs the normalized ISO date');
          return iso;
        },
        min as string | undefined,
        max as string | undefined,
        (iso) => iso,
        (bound, side) => `Expected a date on or ${side === 'min' ? 'after' : 'before'} ${bound}`,
      );
    default:
      return null;
  }
}

function bounded<T extends number | string>(
  measure: (trimmed: string, iso?: string) => T,
  min: T | undefined,
  max: T | undefined,
  show: (measured: T) => string,
  expectation: (bound: T, side: 'min' | 'max') => string,
): RangeRule {
  return (trimmed, iso) => {
    const measured = measure(trimmed, iso);
    if (min !== undefined && measured < min) {
      return { code: 'BELOW_MIN', message: `${expectation(min, 'min')}, got ${show(measured)}` };
    }
    if (max !== undefined && measured > max) {
      return { code: 'ABOVE_MAX', message: `${expectation(max, 'max')}, got ${show(measured)}` };
    }
    return null;
  };
}

function codePointLength(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) i++;
    count++;
  }
  return count;
}
