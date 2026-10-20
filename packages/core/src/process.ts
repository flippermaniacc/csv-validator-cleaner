import { serializeCleaned, type OutputColumn } from './clean.js';
import { decodeBytes, type DetectedEncoding } from './decode.js';
import { detectDelimiter, type Delimiter } from './delimiter.js';
import type { FileError } from './errors.js';
import { mapHeader } from './header.js';
import { parseRecords } from './parse.js';
import {
  MAX_STORED_ERRORS,
  ReportBuilder,
  type RunReport,
  type ValidationReport,
} from './report.js';
import type { RegexEngine } from './regex.js';
import { checkDate } from './rules/date.js';
import { createEnumRule } from './rules/enum.js';
import { truncateValue, type RuleIssue } from './rules/issue.js';
import { createPatternRule, type CellRule } from './rules/pattern.js';
import { createRangeRule, type RangeRule } from './rules/range.js';
import { checkRequired } from './rules/required.js';
import { checkType } from './rules/types.js';
import type { ColumnType, DateFormat, SchemaDefinition } from './schema/definition.js';
import { UniqueTracker } from './unique.js';

export interface AnalyzeInput {
  bytes: Uint8Array;
  /** An already validated schema (see `validateSchemaDefinition`). */
  schema: SchemaDefinition;
  regex: RegexEngine;
  maxStoredErrors?: number;
}

export type AnalysisResult =
  | {
      status: 'completed';
      report: ValidationReport;
      /** Header layout for cleaned output (FR-20). */
      columns: OutputColumn[];
      /** Valid rows only, in file column order: schema cells cleaned, pass-through raw. */
      cleanedRows: string[][];
    }
  | {
      status: 'failed';
      fileError: FileError;
      detectedEncoding?: DetectedEncoding;
      detectedDelimiter?: Delimiter;
    };

interface ColumnPlan {
  name: string;
  index: number;
  type: ColumnType;
  required: boolean;
  dateFormat: DateFormat | undefined;
  /** Pattern then enum, in SRS 3.1 order. */
  rules: CellRule[];
  range: RangeRule | null;
  unique: UniqueTracker | null;
}

/** Single-pass validation (FR-15 to FR-19): errors ordered by row, schema column, then rule order. */
export function analyzeCsv(input: AnalyzeInput): AnalysisResult {
  const { bytes, schema, regex } = input;
  if (bytes.length === 0) return failed({ code: 'FILE_EMPTY', message: 'The file is empty' });

  const { text, encoding } = decodeBytes(bytes);
  const delimiter = detectDelimiter(text);
  const detected = { detectedEncoding: encoding, detectedDelimiter: delimiter };

  const parsed = parseRecords(text, delimiter);
  if (!parsed.ok) {
    const { message, line } = parsed.error;
    return failed({ code: 'PARSE_ERROR', message: `${message} (line ${line})` }, detected);
  }
  const [headerRow, ...dataRows] = parsed.records;
  if (headerRow === undefined) {
    return failed({ code: 'FILE_EMPTY', message: 'The file has no header row' }, detected);
  }

  const header = mapHeader(headerRow, schema);
  if (!header.ok) return failed(header.error, detected);
  const { fileColumns, schemaColumns, passthroughColumns } = header.mapping;

  const plans = schemaColumns.map(({ index, definition }): ColumnPlan => {
    const rules: CellRule[] = [];
    if (definition.pattern !== undefined) rules.push(createPatternRule(regex, definition.pattern));
    if (definition.enum !== undefined) rules.push(createEnumRule(definition.type, definition.enum));
    return {
      name: definition.name,
      index,
      type: definition.type,
      required: definition.required,
      dateFormat: definition.dateFormat,
      rules,
      range: createRangeRule(definition),
      unique: definition.unique ? new UniqueTracker() : null,
    };
  });

  const report = new ReportBuilder(input.maxStoredErrors ?? MAX_STORED_ERRORS);
  const cleanedRows: string[][] = [];

  dataRows.forEach((record, offset) => {
    const row = offset + 1;
    let valid = true;
    let duplicate = false;

    if (record.length !== headerRow.length) {
      report.addError({
        row,
        column: null,
        code: 'COLUMN_COUNT_MISMATCH',
        message: `Expected ${headerRow.length} fields, got ${record.length}`,
        value: null,
      });
      report.endRow({ valid: false, duplicate: false });
      return;
    }

    const cleaned = record.slice();
    for (const plan of plans) {
      const raw = record[plan.index] as string;
      const trimmed = raw.trim();
      cleaned[plan.index] = evaluateCell(plan, trimmed, row, (issue) => {
        valid = false;
        if (issue.code === 'NOT_UNIQUE') duplicate = true;
        report.addError({
          row,
          column: plan.name,
          code: issue.code,
          message: issue.message,
          value: truncateValue(trimmed),
        });
      });
    }

    report.endRow({ valid, duplicate });
    if (valid) cleanedRows.push(cleaned);
  });

  return {
    status: 'completed',
    report: report.build({ passthroughColumns, ...detected }),
    columns: fileColumns.map((c) => ({ name: c.name, type: c.schema?.type ?? null })),
    cleanedRows,
  };
}

/** Applies the SRS 3.1 rule order to one trimmed cell and returns its cleaned value. */
function evaluateCell(
  plan: ColumnPlan,
  trimmed: string,
  row: number,
  report: (issue: RuleIssue) => void,
): string {
  const required = checkRequired(trimmed, plan.required);
  if (required) {
    report(required);
    return trimmed;
  }
  // Empty optional cells skip every remaining rule, including unique (FR-R1, FR-U2).
  if (trimmed === '') return trimmed;

  let normalized = trimmed;
  let iso: string | undefined;
  if (plan.type === 'date') {
    const date = checkDate(trimmed, plan.dateFormat);
    if (!date.ok) {
      report(date.issue);
      return trimmed;
    }
    iso = normalized = date.iso;
  } else {
    const typeIssue = checkType(plan.type, trimmed);
    if (typeIssue) {
      report(typeIssue);
      return trimmed;
    }
  }

  for (const rule of plan.rules) {
    const issue = rule(trimmed);
    if (issue) report(issue);
  }
  const rangeIssue = plan.range?.(trimmed, iso);
  if (rangeIssue) report(rangeIssue);

  // A type failure returned above, so only type-valid cells claim a key (FR-U4).
  const firstRow = plan.unique?.claim(normalized, row);
  if (firstRow !== undefined && firstRow !== null) {
    report({
      code: 'NOT_UNIQUE',
      message: `Duplicate value ${JSON.stringify(truncateValue(normalized))}; first seen in row ${firstRow}`,
    });
  }
  return normalized;
}

function failed(
  fileError: FileError,
  detected: { detectedEncoding?: DetectedEncoding; detectedDelimiter?: Delimiter } = {},
): AnalysisResult {
  return { status: 'failed', fileError, ...detected };
}

export type ProcessResult =
  | { status: 'completed'; report: RunReport; cleaned: Uint8Array }
  | Extract<AnalysisResult, { status: 'failed' }>;

/** Validates and cleans in one deterministic call: same bytes and schema give identical output (FR-17). */
export function processCsv(input: AnalyzeInput): ProcessResult {
  const analysis = analyzeCsv(input);
  if (analysis.status === 'failed') return analysis;

  const { bytes, sanitizedCells } = serializeCleaned(analysis.columns, analysis.cleanedRows);
  return {
    status: 'completed',
    report: { ...analysis.report, sanitizedCells },
    cleaned: bytes,
  };
}
