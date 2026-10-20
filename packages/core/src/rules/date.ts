import { isValidCalendarDate } from '../calendar.js';
import type { DateFormat } from '../schema/definition.js';
import { quoteValue, type RuleIssue } from './issue.js';

export type DateCheck = { ok: true; iso: string } | { ok: false; issue: RuleIssue };

const CANONICAL: DateFormat = 'YYYY-MM-DD';

const PARSERS: Record<
  DateFormat,
  { pattern: RegExp; order: readonly ['y' | 'm' | 'd', ...('y' | 'm' | 'd')[]] }
> = {
  'YYYY-MM-DD': { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, order: ['y', 'm', 'd'] },
  'DD.MM.YYYY': { pattern: /^(\d{2})\.(\d{2})\.(\d{4})$/, order: ['d', 'm', 'y'] },
  'DD/MM/YYYY': { pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: ['d', 'm', 'y'] },
  'MM/DD/YYYY': { pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: ['m', 'd', 'y'] },
};

/** Accepts the declared format or canonical ISO and returns ISO, never guessing other formats (FR-D2, FR-D4, FR-D6). */
export function checkDate(trimmed: string, format: DateFormat = CANONICAL): DateCheck {
  const iso =
    parseStrict(trimmed, format) ?? (format === CANONICAL ? null : parseStrict(trimmed, CANONICAL));
  if (iso !== null) return { ok: true, iso };

  const expected = format === CANONICAL ? CANONICAL : `${format} or ${CANONICAL}`;
  return {
    ok: false,
    issue: { code: 'INVALID_DATE', message: `Expected ${expected}, got ${quoteValue(trimmed)}` },
  };
}

/** Fixed-width digits plus a real calendar check, so `31.04.2024` fails and year 0000 is a placeholder, not a date (FR-D3). */
function parseStrict(value: string, format: DateFormat): string | null {
  const { pattern, order } = PARSERS[format];
  const match = pattern.exec(value);
  if (!match) return null;

  const parts = { y: 0, m: 0, d: 0 };
  order.forEach((key, i) => {
    parts[key] = Number(match[i + 1]);
  });
  if (parts.y < 1 || !isValidCalendarDate(parts.y, parts.m, parts.d)) return null;

  return `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}
