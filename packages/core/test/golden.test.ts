import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type ErrorCode } from '../src/index.js';
import {
  goldenCases,
  readExpected,
  runGolden,
  summarize,
  writeExpected,
} from './helpers/golden.js';

const cases = goldenCases();

describe('golden files', () => {
  it('has fixtures to run', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const result = runGolden(testCase);
    if (process.env['UPDATE_GOLDEN']) writeExpected(testCase, result);

    const expected = readExpected(testCase);
    expect(JSON.parse(JSON.stringify(summarize(result)))).toEqual(expected.report);
    if (result.status === 'completed') {
      expect(Buffer.from(result.cleaned).toString('utf8')).toBe(expected.cleaned);
    } else {
      expect(expected.cleaned).toBeNull();
    }
  });
});

describe('error code coverage (AC-42)', () => {
  // FILE_TOO_LARGE is a transport-level rejection, so it is exercised by the API tests.
  const NOT_PRODUCED_BY_CORE: ErrorCode[] = ['FILE_TOO_LARGE'];

  it('produces every other catalog code in at least one golden fixture', () => {
    const produced = new Set<string>();
    for (const testCase of cases) {
      const result = runGolden(testCase);
      if (result.status === 'failed') produced.add(result.fileError.code);
      else Object.keys(result.report.errorCountsByCode).forEach((code) => produced.add(code));
    }
    const missing = ERROR_CODES.filter(
      (c) => !NOT_PRODUCED_BY_CORE.includes(c) && !produced.has(c),
    );
    expect(missing).toEqual([]);
  });
});
