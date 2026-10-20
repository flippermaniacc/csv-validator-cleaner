export type Delimiter = ',' | ';';

/**
 * Picks the delimiter from the header line (FR-10): the more frequent of
 * unquoted `,` and `;`, with ties (including none) resolving to `,`.
 *
 * The header may span several physical lines when a quoted field contains a
 * newline, so the scan tracks quote state. A `"` only opens a quoted field at
 * the start of a field (RFC 4180); elsewhere it is literal text, so a stray
 * quote in an unquoted header cannot hide the real delimiters. Leading empty
 * lines are skipped, matching how the parser finds the header row.
 */
export function detectDelimiter(text: string): Delimiter {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  let atFieldStart = true;
  let sawContent = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      if (sawContent) break;
      continue;
    }

    sawContent = true;
    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === ',' || ch === ';') {
      if (ch === ',') commas++;
      else semicolons++;
      atFieldStart = true;
    } else if (ch !== ' ' && ch !== '\t') {
      atFieldStart = false;
    }
  }

  return semicolons > commas ? ';' : ',';
}
