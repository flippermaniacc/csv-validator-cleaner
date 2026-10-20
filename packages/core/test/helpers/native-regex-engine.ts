import { RegexCompileError, type RegexEngine } from '../../src/index.js';

/**
 * Lightweight test engine backed by the JS RegExp. It imitates RE2's dialect
 * restrictions (no lookaround, no backreferences) so core tests exercise the
 * same rejection paths without needing the native `re2` module.
 */
const UNSUPPORTED: readonly { construct: string; test: RegExp }[] = [
  { construct: 'lookahead', test: /\(\?[=!]/ },
  { construct: 'lookbehind', test: /\(\?<[=!]/ },
  { construct: 'backreference', test: /\\[1-9]|\\k</ },
];

export const nativeRegexEngine: RegexEngine = {
  compile(pattern) {
    for (const { construct, test } of UNSUPPORTED) {
      if (test.test(pattern)) {
        throw new RegexCompileError(`${construct} is not supported`, construct);
      }
    }
    try {
      const re = new RegExp(pattern, 'u');
      return { test: (value) => re.test(value) };
    } catch (error) {
      throw new RegexCompileError(error instanceof Error ? error.message : String(error));
    }
  },
};
