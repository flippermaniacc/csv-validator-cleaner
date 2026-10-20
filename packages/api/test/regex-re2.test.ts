import {
  compileFullMatch,
  RegexCompileError,
  validateSchemaDefinition,
  wrapPattern,
} from '@csv-validator/core';
import { describe, expect, it } from 'vitest';
import { re2Engine } from '../src/regex-re2.js';

const matches = (pattern: string, value: string) =>
  compileFullMatch(re2Engine, pattern).test(value);

describe('re2Engine: supported dialect (FR-P1)', () => {
  const cases: [string, string, boolean][] = [
    ['[A-Z]{3}', 'ABC', true],
    ['[A-Z]{3}', 'ABCD', false],
    ['[A-Z]{3}', 'abc', false],
    ['a|b', 'a', true],
    ['a|b', 'ab', false],
    ['a|b', 'xb', false],
    ['\\d+', '123', true],
    ['\\d+', '12a', false],
    ['\\p{L}+', 'Привет', true],
    ['\\p{L}+', 'abc1', false],
    ['(foo|bar)-\\d{2}', 'bar-07', true],
    ['[a-z]+@[a-z]+\\.com', 'x@y.com', true],
    ['.', '😀', true],
    ['^abc$', 'abc', true],
    ['', '', true],
  ];

  it.each(cases)('pattern %j on %j is %s, like a JS RegExp', (pattern, value, expected) => {
    expect(matches(pattern, value)).toBe(expected);
    expect(new RegExp(wrapPattern(pattern), 'u').test(value)).toBe(expected);
  });

  it('gives the same answer on repeated calls', () => {
    const compiled = compileFullMatch(re2Engine, '\\p{L}+');
    expect([compiled.test('Привіт'), compiled.test('Привіт'), compiled.test('x1')]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('stays linear on a catastrophic pattern (ReDoS)', () => {
    const compiled = compileFullMatch(re2Engine, '(a+)+$');
    const start = performance.now();
    expect(compiled.test(`${'a'.repeat(50_000)}b`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('re2Engine: unsupported constructs (AC-15a)', () => {
  it.each([
    ['^(?!0)\\d+$', 'lookahead'],
    ['x(?=y)', 'lookahead'],
    ['(?<=x)y', 'lookbehind'],
    ['(?<!x)y', 'lookbehind'],
    ['(a)\\1', 'backreference'],
  ])('rejects %j naming the %s', (pattern, construct) => {
    try {
      re2Engine.compile(pattern);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RegexCompileError);
      expect((error as RegexCompileError).construct).toBe(construct);
    }
  });

  it.each(['(', '[a-', '*a', 'a{2,1}'])(
    'rejects invalid syntax %j without naming a construct',
    (pattern) => {
      try {
        re2Engine.compile(pattern);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RegexCompileError);
        expect((error as RegexCompileError).construct).toBeUndefined();
      }
    },
  );

  it.each(['a)(b', ')|('])(
    'does not let the full-match wrapper absorb unbalanced %j',
    (pattern) => {
      expect(() => compileFullMatch(re2Engine, pattern)).toThrow(RegexCompileError);
    },
  );
});

describe('schema validation with the real engine (AC-15a)', () => {
  const issues = (pattern: string) => {
    const result = validateSchemaDefinition(
      { name: 'S', columns: [{ name: 'c', type: 'string', pattern }] },
      re2Engine,
    );
    return result.ok ? [] : result.issues;
  };

  it.each([
    ['^(?!0)\\d+$', 'lookahead'],
    ['(?<=x)y', 'lookbehind'],
    ['(a)\\1', 'backreference'],
  ])('rejects %j, naming column, property and construct', (pattern, construct) => {
    const [issue] = issues(pattern);
    expect(issue).toMatchObject({ column: 'c', property: 'pattern' });
    expect(issue?.message).toContain(construct);
  });

  it('accepts a supported pattern', () => {
    expect(issues('[A-Z]{3}')).toEqual([]);
  });
});
