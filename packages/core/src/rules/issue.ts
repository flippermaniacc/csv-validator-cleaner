import type { RowErrorCode } from '../errors.js';

/** A single rule failure for one cell; `null` from a rule means the cell passed. */
export interface RuleIssue {
  code: RowErrorCode;
  message: string;
}

/** Maximum characters of an offending value kept in reports and messages (FR-ER2). */
export const MAX_VALUE_LENGTH = 200;

export function truncateValue(value: string): string {
  if (value.length <= MAX_VALUE_LENGTH) return value;
  return Array.from(value).slice(0, MAX_VALUE_LENGTH).join('');
}

/** Quotes a truncated value for messages so control characters stay visible and deterministic (FR-ER3). */
export function quoteValue(value: string): string {
  return JSON.stringify(truncateValue(value));
}
