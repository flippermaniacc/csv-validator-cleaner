import { createHash } from 'node:crypto';
import {
  processCsv,
  validateSchemaDefinition,
  type RegexEngine,
  type RowError,
} from '@csv-validator/core';
import type { RunRecord, RunsRepo } from '../db/runs.repo.js';
import type { SchemasRepo } from '../db/schemas.repo.js';
import { ApiError } from '../errors.js';
import type { CleanedFileStore } from '../storage/cleaned-files.js';

export interface ValidationServiceDeps {
  schemas: SchemasRepo;
  runs: RunsRepo;
  files: CleanedFileStore;
  regex: RegexEngine;
  now: () => Date;
  newId: () => string;
}

export interface ValidationInput {
  bytes: Buffer;
  filename: string;
  schemaId: string;
}

/** One validation: snapshot the schema, process inline, write the file, then commit the run (design 4.3). */
export class ValidationService {
  constructor(private readonly deps: ValidationServiceDeps) {}

  async validate(input: ValidationInput): Promise<RunRecord> {
    const { schemas, runs, files, regex } = this.deps;

    const stored = schemas.get(input.schemaId);
    if (!stored) throw new ApiError(404, 'SCHEMA_NOT_FOUND', 'Schema not found');
    // A hand-edited database row must never reach `core` unchecked (design 11.6).
    const checked = validateSchemaDefinition(stored.definition, regex);
    if (!checked.ok) {
      throw new ApiError(
        500,
        'STORED_SCHEMA_INVALID',
        'The stored schema definition is no longer valid',
      );
    }

    const id = this.deps.newId();
    const result = processCsv({ bytes: input.bytes, schema: checked.schema, regex });

    const base = {
      id,
      createdAt: this.deps.now().toISOString(),
      originalFilename: input.filename,
      fileSizeBytes: input.bytes.byteLength,
      fileSha256: createHash('sha256').update(input.bytes).digest('hex'),
      schemaId: stored.id,
      schemaName: checked.schema.name,
      schemaSnapshot: { id: stored.id, ...checked.schema },
    };

    let record: RunRecord;
    let errors: readonly RowError[] = [];
    let cleanedPath: string | null = null;

    if (result.status === 'failed') {
      record = {
        ...base,
        status: 'failed',
        fileError: result.fileError,
        detectedEncoding: result.detectedEncoding ?? null,
        detectedDelimiter: result.detectedDelimiter ?? null,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        duplicateRowsDropped: 0,
        totalErrors: 0,
        truncated: false,
        errorCountsByCode: {},
        passthroughColumns: [],
        sanitizedCells: 0,
        cleanedPath: null,
        cleanedSizeBytes: null,
      };
    } else {
      const { report } = result;
      const written = await files.write(id, result.cleaned);
      cleanedPath = written.relativePath;
      errors = report.errors;
      record = {
        ...base,
        status: 'completed',
        fileError: null,
        detectedEncoding: report.detectedEncoding,
        detectedDelimiter: report.detectedDelimiter,
        totalRows: report.totalRows,
        validRows: report.validRows,
        invalidRows: report.invalidRows,
        duplicateRowsDropped: report.duplicateRowsDropped,
        totalErrors: report.totalErrors,
        truncated: report.truncated,
        errorCountsByCode: report.errorCountsByCode,
        passthroughColumns: report.passthroughColumns,
        sanitizedCells: report.sanitizedCells,
        cleanedPath: written.relativePath,
        cleanedSizeBytes: written.sizeBytes,
      };
    }

    try {
      runs.insert(record, errors);
    } catch (error) {
      if (cleanedPath) await files.remove(cleanedPath);
      throw error;
    }
    return record;
  }
}
