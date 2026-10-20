import type { FileError, RowError, RowErrorCode } from '@csv-validator/core';
import type { Db } from './connection.js';

export interface RunRecord {
  id: string;
  createdAt: string;
  originalFilename: string;
  fileSizeBytes: number;
  fileSha256: string;
  schemaId: string | null;
  schemaName: string;
  schemaSnapshot: unknown;
  status: 'completed' | 'failed';
  fileError: FileError | null;
  detectedEncoding: string | null;
  detectedDelimiter: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRowsDropped: number;
  totalErrors: number;
  truncated: boolean;
  errorCountsByCode: Partial<Record<RowErrorCode, number>>;
  passthroughColumns: string[];
  sanitizedCells: number;
  cleanedPath: string | null;
  cleanedSizeBytes: number | null;
}

interface Row {
  id: string;
  created_at: string;
  original_filename: string;
  file_size_bytes: number;
  file_sha256: string;
  schema_id: string | null;
  schema_name: string;
  schema_snapshot: string;
  status: 'completed' | 'failed';
  file_error: string | null;
  detected_encoding: string | null;
  detected_delimiter: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows_dropped: number;
  total_errors: number;
  truncated: number;
  error_counts_by_code: string;
  passthrough_columns: string;
  sanitized_cells: number;
  cleaned_path: string | null;
  cleaned_size_bytes: number | null;
}

export class RunsRepo {
  constructor(private readonly db: Db) {}

  /** Inserts the run and its stored errors in one transaction: all or nothing (FR-DB3). */
  insert(run: RunRecord, errors: readonly RowError[]): void {
    const insertRun = this.db.prepare(
      `INSERT INTO runs (id, created_at, original_filename, file_size_bytes, file_sha256, schema_id,
         schema_name, schema_snapshot, status, file_error, detected_encoding, detected_delimiter,
         total_rows, valid_rows, invalid_rows, duplicate_rows_dropped, total_errors, truncated,
         error_counts_by_code, passthrough_columns, sanitized_cells, cleaned_path, cleaned_size_bytes)
       VALUES (@id, @createdAt, @originalFilename, @fileSizeBytes, @fileSha256, @schemaId,
         @schemaName, @schemaSnapshot, @status, @fileError, @detectedEncoding, @detectedDelimiter,
         @totalRows, @validRows, @invalidRows, @duplicateRowsDropped, @totalErrors, @truncated,
         @errorCountsByCode, @passthroughColumns, @sanitizedCells, @cleanedPath, @cleanedSizeBytes)`,
    );
    const insertError = this.db.prepare(
      `INSERT INTO run_errors (run_id, seq, "row", "column", code, message, value)
       VALUES (@runId, @seq, @row, @column, @code, @message, @value)`,
    );

    this.db.transaction(() => {
      insertRun.run({
        ...run,
        schemaSnapshot: JSON.stringify(run.schemaSnapshot),
        fileError: run.fileError ? JSON.stringify(run.fileError) : null,
        truncated: run.truncated ? 1 : 0,
        errorCountsByCode: JSON.stringify(run.errorCountsByCode),
        passthroughColumns: JSON.stringify(run.passthroughColumns),
      });
      errors.forEach((error, seq) => insertError.run({ runId: run.id, seq, ...error }));
    })();
  }

  get(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  has(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM runs WHERE id = ?').get(id) !== undefined;
  }
}

function fromRow(row: Row): RunRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    originalFilename: row.original_filename,
    fileSizeBytes: row.file_size_bytes,
    fileSha256: row.file_sha256,
    schemaId: row.schema_id,
    schemaName: row.schema_name,
    schemaSnapshot: JSON.parse(row.schema_snapshot),
    status: row.status,
    fileError: row.file_error ? (JSON.parse(row.file_error) as FileError) : null,
    detectedEncoding: row.detected_encoding,
    detectedDelimiter: row.detected_delimiter,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    invalidRows: row.invalid_rows,
    duplicateRowsDropped: row.duplicate_rows_dropped,
    totalErrors: row.total_errors,
    truncated: row.truncated === 1,
    errorCountsByCode: JSON.parse(row.error_counts_by_code),
    passthroughColumns: JSON.parse(row.passthrough_columns),
    sanitizedCells: row.sanitized_cells,
    cleanedPath: row.cleaned_path,
    cleanedSizeBytes: row.cleaned_size_bytes,
  };
}
