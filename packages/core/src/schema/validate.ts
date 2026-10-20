import { ZodError } from 'zod';
import { compileFullMatch, RegexCompileError, type RegexEngine } from '../regex.js';
import { SchemaDefinitionSchema, type SchemaDefinition } from './definition.js';

/** One problem with a schema definition, locating the offending column and property (FR-4). */
export interface SchemaIssue {
  /** Path into the submitted document, e.g. `['columns', 2, 'min']`. */
  path: (string | number)[];
  /** Name of the offending column, or null for schema-level issues. */
  column: string | null;
  /** Offending column property (`min`, `pattern`, ...) or `name`/`columns`; null if not applicable. */
  property: string | null;
  message: string;
}

export type SchemaValidationResult =
  { ok: true; schema: SchemaDefinition } | { ok: false; issues: SchemaIssue[] };

/**
 * Validates an untrusted schema document: structure and cross-field rules
 * (Zod), then pattern compilation through the injected regex engine.
 */
export function validateSchemaDefinition(
  input: unknown,
  regex: RegexEngine,
): SchemaValidationResult {
  const parsed = SchemaDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => toIssue(i, input)) };
  }

  const schema = parsed.data;
  const issues: SchemaIssue[] = [];
  schema.columns.forEach((column, index) => {
    if (column.pattern === undefined) return;
    try {
      compileFullMatch(regex, column.pattern);
    } catch (error) {
      if (!(error instanceof RegexCompileError)) throw error;
      const construct = error.construct ? ` (${error.construct} is not supported)` : '';
      issues.push({
        path: ['columns', index, 'pattern'],
        column: column.name,
        property: 'pattern',
        message: `Invalid pattern${construct}: ${error.message}`,
      });
    }
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, schema };
}

function toIssue(issue: ZodError['issues'][number], input: unknown): SchemaIssue {
  const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
  const isColumnIssue = path[0] === 'columns' && typeof path[1] === 'number';
  const property = isColumnIssue
    ? typeof path[2] === 'string'
      ? path[2]
      : null
    : toTopProperty(path);
  return {
    path,
    column: isColumnIssue ? columnName(input, path[1] as number) : null,
    property,
    message: issue.message,
  };
}

function toTopProperty(path: (string | number)[]): string | null {
  return typeof path[0] === 'string' ? path[0] : null;
}

function columnName(input: unknown, index: number): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const columns = (input as { columns?: unknown }).columns;
  if (!Array.isArray(columns)) return null;
  const column: unknown = columns[index];
  if (typeof column !== 'object' || column === null) return null;
  const name = (column as { name?: unknown }).name;
  return typeof name === 'string' ? name.trim() : null;
}
