import { RegexCompileError, type RegexEngine } from '@csv-validator/core';
import RE2 from 're2';

const UNSUPPORTED: readonly { construct: string; test: RegExp }[] = [
  { construct: 'lookbehind', test: /\(\?<[=!]/ },
  { construct: 'lookahead', test: /\(\?[=!]/ },
  { construct: 'backreference', test: /\\[1-9]|\\k</ },
];

/** Linear-time matching removes ReDoS; unsupported constructs surface with their name (FR-P1, FR-P2). */
export const re2Engine: RegexEngine = {
  compile(pattern) {
    try {
      const re = new RE2(pattern, 'u');
      return { test: (value) => re.test(value) };
    } catch (error) {
      const construct = UNSUPPORTED.find((u) => u.test.test(pattern))?.construct;
      const reason = error instanceof Error ? error.message : String(error);
      throw new RegexCompileError(construct ? `${construct} is not supported` : reason, construct);
    }
  },
};
