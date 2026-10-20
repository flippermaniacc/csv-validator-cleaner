import type { RowErrorCode } from '@csv-validator/core';

const counts = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return counts.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatCount(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Plain-language names for row error codes; the record keeps the list in step with core's catalog. */
export const ROW_ERROR_LABELS: Record<RowErrorCode, string> = {
  COLUMN_COUNT_MISMATCH: 'Wrong number of fields',
  REQUIRED: 'Required value missing',
  INVALID_TYPE: 'Wrong type',
  INVALID_DATE: 'Invalid date',
  PATTERN_MISMATCH: 'Pattern mismatch',
  NOT_IN_ENUM: 'Not an allowed value',
  BELOW_MIN: 'Below minimum',
  ABOVE_MAX: 'Above maximum',
  NOT_UNIQUE: 'Duplicate value',
};

export const ROW_ERROR_CODES = Object.keys(ROW_ERROR_LABELS) as RowErrorCode[];

/** Upload limit shown to users; the server enforces it (FR-7). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
