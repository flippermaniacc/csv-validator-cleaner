import type { FileError } from './errors.js';
import type { ColumnDefinition, SchemaDefinition } from './schema/definition.js';

export interface FileColumn {
  index: number;
  /** Trimmed header name. */
  name: string;
  /** Matching schema column, or null for a pass-through column. */
  schema: ColumnDefinition | null;
}

export interface BoundColumn {
  index: number;
  definition: ColumnDefinition;
}

export interface HeaderMapping {
  /** Every file column in file order, for cleaned output (FR-20). */
  fileColumns: FileColumn[];
  /** Schema columns in schema order with their file positions. */
  schemaColumns: BoundColumn[];
  /** Names of unvalidated columns, in file order (FR-ER4). */
  passthroughColumns: string[];
}

export type HeaderResult = { ok: true; mapping: HeaderMapping } | { ok: false; error: FileError };

/** Maps the header row to the schema by exact trimmed name (FR-12). */
export function mapHeader(headerRow: readonly string[], schema: SchemaDefinition): HeaderResult {
  const names = headerRow.map((h) => h.trim());
  const positions = new Map<string, number[]>();
  names.forEach((name, index) => {
    const seen = positions.get(name);
    if (seen) seen.push(index);
    else positions.set(name, [index]);
  });

  const missing = schema.columns.filter((c) => !positions.has(c.name));
  if (missing.length > 0) {
    return fail('MISSING_COLUMN', `Header is missing schema columns: ${quoteAll(missing)}`);
  }
  const repeated = schema.columns.filter((c) => (positions.get(c.name)?.length ?? 0) > 1);
  if (repeated.length > 0) {
    return fail('DUPLICATE_COLUMN', `Header repeats schema columns: ${quoteAll(repeated)}`);
  }

  const byName = new Map(schema.columns.map((c) => [c.name, c]));
  const fileColumns = names.map((name, index) => ({
    index,
    name,
    schema: byName.get(name) ?? null,
  }));
  const schemaColumns = schema.columns.map((definition) => ({
    index: positions.get(definition.name)?.[0] as number,
    definition,
  }));
  const passthroughColumns = fileColumns.filter((c) => c.schema === null).map((c) => c.name);

  return { ok: true, mapping: { fileColumns, schemaColumns, passthroughColumns } };
}

function quoteAll(columns: readonly ColumnDefinition[]): string {
  return columns.map((c) => JSON.stringify(c.name)).join(', ');
}

function fail(code: 'MISSING_COLUMN' | 'DUPLICATE_COLUMN', message: string): HeaderResult {
  return { ok: false, error: { code, message } };
}
