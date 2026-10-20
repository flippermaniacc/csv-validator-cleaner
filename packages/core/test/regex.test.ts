import { describe, expect, it } from 'vitest';
import { compileFullMatch, RegexCompileError, wrapPattern } from '../src/index.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';

describe('wrapPattern / compileFullMatch', () => {
  it('wraps a pattern for full-match semantics', () => {
    expect(wrapPattern('a|b')).toBe('^(?:a|b)$');
  });

  it('matches only the whole value (FR-P1)', () => {
    const abc = compileFullMatch(nativeRegexEngine, '[A-Z]{3}');
    expect(abc.test('ABC')).toBe(true);
    expect(abc.test('ABCD')).toBe(false);
    expect(abc.test('abc')).toBe(false);
    expect(abc.test('xABC')).toBe(false);
  });

  it('keeps alternation anchored as a whole', () => {
    const alt = compileFullMatch(nativeRegexEngine, 'a|b');
    expect(alt.test('a')).toBe(true);
    expect(alt.test('b')).toBe(true);
    expect(alt.test('ab')).toBe(false);
    expect(alt.test('xb')).toBe(false);
  });

  it('propagates engine errors as RegexCompileError', () => {
    expect(() => compileFullMatch(nativeRegexEngine, '(?=a)')).toThrow(RegexCompileError);
  });
});

describe('nativeRegexEngine (test double)', () => {
  it('flags the constructs RE2 does not support', () => {
    const construct = (p: string) => {
      try {
        nativeRegexEngine.compile(p);
      } catch (e) {
        return e instanceof RegexCompileError ? e.construct : 'other';
      }
      return undefined;
    };
    expect(construct('(?=a)')).toBe('lookahead');
    expect(construct('(?!a)')).toBe('lookahead');
    expect(construct('(?<=a)')).toBe('lookbehind');
    expect(construct('(?<!a)')).toBe('lookbehind');
    expect(construct('(a)\\1')).toBe('backreference');
    expect(construct('[a-z]+')).toBeUndefined();
  });
});
