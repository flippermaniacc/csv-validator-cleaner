import type { ColumnType } from '../schema/definition.js';
import { quoteValue, type RuleIssue } from './issue.js';
import type { CellRule } from './pattern.js';

const MESSAGE_LIST_LIMIT = 10;

/** Case-sensitive for strings, numeric for integer/decimal (FR-E1); numeric cells must already pass their type check. */
export function createEnumRule(type: ColumnType, entries: readonly (string | number)[]): CellRule {
  const allowed = new Set<string | number>(entries);
  const numeric = type === 'integer' || type === 'decimal';
  const listed = entries
    .slice(0, MESSAGE_LIST_LIMIT)
    .map((e) => JSON.stringify(e))
    .join(', ');
  const more =
    entries.length > MESSAGE_LIST_LIMIT
      ? `, ... (${entries.length - MESSAGE_LIST_LIMIT} more)`
      : '';

  return (trimmed): RuleIssue | null =>
    allowed.has(numeric ? Number(trimmed) : trimmed)
      ? null
      : {
          code: 'NOT_IN_ENUM',
          message: `Expected one of [${listed}${more}], got ${quoteValue(trimmed)}`,
        };
}
