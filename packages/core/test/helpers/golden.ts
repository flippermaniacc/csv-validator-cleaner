import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  processCsv,
  validateSchemaDefinition,
  type ProcessResult,
  type SchemaDefinition,
} from '../../src/index.js';
import { nativeRegexEngine } from './native-regex-engine.js';

const ROOT = new URL('../fixtures/golden/', import.meta.url);

export interface GoldenCase {
  name: string;
  dir: URL;
  input: Uint8Array;
  schema: SchemaDefinition;
}

export function goldenCases(): GoldenCase[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = new URL(`${entry.name}/`, ROOT);
      const parsed = validateSchemaDefinition(
        JSON.parse(readFileSync(new URL('schema.json', dir), 'utf8')),
        nativeRegexEngine,
      );
      if (!parsed.ok) throw new Error(`golden schema ${entry.name} is invalid`);
      return {
        name: entry.name,
        dir,
        input: readFileSync(new URL('input.csv', dir)),
        schema: parsed.schema,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function runGolden(testCase: GoldenCase): ProcessResult {
  return processCsv({ bytes: testCase.input, schema: testCase.schema, regex: nativeRegexEngine });
}

/** What report.json holds: the result without the cleaned bytes. */
export function summarize(result: ProcessResult): unknown {
  if (result.status === 'failed') return result;
  return { status: result.status, report: result.report };
}

export function readExpected(testCase: GoldenCase): { report: unknown; cleaned: string | null } {
  const cleanedUrl = new URL('cleaned.csv', testCase.dir);
  return {
    report: JSON.parse(readFileSync(new URL('report.json', testCase.dir), 'utf8')),
    cleaned: existsSync(cleanedUrl) ? readFileSync(cleanedUrl, 'utf8') : null,
  };
}

/** Rewrites the expected files; run `UPDATE_GOLDEN=1 npm test` and review the diff by eye. */
export function writeExpected(testCase: GoldenCase, result: ProcessResult): void {
  writeFileSync(
    new URL('report.json', testCase.dir),
    `${JSON.stringify(summarize(result), null, 2)}\n`,
  );
  if (result.status === 'completed') {
    writeFileSync(new URL('cleaned.csv', testCase.dir), result.cleaned);
  }
}
