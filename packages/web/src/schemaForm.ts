import type {
  ColumnType,
  DateFormat,
  SchemaDefinitionInput,
  SchemaIssue,
} from '@csv-validator/core';
import type { SchemaResource } from './api/client';

/**
 * Per-type capabilities as exhaustive records: adding a type or date format in core
 * fails the typecheck here until the UI handles it (web only imports core types).
 */
export interface TypeInfo {
  label: string;
  pattern: boolean;
  enum: boolean;
  dateFormat: boolean;
  bounds: 'number' | 'length' | 'date' | null;
}

export const TYPE_INFO: Record<ColumnType, TypeInfo> = {
  string: { label: 'Text', pattern: true, enum: true, dateFormat: false, bounds: 'length' },
  integer: { label: 'Integer', pattern: false, enum: true, dateFormat: false, bounds: 'number' },
  decimal: { label: 'Decimal', pattern: false, enum: true, dateFormat: false, bounds: 'number' },
  date: { label: 'Date', pattern: false, enum: false, dateFormat: true, bounds: 'date' },
  boolean: { label: 'Boolean', pattern: false, enum: false, dateFormat: false, bounds: null },
  email: { label: 'Email', pattern: true, enum: false, dateFormat: false, bounds: 'length' },
};

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  'YYYY-MM-DD': 'YYYY-MM-DD',
  'DD.MM.YYYY': 'DD.MM.YYYY',
  'DD/MM/YYYY': 'DD/MM/YYYY',
  'MM/DD/YYYY': 'MM/DD/YYYY',
};

export const COLUMN_TYPES = Object.keys(TYPE_INFO) as ColumnType[];
export const DATE_FORMATS = Object.keys(DATE_FORMAT_LABELS) as DateFormat[];

export interface ColumnForm {
  /** Stable React key; not sent to the server. */
  key: number;
  name: string;
  type: ColumnType;
  required: boolean;
  unique: boolean;
  pattern: string;
  min: string;
  max: string;
  /** One allowed value per line. */
  enumText: string;
  dateFormat: DateFormat | '';
}

export interface SchemaForm {
  name: string;
  columns: ColumnForm[];
}

export function emptyColumn(key: number): ColumnForm {
  return {
    key,
    name: '',
    type: 'string',
    required: false,
    unique: false,
    pattern: '',
    min: '',
    max: '',
    enumText: '',
    dateFormat: '',
  };
}

export function emptyForm(): SchemaForm {
  return { name: '', columns: [emptyColumn(1)] };
}

export function fromResource(resource: SchemaResource): SchemaForm {
  return {
    name: resource.name,
    columns: resource.columns.map((column, i) => ({
      key: i + 1,
      name: column.name,
      type: column.type,
      required: column.required,
      unique: column.unique,
      pattern: column.pattern ?? '',
      min: column.min === undefined ? '' : String(column.min),
      max: column.max === undefined ? '' : String(column.max),
      enumText: column.enum?.join('\n') ?? '',
      dateFormat: column.dateFormat ?? '',
    })),
  };
}

/**
 * Shapes form text into the request body. It only converts: values the server must
 * judge (a non-numeric `min`, a stray enum entry) are sent as typed so it can reject them (FR-30).
 */
export function toDraft(form: SchemaForm): SchemaDefinitionInput {
  return {
    name: form.name,
    columns: form.columns.map((column) => {
      const info = TYPE_INFO[column.type];
      const out: SchemaDefinitionInput['columns'][number] = {
        name: column.name,
        type: column.type,
        required: column.required,
        unique: column.unique,
      };
      if (info.pattern && column.pattern !== '') out.pattern = column.pattern;
      if (info.dateFormat && column.dateFormat !== '') out.dateFormat = column.dateFormat;
      if (info.bounds) {
        if (column.min !== '') out.min = bound(info.bounds, column.min);
        if (column.max !== '') out.max = bound(info.bounds, column.max);
      }
      if (info.enum) {
        const entries = column.enumText
          .split(/\r?\n/)
          .filter((line) => line !== '')
          .map((line) => (column.type === 'string' ? line : numeric(line)));
        if (entries.length > 0) out.enum = entries;
      }
      return out;
    }),
  };
}

function bound(kind: 'number' | 'length' | 'date', text: string): number | string {
  return kind === 'date' ? text : numeric(text);
}

function numeric(text: string): number | string {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) ? value : text;
}

export interface GroupedIssues {
  /** Problems with the schema as a whole, keyed by property (`name`, `columns`). */
  schema: Record<string, string[]>;
  /** Problems per column index, keyed by property; `''` holds column-level messages. */
  columns: Map<number, Record<string, string[]>>;
  /** Anything that could not be placed next to a field. */
  other: string[];
}

/** Places server issues next to the fields they name, using the issue path (FR-4). */
export function groupIssues(issues: readonly SchemaIssue[]): GroupedIssues {
  const grouped: GroupedIssues = { schema: {}, columns: new Map(), other: [] };
  const add = (bucket: Record<string, string[]>, key: string, message: string) => {
    (bucket[key] ??= []).push(message);
  };

  for (const issue of issues) {
    const [scope, index, property] = issue.path;
    if (scope === 'columns' && typeof index === 'number') {
      const bucket = grouped.columns.get(index) ?? {};
      grouped.columns.set(index, bucket);
      add(bucket, typeof property === 'string' ? property : '', issue.message);
    } else if (typeof scope === 'string') {
      add(grouped.schema, scope, issue.message);
    } else {
      grouped.other.push(issue.message);
    }
  }
  return grouped;
}
