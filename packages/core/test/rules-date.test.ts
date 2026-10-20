import { describe, expect, it } from 'vitest';
import { checkDate, DATE_FORMATS, type DateFormat } from '../src/index.js';

const iso = (value: string, format?: DateFormat) => {
  const result = checkDate(value, format);
  return result.ok ? result.iso : null;
};

describe('checkDate: DD.MM.YYYY (AC-18)', () => {
  it('accepts a padded real date and returns ISO', () => {
    expect(iso('01.03.2024', 'DD.MM.YYYY')).toBe('2024-03-01');
    expect(iso('31.12.1999', 'DD.MM.YYYY')).toBe('1999-12-31');
  });

  it.each([
    '1.3.2024',
    '31.04.2024',
    '29.02.2023',
    '2024-13-01',
    '01/03/2024',
    '01.03.24',
    '',
    '32.01.2024',
  ])('rejects %j', (value) => {
    const result = checkDate(value, 'DD.MM.YYYY');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issue.code).toBe('INVALID_DATE');
  });
});

describe('checkDate: slash formats (AC-18)', () => {
  it('reads MM/DD/YYYY as month first', () => {
    expect(iso('03/01/2024', 'MM/DD/YYYY')).toBe('2024-03-01');
  });

  it('reads DD/MM/YYYY as day first', () => {
    expect(iso('03/01/2024', 'DD/MM/YYYY')).toBe('2024-01-03');
  });

  it('never falls back to the other reading when the declared one is impossible', () => {
    expect(iso('13/01/2024', 'MM/DD/YYYY')).toBeNull();
    expect(iso('01/13/2024', 'DD/MM/YYYY')).toBeNull();
  });

  it('rejects the wrong separator and unpadded parts', () => {
    expect(iso('03.01.2024', 'MM/DD/YYYY')).toBeNull();
    expect(iso('3/1/2024', 'MM/DD/YYYY')).toBeNull();
  });
});

describe('checkDate: calendar validity (FR-D3)', () => {
  it('handles leap years', () => {
    expect(iso('2024-02-29')).toBe('2024-02-29');
    expect(iso('2023-02-29')).toBeNull();
    expect(iso('1900-02-29')).toBeNull();
    expect(iso('2000-02-29')).toBe('2000-02-29');
  });

  it('rejects day 31 in 30-day months and month 00/13', () => {
    expect(iso('2024-04-31')).toBeNull();
    expect(iso('2024-00-10')).toBeNull();
    expect(iso('2024-13-10')).toBeNull();
    expect(iso('2024-01-00')).toBeNull();
  });

  it('rejects year 0000 placeholders', () => {
    expect(iso('0000-01-01')).toBeNull();
    expect(iso('01.01.0000', 'DD.MM.YYYY')).toBeNull();
  });

  it('rejects time components, extra whitespace and non-ASCII digits', () => {
    expect(iso('2024-03-01T10:00:00')).toBeNull();
    expect(iso('2024-03-01 10:00')).toBeNull();
    expect(iso(' 2024-03-01')).toBeNull();
    expect(iso('２０２４-03-01')).toBeNull();
  });
});

describe('checkDate: canonical ISO is always accepted (AC-19)', () => {
  it.each(DATE_FORMATS)('accepts YYYY-MM-DD in a %s column', (format) => {
    expect(iso('2024-03-01', format)).toBe('2024-03-01');
  });

  it('normalizes the declared and the canonical form to the same ISO value', () => {
    expect(iso('01.03.2024', 'DD.MM.YYYY')).toBe(iso('2024-03-01', 'DD.MM.YYYY'));
  });

  it('defaults to the canonical format', () => {
    expect(iso('2024-03-01')).toBe('2024-03-01');
    expect(iso('01.03.2024')).toBeNull();
  });
});

describe('checkDate: messages', () => {
  it('names both accepted formats for a non-canonical column', () => {
    const result = checkDate('31.04.2024', 'DD.MM.YYYY');
    expect(!result.ok && result.issue.message).toBe(
      'Expected DD.MM.YYYY or YYYY-MM-DD, got "31.04.2024"',
    );
  });

  it('names only the canonical format for a canonical column', () => {
    const result = checkDate('nope');
    expect(!result.ok && result.issue.message).toBe('Expected YYYY-MM-DD, got "nope"');
  });
});
