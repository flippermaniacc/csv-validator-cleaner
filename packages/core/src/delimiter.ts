export type Delimiter = ',' | ';';

/** Picks the more frequent unquoted `,` or `;` in the header line, ties to `,` (FR-10). */
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
    } else {
      atFieldStart = false;
    }
  }

  return semicolons > commas ? ';' : ',';
}
