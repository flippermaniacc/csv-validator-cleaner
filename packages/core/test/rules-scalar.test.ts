import { describe, expect, it } from 'vitest';
import {
  checkRequired,
  checkType,
  MAX_VALUE_LENGTH,
  quoteValue,
  truncateValue,
  type ColumnType,
} from '../src/index.js';

type ScalarType = Exclude<ColumnType, 'date'>;

/** Table-driven: every value in `valid` passes and every value in `invalid` is INVALID_TYPE. */
function expectType(type: ScalarType, valid: string[], invalid: string[]) {
  for (const value of valid) {
    expect(checkType(type, value), `${type} should accept ${JSON.stringify(value)}`).toBeNull();
  }
  for (const value of invalid) {
    expect(checkType(type, value)?.code, `${type} should reject ${JSON.stringify(value)}`).toBe(
      'INVALID_TYPE',
    );
  }
}

describe('checkRequired (AC-10)', () => {
  it('flags an empty value in a required column', () => {
    expect(checkRequired('', true)).toEqual({ code: 'REQUIRED', message: 'Value is required' });
  });

  it('treats whitespace-only input as empty once trimmed', () => {
    expect(checkRequired('   '.trim(), true)?.code).toBe('REQUIRED');
    expect(checkRequired('\t \n'.trim(), true)?.code).toBe('REQUIRED');
  });

  it('accepts empty values in optional columns', () => {
    expect(checkRequired('', false)).toBeNull();
  });

  it('accepts any non-empty value, including a lone zero', () => {
    expect(checkRequired('0', true)).toBeNull();
    expect(checkRequired('x', true)).toBeNull();
  });
});

describe('checkType: string (FR-T1)', () => {
  it('accepts any non-empty text', () => {
    expectType(
      'string',
      ['abc', '123', '=1+1', '  inner space', 'Привет', '"quoted"', '\u0000'],
      [],
    );
  });
});

describe('checkType: integer (AC-11)', () => {
  it('accepts optionally signed digit strings, preserving leading zeros', () => {
    expectType('integer', ['42', '-7', '+3', '007', '0', '-0', '9007199254740991'], []);
  });

  it('rejects decimals, separators, exponents and text', () => {
    expectType('integer', [], ['4.2', '1,000', '1e3', 'abc', '1 000', '--1', '+', '-', '.5', '4.']);
  });

  it('rejects values beyond the safe integer range', () => {
    expectType(
      'integer',
      [],
      ['9007199254740993', '-9007199254740993', '99999999999999999999', '1'.repeat(400)],
    );
  });

  it('rejects non-ASCII digits', () => {
    expectType('integer', [], ['١٢٣', '１２３']);
  });
});

describe('checkType: decimal (AC-12)', () => {
  it('accepts integers and dot-separated decimals, including leading-dot forms', () => {
    expectType('decimal', ['4.2', '-0.5', '.5', '10', '+3.14', '007.50', '-.5'], []);
  });

  it('rejects comma separators, exponents, trailing dots and text', () => {
    expectType(
      'decimal',
      [],
      ['4,2', '1e3', '5.', 'abc', '1.2.3', '1 000.5', '.', '-', '1,000.50'],
    );
  });

  it('rejects numbers that overflow to infinity', () => {
    expectType('decimal', [], ['9'.repeat(400)]);
  });
});

describe('checkType: boolean (AC-13)', () => {
  it('accepts true and false in any case', () => {
    expectType('boolean', ['true', 'false', 'TRUE', 'FALSE', 'True', 'fAlSe'], []);
  });

  it('rejects numeric and yes/no spellings', () => {
    expectType('boolean', [], ['yes', 'no', '1', '0', 't', 'truee', 'true false', 'y']);
  });
});

describe('checkType: email (AC-14)', () => {
  it('accepts a pragmatic address shape', () => {
    expectType(
      'email',
      ['a@b.co', 'first.last+tag@sub.example.com', "o'neil@example.org", 'пользователь@пример.рф'],
      [],
    );
  });

  it('rejects missing or extra @, empty parts, whitespace and bare domains', () => {
    expectType(
      'email',
      [],
      [
        'a@b',
        'a@@b.co',
        'a b@c.co',
        '@b.co',
        'a@',
        'a@b..co',
        'a@.co',
        'a@b.',
        'a@b c.co',
        'a@b@c.co',
      ],
    );
  });

  it('enforces the 254-character limit', () => {
    const ofLength = (n: number) => `${'a'.repeat(n - 5)}@b.co`;
    expect(ofLength(254)).toHaveLength(254);
    expectType('email', [ofLength(253), ofLength(254)], [ofLength(255), ofLength(300)]);
  });
});

describe('type issue messages', () => {
  it('state what was expected and quote the offending value', () => {
    expect(checkType('integer', '4.2')).toEqual({
      code: 'INVALID_TYPE',
      message: 'Expected an integer within the safe integer range, got "4.2"',
    });
    expect(checkType('decimal', '4,2')?.message).toBe(
      'Expected a decimal number using "." as separator, got "4,2"',
    );
    expect(checkType('boolean', 'yes')?.message).toBe('Expected true or false, got "yes"');
    expect(checkType('email', 'a@b')?.message).toBe('Expected an email address, got "a@b"');
  });

  it('keeps control characters visible and escapes quotes', () => {
    expect(checkType('integer', 'a\nb"')?.message).toContain('"a\\nb\\""');
  });

  it('never embeds more than 200 characters of the value (FR-ER3)', () => {
    const message = checkType('integer', 'x'.repeat(5000))?.message ?? '';
    expect(message).toContain('x'.repeat(MAX_VALUE_LENGTH));
    expect(message).not.toContain('x'.repeat(MAX_VALUE_LENGTH + 1));
  });
});

describe('truncateValue / quoteValue (FR-ER2)', () => {
  it('leaves short values and exactly-200-character values alone', () => {
    expect(truncateValue('abc')).toBe('abc');
    expect(truncateValue('x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('cuts longer values to 200 characters', () => {
    expect(truncateValue('x'.repeat(201))).toHaveLength(200);
  });

  it('counts code points, so emoji are never split', () => {
    const cut = truncateValue('😀'.repeat(250));
    expect(Array.from(cut)).toHaveLength(200);
    expect(cut).toBe('😀'.repeat(200));
  });

  it('quotes via JSON escaping', () => {
    expect(quoteValue('a"b')).toBe('"a\\"b"');
  });
});
