import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseRecords, type Delimiter } from '../src/index.js';

const records = (text: string, delimiter: Delimiter = ',') => {
  const result = parseRecords(text, delimiter);
  if (!result.ok) throw new Error(`unexpected parse failure: ${result.error.message}`);
  return result.records;
};

const failure = (text: string, delimiter: Delimiter = ',') => {
  const result = parseRecords(text, delimiter);
  if (result.ok) throw new Error('expected a parse failure');
  return result.error;
};

describe('parseRecords: structure', () => {
  it('parses plain records and handles empty input', () => {
    expect(records('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(records('')).toEqual([]);
    expect(records('\n\r\n')).toEqual([]);
  });

  it('does not require a final newline', () => {
    expect(records('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('honours the semicolon delimiter and keeps commas literal', () => {
    expect(records('a;b\n1,5;2', ';')).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
  });

  it('keeps a trailing empty field after a final delimiter', () => {
    expect(records('a,b,\n1,2,')).toEqual([
      ['a', 'b', ''],
      ['1', '2', ''],
    ]);
  });

  it('preserves ragged rows for the field-count check (AC-9)', () => {
    expect(records('a,b\n1\n1,2,3\n')).toEqual([['a', 'b'], ['1'], ['1', '2', '3']]);
  });

  it('preserves surrounding whitespace so pass-through values stay untouched', () => {
    expect(records('a,b\n  x ,\ty\n')[1]).toEqual(['  x ', '\ty']);
  });
});

describe('parseRecords: line endings (AC-7)', () => {
  const expected = [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ];

  it.each([
    ['LF', 'a,b\n1,2\n3,4\n'],
    ['CRLF', 'a,b\r\n1,2\r\n3,4\r\n'],
    ['CR', 'a,b\r1,2\r3,4\r'],
    ['a mix of all three', 'a,b\n1,2\r\n3,4\r'],
  ])('accepts %s', (_name, text) => {
    expect(records(text)).toEqual(expected);
  });
});

describe('parseRecords: blank lines (FR-11)', () => {
  it('ignores any number of trailing blank lines', () => {
    expect(records('a,b\n1,2\n\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(records('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips leading blank lines before the header', () => {
    expect(records('\n\r\na,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a blank line in the middle as a one-empty-field record', () => {
    expect(records('a,b\n1,2\n\n3,4\n')).toEqual([['a', 'b'], ['1', '2'], [''], ['3', '4']]);
  });

  it('does not mistake a quoted empty value for a blank line', () => {
    expect(records('a\n""\n')).toEqual([['a'], ['']]);
  });

  it('agrees with delimiter detection about where the header is', () => {
    const text = '\n\na;b;c\n1;2;3\n';
    const delimiter = detectDelimiter(text);
    expect(delimiter).toBe(';');
    expect(records(text, delimiter)[0]).toEqual(['a', 'b', 'c']);
  });
});

describe('parseRecords: quoting (AC-7)', () => {
  it('handles embedded delimiters, doubled quotes and newlines', () => {
    expect(records('a,b\n"x, ""y""","line1\nline2"\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'line1\nline2'],
    ]);
  });

  it('keeps CRLF and CR inside a quoted field verbatim', () => {
    expect(records('a\n"x\r\ny\rz"\n')[1]).toEqual(['x\r\ny\rz']);
  });

  it('round-trips awkward values through quoting', () => {
    const values = [
      'plain',
      'with,comma',
      'with "quote"',
      'multi\nline',
      '',
      ' padded ',
      '"',
      ',"\n',
    ];
    const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const text = `${values.map(quote).join(',')}\n${values.map(quote).join(',')}`;
    expect(records(text)).toEqual([values, values]);
  });

  it('treats a quote in the middle of an unquoted field as literal text', () => {
    expect(records('a,b\n5" pipe,2\n')[1]).toEqual(['5" pipe', '2']);
  });

  it('only opens a quoted field at field start (strict RFC 4180)', () => {
    expect(records('a, "b,c"')[0]).toEqual(['a', ' "b', 'c"']);
  });

  it('allows a quoted field right before the delimiter, line end and end of input', () => {
    expect(records('"a","b"\n"c","d"')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseRecords: failures (FR-14)', () => {
  it('fails on an unterminated quoted field, reporting the line it opened on', () => {
    expect(failure('a,b\n1,"never closed\nmore')).toMatchObject({
      message: 'Unterminated quoted field',
      line: 2,
    });
  });

  it('counts embedded newlines when locating a later failure', () => {
    expect(failure('a\n"x\ny\nz"q\n')).toMatchObject({
      message: 'Unexpected character after closing quote',
      line: 4,
    });
  });

  it('fails on characters after a closing quote instead of guessing', () => {
    expect(failure('a,b\n"x"y,2\n')).toMatchObject({
      message: 'Unexpected character after closing quote',
      line: 2,
    });
  });

  it('fails on a quote that never closes at the very end', () => {
    expect(failure('a,"')).toMatchObject({ line: 1 });
  });
});
