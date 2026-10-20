import type { RunRecord } from '../db/runs.repo.js';

/** The run as clients see it: counts and metadata, without the snapshot or error list. */
export function presentRun(run: RunRecord) {
  return {
    id: run.id,
    createdAt: run.createdAt,
    originalFilename: run.originalFilename,
    fileSizeBytes: run.fileSizeBytes,
    fileSha256: run.fileSha256,
    schema: { id: run.schemaId, name: run.schemaName },
    status: run.status,
    fileError: run.fileError,
    detectedEncoding: run.detectedEncoding,
    detectedDelimiter: run.detectedDelimiter,
    totalRows: run.totalRows,
    validRows: run.validRows,
    invalidRows: run.invalidRows,
    duplicateRowsDropped: run.duplicateRowsDropped,
    totalErrors: run.totalErrors,
    truncated: run.truncated,
    errorCountsByCode: run.errorCountsByCode,
    passthroughColumns: run.passthroughColumns,
    sanitizedCells: run.sanitizedCells,
    cleanedSizeBytes: run.cleanedSizeBytes,
  };
}
