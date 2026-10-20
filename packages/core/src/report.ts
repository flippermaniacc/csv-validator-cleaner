import type { DetectedEncoding } from './decode.js';
import type { Delimiter } from './delimiter.js';
import { ROW_ERROR_CODES, type RowErrorCode } from './errors.js';

/** Maximum errors stored per run; counts stay exact beyond it (FR-26). */
export const MAX_STORED_ERRORS = 1000;

export interface RowError {
  /** 1-based data row, excluding the header. */
  row: number;
  column: string | null;
  code: RowErrorCode;
  message: string;
  /** Trimmed offending value, truncated to 200 characters (FR-ER2). */
  value: string | null;
}

export interface ValidationReport {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRowsDropped: number;
  totalErrors: number;
  errorCountsByCode: Partial<Record<RowErrorCode, number>>;
  truncated: boolean;
  errors: RowError[];
  passthroughColumns: string[];
  detectedEncoding: DetectedEncoding;
  detectedDelimiter: Delimiter;
}

export interface RunReport extends ValidationReport {
  sanitizedCells: number;
}

export interface ReportMeta {
  passthroughColumns: string[];
  detectedEncoding: DetectedEncoding;
  detectedDelimiter: Delimiter;
}

/** Counts every error exactly but stores only the first `maxStored` (FR-26, FR-ER5). */
export class ReportBuilder {
  private readonly errors: RowError[] = [];
  private readonly counts = new Map<RowErrorCode, number>();
  private totalErrors = 0;
  private totalRows = 0;
  private validRows = 0;
  private duplicateRows = 0;

  constructor(private readonly maxStored: number = MAX_STORED_ERRORS) {}

  addError(error: RowError): void {
    this.totalErrors++;
    this.counts.set(error.code, (this.counts.get(error.code) ?? 0) + 1);
    if (this.errors.length < this.maxStored) this.errors.push(error);
  }

  endRow(outcome: { valid: boolean; duplicate: boolean }): void {
    this.totalRows++;
    if (outcome.valid) this.validRows++;
    if (outcome.duplicate) this.duplicateRows++;
  }

  build(meta: ReportMeta): ValidationReport {
    const errorCountsByCode: Partial<Record<RowErrorCode, number>> = {};
    for (const code of ROW_ERROR_CODES) {
      const count = this.counts.get(code);
      if (count !== undefined) errorCountsByCode[code] = count;
    }
    return {
      totalRows: this.totalRows,
      validRows: this.validRows,
      invalidRows: this.totalRows - this.validRows,
      duplicateRowsDropped: this.duplicateRows,
      totalErrors: this.totalErrors,
      errorCountsByCode,
      truncated: this.totalErrors > this.errors.length,
      errors: this.errors,
      ...meta,
    };
  }
}
