import { describe, expect, it } from 'vitest';
import {
  analyzeCsv,
  MAX_VALUE_LENGTH,
  type AnalysisResult,
  type SchemaDefinition,
} from '../src/index.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';
import { makeSchema } from './helpers/schema.js';

function run(text: string, schema: SchemaDefinition, maxStoredErrors?: number): AnalysisResult {
  return analyzeCsv({
    bytes: Buffer.from(text, 'utf8'),
    schema,
    regex: nativeRegexEngine,
    ...(maxStoredErrors === undefined ? {} : { maxStoredErrors }),
  });
}

function completed(text: string, schema: SchemaDefinition, maxStoredErrors?: number) {
  const result = run(text, schema, maxStoredErrors);
  if (result.status !== 'completed')
    throw new Error(`expected completion: ${result.fileError.message}`);
  return result;
}

const lines = (...rows: string[]) => rows.join('\n');
const one = (column: Record<string, unknown>) => makeSchema([{ name: 'c', ...column }]);

describe('analyzeCsv: file-level failures', () => {
  it('fails FILE_EMPTY for zero bytes and for blank-only input', () => {
    const schema = one({ type: 'string' });
    expect(run('', schema)).toMatchObject({ status: 'failed', fileError: { code: 'FILE_EMPTY' } });
    expect(run('\n\r\n', schema)).toMatchObject({
      status: 'failed',
      fileError: { code: 'FILE_EMPTY' },
    });
  });

  it('fails PARSE_ERROR with the line number and keeps the detected encoding and delimiter', () => {
    const result = run('c;d\n"never closed', one({ type: 'string' }));
    expect(result).toMatchObject({
      status: 'failed',
      fileError: { code: 'PARSE_ERROR', message: 'Unterminated quoted field (line 2)' },
      detectedEncoding: 'utf-8',
      detectedDelimiter: ';',
    });
  });

  it('fails MISSING_COLUMN without any row validation (AC-8)', () => {
    const result = run(
      lines('id,name', '1,a', '2,b'),
      makeSchema([
        { name: 'id', type: 'integer' },
        { name: 'email', type: 'email', required: true },
      ]),
    );
    expect(result).toMatchObject({ status: 'failed', fileError: { code: 'MISSING_COLUMN' } });
    expect('report' in result).toBe(false);
  });

  it('fails DUPLICATE_COLUMN when a schema column repeats', () => {
    const result = run('c,c\n1,2', one({ type: 'string' }));
    expect(result).toMatchObject({ status: 'failed', fileError: { code: 'DUPLICATE_COLUMN' } });
  });
});

describe('analyzeCsv: columns and cleaned rows', () => {
  const schema = makeSchema([
    { name: 'id', type: 'integer' },
    { name: 'when', type: 'date', dateFormat: 'DD.MM.YYYY' },
    { name: 'name', type: 'string' },
  ]);

  it('reports pass-through columns and keeps their raw values (AC-8)', () => {
    const result = completed(lines('id,notes,when,name', ' 1 , raw ,01.03.2024, Ann '), schema);
    expect(result.report.passthroughColumns).toEqual(['notes']);
    expect(result.columns).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'notes', type: null },
      { name: 'when', type: 'date' },
      { name: 'name', type: 'string' },
    ]);
    expect(result.cleanedRows).toEqual([['1', ' raw ', '2024-03-01', 'Ann']]);
  });

  it('records the detected encoding and delimiter', () => {
    const result = completed(lines('id;when;name', '1;01.03.2024;x'), schema);
    expect(result.report).toMatchObject({ detectedEncoding: 'utf-8', detectedDelimiter: ';' });
  });

  it('handles a header-only file', () => {
    const result = completed('id,when,name\n', schema);
    expect(result.report).toMatchObject({
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      totalErrors: 0,
    });
    expect(result.cleanedRows).toEqual([]);
  });
});

describe('analyzeCsv: row shape (AC-9)', () => {
  const schema = makeSchema([
    { name: 'a', type: 'string' },
    { name: 'b', type: 'string' },
  ]);

  it('flags rows with too few or too many fields and excludes them', () => {
    const result = completed(lines('a,b', '1', '1,2,3', '1,2'), schema);
    expect(result.report.errors).toEqual([
      {
        row: 1,
        column: null,
        code: 'COLUMN_COUNT_MISMATCH',
        message: 'Expected 2 fields, got 1',
        value: null,
      },
      {
        row: 2,
        column: null,
        code: 'COLUMN_COUNT_MISMATCH',
        message: 'Expected 2 fields, got 3',
        value: null,
      },
    ]);
    expect(result.report).toMatchObject({ totalRows: 3, validRows: 1, invalidRows: 2 });
    expect(result.cleanedRows).toEqual([['1', '2']]);
  });

  it('reports a blank line in the middle as a field-count mismatch', () => {
    const result = completed(lines('a,b', '1,2', '', '3,4'), schema);
    expect(result.report.errors.map((e) => [e.row, e.code])).toEqual([
      [2, 'COLUMN_COUNT_MISMATCH'],
    ]);
  });

  it('does not let a malformed row claim unique keys', () => {
    const uniq = makeSchema([
      { name: 'id', type: 'string', unique: true },
      { name: 'x', type: 'string' },
    ]);
    const result = completed(lines('id,x', 'A', 'A,1'), uniq);
    expect(result.report.errors.map((e) => e.code)).toEqual(['COLUMN_COUNT_MISMATCH']);
  });
});

describe('analyzeCsv: required and empty cells (AC-10)', () => {
  it('flags empty and whitespace-only cells in required columns', () => {
    const result = completed(
      lines('c,d', ',x', '   ,x', 'ok,x'),
      makeSchema([
        { name: 'c', type: 'string', required: true },
        { name: 'd', type: 'string' },
      ]),
    );
    expect(result.report.errors.map((e) => [e.row, e.column, e.code, e.value])).toEqual([
      [1, 'c', 'REQUIRED', ''],
      [2, 'c', 'REQUIRED', ''],
    ]);
  });

  it('accepts empty optional cells and skips every other rule, including unique', () => {
    const schema = one({ type: 'integer', unique: true, min: 5, pattern: undefined });
    const result = completed(lines('c', '', '  ', '', '7'), schema);
    expect(result.report.totalErrors).toBe(0);
    expect(result.cleanedRows).toEqual([[''], [''], [''], ['7']]);
  });
});

describe('analyzeCsv: uniqueness (AC-20)', () => {
  it('keeps the first occurrence and flags later duplicates case-sensitively', () => {
    const result = completed(lines('c', 'A', 'B', 'a', 'A'), one({ type: 'string', unique: true }));
    expect(result.report.errors).toEqual([
      {
        row: 4,
        column: 'c',
        code: 'NOT_UNIQUE',
        message: 'Duplicate value "A"; first seen in row 1',
        value: 'A',
      },
    ]);
    expect(result.report.duplicateRowsDropped).toBe(1);
    expect(result.cleanedRows).toEqual([['A'], ['B'], ['a']]);
  });

  it('compares dates by their normalized value', () => {
    const result = completed(
      lines('c', '01.03.2024', '2024-03-01'),
      one({ type: 'date', dateFormat: 'DD.MM.YYYY', unique: true }),
    );
    expect(result.report.errors.map((e) => [e.row, e.code])).toEqual([[2, 'NOT_UNIQUE']]);
  });

  it('compares trimmed values', () => {
    const result = completed(lines('c', 'A', ' A '), one({ type: 'string', unique: true }));
    expect(result.report.errors.map((e) => e.row)).toEqual([2]);
  });

  it('lets a first row claim the key even when it is invalid in another column (FR-U4)', () => {
    const schema = makeSchema([
      { name: 'id', type: 'integer', unique: true },
      { name: 'email', type: 'email' },
    ]);
    const result = completed(lines('id,email', '1,bad', '1,a@b.co'), schema);
    expect(result.report.errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [1, 'email', 'INVALID_TYPE'],
      [2, 'id', 'NOT_UNIQUE'],
    ]);
    expect(result.cleanedRows).toEqual([]);
  });

  it('stops a cell at a type failure, so repeated invalid values are not also duplicates', () => {
    const result = completed(lines('c', 'x', 'x'), one({ type: 'integer', unique: true }));
    expect(result.report.errors.map((e) => e.code)).toEqual(['INVALID_TYPE', 'INVALID_TYPE']);
  });

  it('lets a pattern failure claim its key', () => {
    const result = completed(
      lines('c', 'abc', 'abc'),
      one({ type: 'string', unique: true, pattern: '[A-Z]+' }),
    );
    expect(result.report.errors.map((e) => [e.row, e.code])).toEqual([
      [1, 'PATTERN_MISMATCH'],
      [2, 'PATTERN_MISMATCH'],
      [2, 'NOT_UNIQUE'],
    ]);
  });

  it('counts a row once in duplicateRowsDropped when several unique columns collide', () => {
    const schema = makeSchema([
      { name: 'a', type: 'string', unique: true },
      { name: 'b', type: 'string', unique: true },
    ]);
    const result = completed(lines('a,b', '1,2', '1,2'), schema);
    expect(result.report.totalErrors).toBe(2);
    expect(result.report.duplicateRowsDropped).toBe(1);
  });
});

describe('analyzeCsv: error order and content (AC-28)', () => {
  const schema = makeSchema([
    { name: 'code', type: 'string', pattern: '[A-Z]+', enum: ['AB', 'CD'], min: 2 },
    { name: 'qty', type: 'integer', min: 1 },
  ]);

  it('orders errors by row, then schema column, then rule', () => {
    const result = completed(lines('qty,code', '0,x', 'oops,AB', '5,CD', '0,y'), schema);
    expect(result.report.errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [1, 'code', 'PATTERN_MISMATCH'],
      [1, 'code', 'NOT_IN_ENUM'],
      [1, 'code', 'BELOW_MIN'],
      [1, 'qty', 'BELOW_MIN'],
      [2, 'qty', 'INVALID_TYPE'],
      [4, 'code', 'PATTERN_MISMATCH'],
      [4, 'code', 'NOT_IN_ENUM'],
      [4, 'code', 'BELOW_MIN'],
      [4, 'qty', 'BELOW_MIN'],
    ]);
  });

  it('gives every error a positive row, a known column, a code and a message', () => {
    const { report } = completed(lines('qty,code', '0,x', 'oops,AB'), schema);
    for (const error of report.errors) {
      expect(error.row).toBeGreaterThanOrEqual(1);
      expect(['code', 'qty']).toContain(error.column);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('reports trimmed values and stops at a failed type check', () => {
    const result = completed(
      lines('c', '  abc  '),
      one({ type: 'integer', min: 5, pattern: undefined }),
    );
    expect(result.report.errors).toEqual([
      { row: 1, column: 'c', code: 'INVALID_TYPE', message: expect.any(String), value: 'abc' },
    ]);
  });

  it('truncates long offending values to 200 characters (AC-31)', () => {
    const result = completed(
      lines('c', 'x'.repeat(5000)),
      one({ type: 'string', pattern: '[a-z]{3}' }),
    );
    expect(result.report.errors[0]?.value).toBe('x'.repeat(MAX_VALUE_LENGTH));
  });

  it('cleans dates to ISO in cleaned rows and checks date ranges on the ISO value', () => {
    const result = completed(
      lines('c', '01.03.2024', '31.12.2023'),
      one({ type: 'date', dateFormat: 'DD.MM.YYYY', min: '2024-01-01' }),
    );
    expect(result.report.errors.map((e) => [e.row, e.code])).toEqual([[2, 'BELOW_MIN']]);
    expect(result.cleanedRows).toEqual([['2024-03-01']]);
  });
});

describe('analyzeCsv: counts and the error cap (AC-29, AC-30)', () => {
  const schema = one({ type: 'integer' });
  const rows = (n: number, bad: (i: number) => boolean) =>
    lines('c', ...Array.from({ length: n }, (_, i) => (bad(i + 1) ? 'x' : String(i + 1))));

  it('keeps exact totals but stores only the first 1000 errors', () => {
    const { report } = completed(
      rows(5000, () => true),
      schema,
    );
    expect(report.totalErrors).toBe(5000);
    expect(report.errors).toHaveLength(1000);
    expect(report.truncated).toBe(true);
    expect(report.errorCountsByCode).toEqual({ INVALID_TYPE: 5000 });
    expect(report.errors.map((e) => e.row)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
  });

  it('does not flag truncation at exactly 1000 errors', () => {
    const { report } = completed(
      rows(1000, () => true),
      schema,
    );
    expect(report.totalErrors).toBe(1000);
    expect(report.errors).toHaveLength(1000);
    expect(report.truncated).toBe(false);
  });

  it('honours a custom cap', () => {
    const { report } = completed(
      rows(10, () => true),
      schema,
      3,
    );
    expect(report.errors).toHaveLength(3);
    expect(report.totalErrors).toBe(10);
    expect(report.truncated).toBe(true);
  });

  it('upholds the report invariants for a completed run with errors', () => {
    const multi = makeSchema([
      { name: 'a', type: 'integer', unique: true },
      { name: 'b', type: 'string', required: true },
    ]);
    const { report, cleanedRows } = completed(lines('a,b', '1,x', '1,', 'z,y', '2,ok', '3'), multi);
    expect(report.validRows + report.invalidRows).toBe(report.totalRows);
    expect(Object.values(report.errorCountsByCode).reduce((a, b) => a + b, 0)).toBe(
      report.totalErrors,
    );
    expect(report.errors).toHaveLength(Math.min(report.totalErrors, 1000));
    expect(cleanedRows).toHaveLength(report.validRows);
    expect(report.invalidRows).toBe(3);
  });

  it('counts invalid rows rather than errors', () => {
    const { report } = completed(
      lines('c', 'x'),
      makeSchema([{ name: 'c', type: 'integer', min: 5, enum: [9] }]),
    );
    expect(report.invalidRows).toBe(1);
  });

  it('lists error counts in catalog order', () => {
    const schema = makeSchema([
      { name: 'a', type: 'string', required: true },
      { name: 'b', type: 'integer' },
    ]);
    const { report } = completed(lines('a,b', ',x', 'k'), schema);
    expect(Object.keys(report.errorCountsByCode)).toEqual([
      'COLUMN_COUNT_MISMATCH',
      'REQUIRED',
      'INVALID_TYPE',
    ]);
  });
});

describe('analyzeCsv: determinism (NFR-3)', () => {
  it('returns deeply equal results for repeated runs', () => {
    const schema = makeSchema([
      { name: 'id', type: 'integer', unique: true },
      { name: 'when', type: 'date', dateFormat: 'MM/DD/YYYY' },
    ]);
    const text = lines('id,when', '1,03/01/2024', '1,13/01/2024', 'x,');
    expect(run(text, schema)).toEqual(run(text, schema));
  });
});
