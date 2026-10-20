import type { RuleIssue } from './issue.js';

/** Empty after trimming is an error only for required columns (FR-R1). */
export function checkRequired(trimmed: string, required: boolean): RuleIssue | null {
  if (required && trimmed === '') return { code: 'REQUIRED', message: 'Value is required' };
  return null;
}
