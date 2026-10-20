import type { ColumnType } from './schema/definition.js';

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@']);
const NEEDS_QUOTES = /[",\r\n]/;
// A `;` in the header could win delimiter detection when the cleaned file is re-uploaded (FR-10).
const HEADER_NEEDS_QUOTES = /[",;\r\n]/;
const encoder = new TextEncoder();

/** One output column in file order; `type` is null for pass-through columns. */
export interface OutputColumn {
  name: string;
  type: ColumnType | null;
}

export interface CleanedCsv {
  bytes: Uint8Array;
  sanitizedCells: number;
}

/** Prefixes `'` so Excel treats a leading `=`, `+`, `-` or `@` as text, not a formula (FR-21). */
export function sanitizeFormula(value: string): string {
  return FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
}

/**
 * Writes the cleaned CSV: UTF-8, no BOM, `,`, `\n`, quoting only when needed (FR-20).
 * Numeric columns are exempt from sanitization so `-7` stays `-7` (FR-21); pass-through headers are sanitized too.
 */
export function serializeCleaned(
  columns: readonly OutputColumn[],
  rows: readonly string[][],
): CleanedCsv {
  const sanitizable = columns.map(
    (c) => c.type === null || c.type === 'string' || c.type === 'email',
  );
  // A lone empty field would be a blank line, which readers drop at end of file.
  const quoteEmpty = columns.length === 1;
  let sanitizedCells = 0;

  const emit = (value: string, index: number, header: boolean): string => {
    let text = value;
    const passThroughHeader = header && columns[index]?.type === null;
    if ((sanitizable[index] && !header) || passThroughHeader) {
      const safe = sanitizeFormula(text);
      if (safe !== text) sanitizedCells++;
      text = safe;
    }
    if (text === '') return quoteEmpty ? '""' : '';
    return (header ? HEADER_NEEDS_QUOTES : NEEDS_QUOTES).test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  };

  const lines = [columns.map((c, i) => emit(c.name, i, true)).join(',')];
  for (const row of rows) lines.push(row.map((value, i) => emit(value, i, false)).join(','));

  return { bytes: encoder.encode(`${lines.join('\n')}\n`), sanitizedCells };
}
