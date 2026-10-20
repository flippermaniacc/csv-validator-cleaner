import { z } from 'zod';
import { parseIsoDate } from '../calendar.js';
import { MAX_PATTERN_LENGTH } from '../regex.js';

/**
 * Single source of truth for the shape of a schema (design decision D-4).
 * Runtime validation and the TypeScript types are both derived from here.
 * Rules that need a regex engine (pattern compilation) live in `validate.ts`.
 */

export const COLUMN_TYPES = ['string', 'integer', 'decimal', 'date', 'boolean', 'email'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const DATE_FORMATS = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const MAX_SCHEMA_NAME_LENGTH = 100;

const TEXT_TYPES: readonly ColumnType[] = ['string', 'email'];
const NUMERIC_TYPES: readonly ColumnType[] = ['integer', 'decimal'];
const ENUM_TYPES: readonly ColumnType[] = ['string', 'integer', 'decimal'];

export const ColumnDefinitionSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Column name must not be empty'),
    type: z.enum(COLUMN_TYPES),
    required: z.boolean().default(false),
    unique: z.boolean().default(false),
    pattern: z.string().min(1).max(MAX_PATTERN_LENGTH).optional(),
    min: z.union([z.number().finite(), z.string()]).optional(),
    max: z.union([z.number().finite(), z.string()]).optional(),
    enum: z
      .array(z.union([z.string(), z.number().finite()]))
      .min(1)
      .optional(),
    dateFormat: z.enum(DATE_FORMATS).optional(),
  })
  .superRefine((col, ctx) => {
    const fail = (property: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [property], message });

    if (col.pattern !== undefined && !TEXT_TYPES.includes(col.type)) {
      fail('pattern', `pattern is only allowed on string and email columns, not ${col.type}`);
    }
    if (col.dateFormat !== undefined && col.type !== 'date') {
      fail('dateFormat', `dateFormat is only allowed on date columns, not ${col.type}`);
    }

    checkBound(col.type, 'min', col.min, fail);
    checkBound(col.type, 'max', col.max, fail);
    if (
      col.min !== undefined &&
      col.max !== undefined &&
      typeof col.min === typeof col.max &&
      col.min > col.max
    ) {
      fail('min', `min (${col.min}) must be less than or equal to max (${col.max})`);
    }

    if (col.enum !== undefined) checkEnum(col.type, col.enum, fail);
  });

type Fail = (property: string, message: string) => void;

function checkBound(
  type: ColumnType,
  property: 'min' | 'max',
  value: string | number | undefined,
  fail: Fail,
): void {
  if (value === undefined) return;
  if (NUMERIC_TYPES.includes(type)) {
    if (typeof value !== 'number')
      fail(property, `${property} must be a number for ${type} columns`);
    else if (type === 'integer' && !Number.isInteger(value)) {
      fail(property, `${property} must be an integer for integer columns`);
    }
  } else if (TEXT_TYPES.includes(type)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      fail(property, `${property} must be a non-negative integer length for ${type} columns`);
    }
  } else if (type === 'date') {
    if (typeof value !== 'string' || parseIsoDate(value) === null) {
      fail(property, `${property} must be a valid calendar date in YYYY-MM-DD format`);
    }
  } else {
    fail(property, `${property} is not allowed on ${type} columns`);
  }
}

function checkEnum(type: ColumnType, values: readonly (string | number)[], fail: Fail): void {
  if (!ENUM_TYPES.includes(type)) {
    fail('enum', `enum is not allowed on ${type} columns`);
    return;
  }
  const seen = new Set<string | number>();
  for (const value of values) {
    if (type === 'string') {
      if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
        fail('enum', 'enum entries for string columns must be non-empty, trimmed strings');
        return;
      }
    } else if (typeof value !== 'number' || (type === 'integer' && !Number.isInteger(value))) {
      fail(
        'enum',
        `enum entries for ${type} columns must be ${type === 'integer' ? 'integers' : 'numbers'}`,
      );
      return;
    }
    if (seen.has(value)) {
      fail('enum', `enum contains the duplicate entry ${JSON.stringify(value)}`);
      return;
    }
    seen.add(value);
  }
}

export const SchemaDefinitionSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'Schema name must not be empty')
      .max(
        MAX_SCHEMA_NAME_LENGTH,
        `Schema name must be at most ${MAX_SCHEMA_NAME_LENGTH} characters`,
      ),
    columns: z.array(ColumnDefinitionSchema).min(1, 'A schema needs at least one column'),
  })
  .superRefine((schema, ctx) => {
    const seen = new Set<string>();
    schema.columns.forEach((column, index) => {
      if (seen.has(column.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['columns', index, 'name'],
          message: `Duplicate column name "${column.name}"`,
        });
      }
      seen.add(column.name);
    });
  });

/** A validated schema, with defaults applied (`required` and `unique` are always present). */
export type SchemaDefinition = z.output<typeof SchemaDefinitionSchema>;
export type ColumnDefinition = SchemaDefinition['columns'][number];
/** What a client may submit: `required` and `unique` may be omitted. */
export type SchemaDefinitionInput = z.input<typeof SchemaDefinitionSchema>;
