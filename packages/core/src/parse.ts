import type { Delimiter } from './delimiter.js';

export interface ParseFailure {
  message: string;
  /** 1-based physical line where the problem was detected. */
  line: number;
}

export type ParseResult = { ok: true; records: string[][] } | { ok: false; error: ParseFailure };

const QUOTE = 34;
const LF = 10;
const CR = 13;

/** Parses RFC 4180 records in any line ending, dropping leading/trailing blank lines (FR-11, FR-14). */
export function parseRecords(text: string, delimiter: Delimiter): ParseResult {
  const delim = delimiter.charCodeAt(0);
  const n = text.length;
  const records: string[][] = [];
  let i = 0;
  let line = 1;
  let trailingBlank = 0;

  while (i < n && (text.charCodeAt(i) === LF || text.charCodeAt(i) === CR)) {
    i += text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
    line++;
  }

  while (i < n) {
    const row: string[] = [];
    const blank = text.charCodeAt(i) === LF || text.charCodeAt(i) === CR;

    for (;;) {
      let c = text.charCodeAt(i);

      if (c === QUOTE) {
        const openedOnLine = line;
        let value = '';
        let start = ++i;
        for (;;) {
          if (i >= n) return fail('Unterminated quoted field', openedOnLine);
          c = text.charCodeAt(i);
          if (c === QUOTE) {
            if (text.charCodeAt(i + 1) === QUOTE) {
              value += text.slice(start, i + 1);
              i += 2;
              start = i;
              continue;
            }
            value += text.slice(start, i);
            i++;
            break;
          }
          if (c === LF || (c === CR && text.charCodeAt(i + 1) !== LF)) line++;
          i++;
        }
        row.push(value);
        c = text.charCodeAt(i);
        if (i < n && c !== delim && c !== LF && c !== CR) {
          return fail('Unexpected character after closing quote', line);
        }
      } else {
        const start = i;
        while (i < n) {
          c = text.charCodeAt(i);
          if (c === delim || c === LF || c === CR) break;
          i++;
        }
        row.push(text.slice(start, i));
        c = text.charCodeAt(i);
      }

      if (i >= n) break;
      if (c === delim) {
        i++;
        continue;
      }
      i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
      line++;
      break;
    }

    records.push(row);
    trailingBlank = blank ? trailingBlank + 1 : 0;
  }

  records.length -= trailingBlank;
  return { ok: true, records };
}

function fail(message: string, line: number): ParseResult {
  return { ok: false, error: { message, line } };
}
