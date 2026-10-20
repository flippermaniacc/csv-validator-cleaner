import { describe, expect, it } from 'vitest';
import { processCsv, validateSchemaDefinition } from '../src/index.js';
import {
  BENCH_SCHEMA,
  ERRORS_PER_ALL_ERROR_ROW,
  generateAllErrorCsv,
  generateTypicalCsv,
  TEN_MIB,
} from './fixtures/gen/bench-data.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';

const parsed = validateSchemaDefinition(BENCH_SCHEMA, nativeRegexEngine);
if (!parsed.ok) throw new Error('bench schema is invalid');
const run = (bytes: Uint8Array) =>
  processCsv({ bytes, schema: parsed.schema, regex: nativeRegexEngine });

describe('benchmark generators', () => {
  it('are deterministic and fill the requested size', () => {
    const a = generateTypicalCsv(100_000, 7);
    expect(Buffer.compare(a.bytes, generateTypicalCsv(100_000, 7).bytes)).toBe(0);
    expect(Buffer.compare(a.bytes, generateTypicalCsv(100_000, 8).bytes)).not.toBe(0);
    expect(a.bytes.length).toBeLessThanOrEqual(100_000);
    expect(a.bytes.length).toBeGreaterThan(100_000 - 300);
  });

  it('produce a typical file with a small error rate and an all-error file with none valid', () => {
    const typical = run(generateTypicalCsv(300_000).bytes);
    const allError = run(generateAllErrorCsv(300_000).bytes);
    if (typical.status !== 'completed' || allError.status !== 'completed')
      throw new Error('expected completion');
    expect(typical.report.invalidRows / typical.report.totalRows).toBeGreaterThan(0.005);
    expect(typical.report.invalidRows / typical.report.totalRows).toBeLessThan(0.05);
    expect(allError.report.validRows).toBe(0);
    expect(allError.report.totalErrors).toBe(allError.report.totalRows * ERRORS_PER_ALL_ERROR_ROW);
  });
});

describe('10 MiB inputs (AC-40, AC-41)', () => {
  it('handles a typical 10 MiB file, keeping the valid rows', () => {
    const { bytes, rows } = generateTypicalCsv(TEN_MIB);
    expect(bytes.length).toBeGreaterThan(TEN_MIB - 300);
    expect(bytes.length).toBeLessThanOrEqual(TEN_MIB);
    const result = run(bytes);
    if (result.status !== 'completed') throw new Error('expected completion');
    expect(result.report.totalRows).toBe(rows);
    expect(result.report.validRows).toBeGreaterThan(rows * 0.95);
    expect(result.cleaned.length).toBeGreaterThan(TEN_MIB * 0.9);
  }, 30_000);

  it('keeps exact counts but never more than 1000 stored errors on an all-error 10 MiB file (AC-41)', () => {
    const { bytes, rows } = generateAllErrorCsv(TEN_MIB);
    expect(rows).toBeGreaterThan(100_000);
    const result = run(bytes);
    if (result.status !== 'completed') throw new Error('expected completion');
    const { report } = result;
    expect(report.totalRows).toBe(rows);
    expect(report.invalidRows).toBe(rows);
    expect(report.validRows).toBe(0);
    expect(report.totalErrors).toBe(rows * ERRORS_PER_ALL_ERROR_ROW);
    expect(report.errors).toHaveLength(1000);
    expect(report.truncated).toBe(true);
    expect(Object.values(report.errorCountsByCode).reduce((a, b) => a + b, 0)).toBe(
      report.totalErrors,
    );
    expect(Buffer.from(result.cleaned).toString('utf8')).toBe(
      'id,email,amount,issued,currency,code,active,name,memo1,memo2\n',
    );
  }, 30_000);
});
