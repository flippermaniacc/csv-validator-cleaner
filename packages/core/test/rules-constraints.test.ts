import { describe, expect, it } from 'vitest';
import { createEnumRule, createPatternRule, createRangeRule } from '../src/index.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';

describe('createPatternRule (AC-15)', () => {
  const abc = createPatternRule(nativeRegexEngine, '[A-Z]{3}');

  it('requires the whole value to match', () => {
    expect(abc('ABC')).toBeNull();
    for (const value of ['ABCD', 'abc', 'xABC', 'ABC ', 'AB']) {
      expect(abc(value)?.code, value).toBe('PATTERN_MISMATCH');
    }
  });

  it('anchors alternation as a whole', () => {
    const alt = createPatternRule(nativeRegexEngine, 'a|b');
    expect(alt('a')).toBeNull();
    expect(alt('b')).toBeNull();
    expect(alt('ab')?.code).toBe('PATTERN_MISMATCH');
    expect(alt('xb')?.code).toBe('PATTERN_MISMATCH');
  });

  it('puts the pattern and the value in the message', () => {
    expect(abc('abc')?.message).toBe('Expected a value matching pattern "[A-Z]{3}", got "abc"');
  });

  it('fails fast on a pattern the engine rejects', () => {
    expect(() => createPatternRule(nativeRegexEngine, '(?=a)')).toThrow(/lookahead/);
  });
});

describe('createEnumRule (AC-17)', () => {
  it('matches strings case-sensitively', () => {
    const currency = createEnumRule('string', ['USD', 'EUR']);
    expect(currency('USD')).toBeNull();
    expect(currency('usd')?.code).toBe('NOT_IN_ENUM');
    expect(currency('GBP')?.code).toBe('NOT_IN_ENUM');
  });

  it('compares integers and decimals numerically', () => {
    const ints = createEnumRule('integer', [1, 2, 3]);
    expect(ints('2')).toBeNull();
    expect(ints('+2')).toBeNull();
    expect(ints('002')).toBeNull();
    expect(ints('4')?.code).toBe('NOT_IN_ENUM');

    const decimals = createEnumRule('decimal', [1.5, 0]);
    expect(decimals('1.50')).toBeNull();
    expect(decimals('-0')).toBeNull();
    expect(decimals('1.51')?.code).toBe('NOT_IN_ENUM');
  });

  it('lists allowed values and the offending one in the message', () => {
    expect(createEnumRule('string', ['USD', 'EUR'])('GBP')?.message).toBe(
      'Expected one of ["USD", "EUR"], got "GBP"',
    );
  });

  it('caps the listed entries so messages stay short', () => {
    const entries = Array.from({ length: 25 }, (_, i) => `v${i}`);
    const message = createEnumRule('string', entries)('nope')?.message ?? '';
    expect(message).toContain('"v9"');
    expect(message).not.toContain('"v10"');
    expect(message).toContain('(15 more)');
  });
});

describe('createRangeRule (AC-16)', () => {
  it('returns no rule when there are no bounds or the type has none', () => {
    expect(createRangeRule({ type: 'integer' })).toBeNull();
    expect(createRangeRule({ type: 'boolean' })).toBeNull();
  });

  it('applies inclusive numeric bounds to integers', () => {
    const rule = createRangeRule({ type: 'integer', min: 1, max: 10 })!;
    expect(rule('1')).toBeNull();
    expect(rule('10')).toBeNull();
    expect(rule('0')?.code).toBe('BELOW_MIN');
    expect(rule('11')?.code).toBe('ABOVE_MAX');
    expect(rule('-5')?.code).toBe('BELOW_MIN');
  });

  it('applies bounds to decimals, including negative and fractional limits', () => {
    const rule = createRangeRule({ type: 'decimal', min: -0.5, max: 0.5 })!;
    expect(rule('-0.5')).toBeNull();
    expect(rule('.5')).toBeNull();
    expect(rule('0.51')?.code).toBe('ABOVE_MAX');
    expect(rule('-0.51')?.code).toBe('BELOW_MIN');
  });

  it('supports a single bound', () => {
    expect(createRangeRule({ type: 'integer', min: 5 })!('1000000')).toBeNull();
    expect(createRangeRule({ type: 'integer', max: 5 })!('-1000000')).toBeNull();
  });

  it('bounds the character length of strings and emails by code points', () => {
    const rule = createRangeRule({ type: 'string', min: 2, max: 3 })!;
    expect(rule('ab')).toBeNull();
    expect(rule('abc')).toBeNull();
    expect(rule('a')?.code).toBe('BELOW_MIN');
    expect(rule('abcd')?.code).toBe('ABOVE_MAX');
    expect(rule('😀😀')).toBeNull();
    expect(rule('😀😀😀😀')?.code).toBe('ABOVE_MAX');
    expect(createRangeRule({ type: 'email', max: 5 })!('a@b.co')?.code).toBe('ABOVE_MAX');
  });

  it('bounds dates by the normalized ISO value', () => {
    const rule = createRangeRule({ type: 'date', min: '2024-01-01', max: '2024-12-31' })!;
    expect(rule('01.01.2024', '2024-01-01')).toBeNull();
    expect(rule('31.12.2024', '2024-12-31')).toBeNull();
    expect(rule('31.12.2023', '2023-12-31')?.code).toBe('BELOW_MIN');
    expect(rule('01.01.2025', '2025-01-01')?.code).toBe('ABOVE_MAX');
  });

  it('refuses to compare dates without the normalized value', () => {
    expect(() => createRangeRule({ type: 'date', min: '2024-01-01' })!('01.01.2024')).toThrow();
  });

  it('writes deterministic messages', () => {
    expect(createRangeRule({ type: 'integer', min: 1 })!('0')?.message).toBe(
      'Expected a value of at least 1, got 0',
    );
    expect(createRangeRule({ type: 'integer', max: 9 })!('10')?.message).toBe(
      'Expected a value of at most 9, got 10',
    );
    expect(createRangeRule({ type: 'string', min: 3 })!('ab')?.message).toBe(
      'Expected a length of at least 3 characters, got 2 characters',
    );
    expect(createRangeRule({ type: 'date', max: '2024-01-01' })!('', '2024-01-02')?.message).toBe(
      'Expected a date on or before 2024-01-01, got 2024-01-02',
    );
  });
});
