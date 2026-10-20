/** Error code catalog (SRS section 4.3). */

export const FILE_ERROR_CODES = [
  'FILE_TOO_LARGE',
  'FILE_EMPTY',
  'PARSE_ERROR',
  'MISSING_COLUMN',
  'DUPLICATE_COLUMN',
] as const;

export const ROW_ERROR_CODES = [
  'COLUMN_COUNT_MISMATCH',
  'REQUIRED',
  'INVALID_TYPE',
  'INVALID_DATE',
  'PATTERN_MISMATCH',
  'NOT_IN_ENUM',
  'BELOW_MIN',
  'ABOVE_MAX',
  'NOT_UNIQUE',
] as const;

export const ERROR_CODES = [...FILE_ERROR_CODES, ...ROW_ERROR_CODES] as const;

export type FileErrorCode = (typeof FILE_ERROR_CODES)[number];
export type RowErrorCode = (typeof ROW_ERROR_CODES)[number];
export type ErrorCode = FileErrorCode | RowErrorCode;

export const ERROR_LEVEL: Readonly<Record<ErrorCode, 'file' | 'row'>> = {
  FILE_TOO_LARGE: 'file',
  FILE_EMPTY: 'file',
  PARSE_ERROR: 'file',
  MISSING_COLUMN: 'file',
  DUPLICATE_COLUMN: 'file',
  COLUMN_COUNT_MISMATCH: 'row',
  REQUIRED: 'row',
  INVALID_TYPE: 'row',
  INVALID_DATE: 'row',
  PATTERN_MISMATCH: 'row',
  NOT_IN_ENUM: 'row',
  BELOW_MIN: 'row',
  ABOVE_MAX: 'row',
  NOT_UNIQUE: 'row',
};

export interface FileError {
  code: FileErrorCode;
  message: string;
}
