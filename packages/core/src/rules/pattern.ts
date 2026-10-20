import { compileFullMatch, type RegexEngine } from '../regex.js';
import { quoteValue, type RuleIssue } from './issue.js';

export type CellRule = (trimmed: string) => RuleIssue | null;

/** Compiles once with full-match semantics via the injected engine (FR-P1, FR-P3). */
export function createPatternRule(engine: RegexEngine, pattern: string): CellRule {
  const compiled = compileFullMatch(engine, pattern);
  return (trimmed) =>
    compiled.test(trimmed)
      ? null
      : {
          code: 'PATTERN_MISMATCH',
          message: `Expected a value matching pattern ${JSON.stringify(pattern)}, got ${quoteValue(trimmed)}`,
        };
}
