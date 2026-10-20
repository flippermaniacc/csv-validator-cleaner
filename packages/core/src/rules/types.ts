import type { ColumnType } from '../schema/definition.js';
import { quoteValue, type RuleIssue } from './issue.js';

const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
const BOOLEAN = /^(true|false)$/i;
const MAX_EMAIL_LENGTH = 254;

/** Checks a non-empty trimmed value against a scalar type (FR-T1 to FR-T5); `date` is handled separately. */
export function checkType(type: Exclude<ColumnType, 'date'>, trimmed: string): RuleIssue | null {
  switch (type) {
    case 'string':
      return null;
    case 'integer':
      return INTEGER.test(trimmed) && Number.isSafeInteger(Number(trimmed))
        ? null
        : invalid('an integer within the safe integer range', trimmed);
    case 'decimal':
      return DECIMAL.test(trimmed) && Number.isFinite(Number(trimmed))
        ? null
        : invalid('a decimal number using "." as separator', trimmed);
    case 'boolean':
      return BOOLEAN.test(trimmed) ? null : invalid('true or false', trimmed);
    case 'email':
      return isEmail(trimmed) ? null : invalid('an email address', trimmed);
  }
}

/** Pragmatic shape check only, no DNS or deliverability (FR-T5). */
function isEmail(value: string): boolean {
  if (value.length > MAX_EMAIL_LENGTH) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (/\s/.test(local) || /\s/.test(domain)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

function invalid(expected: string, value: string): RuleIssue {
  return { code: 'INVALID_TYPE', message: `Expected ${expected}, got ${quoteValue(value)}` };
}
