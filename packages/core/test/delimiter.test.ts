import { describe, expect, it } from 'vitest';
import { detectDelimiter } from '../src/index.js';

describe('detectDelimiter (AC-6)', () => {
  it.each([
    ['id,name,date', ','],
    ['id;name;date', ';'],
    ['id,name;date,x', ','],
    ['id;name;date,x', ';'],
  ])('picks the more frequent delimiter in %j', (header, expected) => {
    expect(detectDelimiter(`${header}\n1,2,3`)).toBe(expected);
  });

  it('defaults to a comma for a single-column header', () => {
    expect(detectDelimiter('id\n1\n2\n')).toBe(',');
    expect(detectDelimiter('id')).toBe(',');
  });

  it('defaults to a comma on a tie', () => {
    expect(detectDelimiter('a,b;c\n')).toBe(',');
    expect(detectDelimiter('a;b,c\n')).toBe(',');
  });

  it('defaults to a comma for empty input', () => {
    expect(detectDelimiter('')).toBe(',');
    expect(detectDelimiter('\n\n')).toBe(',');
  });

  it('ignores delimiters inside quoted header fields', () => {
    expect(detectDelimiter('"a;b;c",d\n')).toBe(',');
    expect(detectDelimiter('"a,b,c";d\n')).toBe(';');
    expect(detectDelimiter('"he said ""hi;""";x;y\n')).toBe(';');
  });

  it('keeps scanning when a quoted header field contains a newline', () => {
    expect(detectDelimiter('"a\nb;c",d,e\n1;2;3;4')).toBe(',');
  });

  it('only looks at the header line', () => {
    expect(detectDelimiter('a,b\nc;d;e;f;g\n')).toBe(',');
    expect(detectDelimiter('a;b\r\nc,d,e,f\r\n')).toBe(';');
    expect(detectDelimiter('a;b\rc,d,e,f\r')).toBe(';');
  });

  it('skips leading empty lines to find the header', () => {
    expect(detectDelimiter('\n\r\na;b;c\n1,2,3')).toBe(';');
  });

  it('treats a quote in the middle of an unquoted field as literal text', () => {
    // A naive quote toggle would swallow the semicolons here.
    expect(detectDelimiter('ab"c;d;e,f\n')).toBe(';');
  });

  it('opens a quoted field only at field start, like the parser (AC-7)', () => {
    // Lenient quote detection would hide the commas here and pick ';'.
    expect(detectDelimiter('a;b, "c,d,e";f;g\n')).toBe(',');
  });
});
