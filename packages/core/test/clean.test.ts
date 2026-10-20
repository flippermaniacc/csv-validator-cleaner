import { describe, expect, it } from 'vitest';
import {
  parseRecords,
  processCsv,
  sanitizeFormula,
  serializeCleaned,
  type DetectedEncoding,
  type OutputColumn,
} from '../src/index.js';
import { encodeText } from './helpers/encode.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';
import { makeSchema } from './helpers/schema.js';

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const cols = (...types: (OutputColumn['type'] | 'pass')[]): OutputColumn[] =>
  types.map((type, i) => ({ name: `c${i}`, type: type === 'pass' ? null : type }));

function clean(csv: string | Uint8Array, columns: Record<string, unknown>[]) {
  const result = processCsv({
    bytes: typeof csv === 'string' ? Buffer.from(csv, 'utf8') : csv,
    schema: makeSchema(columns),
    regex: nativeRegexEngine,
  });
  if (result.status !== 'completed') throw new Error(result.fileError.message);
  return result;
}

describe('sanitizeFormula (FR-21)', () => {
  it.each(['=1+1', '+1', '-1', '@x'])('prefixes %s', (value) => {
    expect(sanitizeFormula(value)).toBe(`'${value}`);
  });

  it('leaves everything else alone, including already-prefixed and empty values', () => {
    for (const value of ['', 'abc', "'=x", ' =x', 'a=b', '1-2']) {
      expect(sanitizeFormula(value)).toBe(value);
    }
  });
});

describe('serializeCleaned: format (AC-25)', () => {
  it('writes UTF-8 without BOM, LF endings and a final newline', () => {
    const { bytes } = serializeCleaned(cols('string', 'string'), [['a', 'é😀']]);
    expect(Array.from(bytes.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(text(bytes)).toBe('c0,c1\na,é😀\n');
    expect(text(bytes)).not.toContain('\r');
  });

  it('quotes only fields containing a comma, quote, CR or LF', () => {
    const rows = [
      ['a,b', 'say "x"', 'two\nlines'],
      ['cr\rhere', ' spaced ', 'semi;colon'],
    ];
    const out = text(serializeCleaned(cols('string', 'string', 'string'), rows).bytes);
    expect(out).toBe('c0,c1,c2\n"a,b","say ""x""","two\nlines"\n"cr\rhere", spaced ,semi;colon\n');
  });

  it('writes a header-only file when there are no rows', () => {
    expect(text(serializeCleaned(cols('string', 'integer'), []).bytes)).toBe('c0,c1\n');
  });

  it('quotes empty values in a single-column file so rows survive re-reading', () => {
    const out = text(serializeCleaned(cols('string'), [[''], ['x'], ['']]).bytes);
    expect(out).toBe('c0\n""\nx\n""\n');
    const reread = parseRecords(out, ',');
    expect(reread.ok && reread.records).toEqual([['c0'], [''], ['x'], ['']]);
  });

  it('leaves empty values unquoted in multi-column files', () => {
    expect(text(serializeCleaned(cols('string', 'string'), [['', '']]).bytes)).toBe('c0,c1\n,\n');
  });

  it('quotes a header containing a semicolon so delimiter detection stays on the comma', () => {
    const columns: OutputColumn[] = [
      { name: 'id', type: 'integer' },
      { name: 'a;b;c', type: null },
    ];
    expect(text(serializeCleaned(columns, [['1', 'x']]).bytes)).toBe('id,"a;b;c"\n1,x\n');
  });
});

describe('serializeCleaned: sanitization (AC-24)', () => {
  const cell = (type: OutputColumn['type'] | 'pass', value: string) =>
    text(serializeCleaned(cols(type), [[value]]).bytes).split('\n')[1];

  it.each(['string', 'email', 'pass'] as const)('prefixes risky %s cells', (type) => {
    for (const value of ['=1+1', '+x', '-y', '@z']) expect(cell(type, value)).toBe(`'${value}`);
  });

  it.each(['integer', 'decimal'] as const)('keeps %s cells intact so -7 stays -7', (type) => {
    expect(cell(type, '-7')).toBe('-7');
    expect(cell(type, '+3')).toBe('+3');
  });

  it('counts only the cells it changed', () => {
    const columns = cols('string', 'integer', 'pass');
    const rows = [
      ['=a', '-1', '+b'],
      ['ok', '-2', "'already"],
      ['@c', '3', ''],
    ];
    expect(serializeCleaned(columns, rows).sanitizedCells).toBe(3);
  });

  it('sanitizes pass-through headers but never schema column headers', () => {
    const columns: OutputColumn[] = [
      { name: '-delta', type: 'integer' },
      { name: '=memo', type: null },
      { name: '+name', type: 'string' },
    ];
    const { bytes, sanitizedCells } = serializeCleaned(columns, []);
    expect(text(bytes)).toBe("-delta,'=memo,+name\n");
    expect(sanitizedCells).toBe(1);
  });
});

describe('processCsv: cleaning behavior', () => {
  it('trims schema values and normalizes dates to ISO (AC-21, AC-19)', () => {
    const result = clean('id,when\n  Alice  ,01.03.2024\nBob,2024-03-02\n', [
      { name: 'id', type: 'string' },
      { name: 'when', type: 'date', dateFormat: 'DD.MM.YYYY' },
    ]);
    expect(text(result.cleaned)).toBe('id,when\nAlice,2024-03-01\nBob,2024-03-02\n');
  });

  it('keeps only valid rows, in original order (AC-22)', () => {
    const result = clean('n\n3\nx\n1\n2\n1\n', [{ name: 'n', type: 'integer', unique: true }]);
    expect(text(result.cleaned)).toBe('n\n3\n1\n2\n');
    expect(result.report).toMatchObject({ totalRows: 5, validRows: 3, duplicateRowsDropped: 1 });
  });

  it('emits only the header when every row is invalid (AC-23)', () => {
    const result = clean('n\nx\ny\n', [{ name: 'n', type: 'integer' }]);
    expect(text(result.cleaned)).toBe('n\n');
    expect(result.report.validRows).toBe(0);
  });

  it('keeps all 25 columns of the original in order, pass-through untouched (AC-21a)', () => {
    const header = Array.from({ length: 25 }, (_, i) => `col${i}`);
    const row = header.map((_, i) => ` v${i} `);
    const input = `${header.join(',')}\n${row.join(',')}\n`;
    const result = clean(input, [
      { name: 'col3', type: 'string' },
      { name: 'col10', type: 'string' },
      { name: 'col24', type: 'string' },
    ]);
    const out = parseRecords(text(result.cleaned), ',');
    if (!out.ok) throw new Error('unparseable output');
    expect(out.records[0]).toEqual(header);
    const cleanedRow = out.records[1] as string[];
    cleanedRow.forEach((value, i) => {
      expect(value).toBe([3, 10, 24].includes(i) ? `v${i}` : ` v${i} `);
    });
    expect(result.report.passthroughColumns).toHaveLength(22);
  });

  it('reports sanitizedCells (AC-24)', () => {
    const result = clean('name,qty\n=a,-1\n+b,2\n', [
      { name: 'name', type: 'string' },
      { name: 'qty', type: 'integer' },
    ]);
    expect(text(result.cleaned)).toBe("name,qty\n'=a,-1\n'+b,2\n");
    expect(result.report.sanitizedCells).toBe(2);
  });
});

describe('processCsv: encodings produce the same output (AC-5)', () => {
  const logical = 'id;name\n1;Привет\n2;Ёлка\n';
  const columns = [
    { name: 'id', type: 'integer' },
    { name: 'name', type: 'string' },
  ];

  it('cleans identical text from UTF-8, UTF-8 BOM, UTF-16 LE/BE and windows-1251', () => {
    const variants: [DetectedEncoding, boolean][] = [
      ['utf-8', false],
      ['utf-8', true],
      ['utf-16le', false],
      ['utf-16be', false],
      ['windows-1251', false],
    ];
    const results = variants.map(([encoding, bom]) =>
      clean(encodeText(logical, encoding, bom), columns),
    );
    const [first] = results;
    for (const result of results) expect(text(result.cleaned)).toBe(text(first!.cleaned));
    expect(text(first!.cleaned)).toBe('id,name\n1,Привет\n2,Ёлка\n');
    expect(results.map((r) => r.report.detectedEncoding)).toEqual([
      'utf-8',
      'utf-8',
      'utf-16le',
      'utf-16be',
      'windows-1251',
    ]);
  });
});

describe('processCsv: determinism and idempotence (AC-26, AC-27)', () => {
  const columns = [
    { name: 'id', type: 'integer', unique: true },
    { name: 'when', type: 'date', dateFormat: 'DD.MM.YYYY' },
    { name: 'name', type: 'string' },
  ];
  const input =
    'id,when,name,memo\n1,01.03.2024, =x ,keep\n2,31.04.2024,b,\n3,2024-03-03,c,"a,b"\n';

  it('gives byte-identical output and equal reports whatever the time zone (AC-26)', () => {
    const original = process.env['TZ'];
    try {
      const outputs = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'].map((tz) => {
        process.env['TZ'] = tz;
        return clean(input, columns);
      });
      for (const out of outputs) {
        expect(Buffer.from(out.cleaned).equals(Buffer.from(outputs[0]!.cleaned))).toBe(true);
        expect(out.report).toEqual(outputs[0]!.report);
      }
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
  });

  it('revalidates its own output with zero errors and reproduces it (AC-27)', () => {
    const first = clean(input, columns);
    const second = clean(first.cleaned, columns);
    expect(second.report.totalErrors).toBe(0);
    expect(second.report.sanitizedCells).toBe(0);
    expect(Buffer.from(second.cleaned).equals(Buffer.from(first.cleaned))).toBe(true);
  });
});

describe('processCsv: failures pass through', () => {
  it('returns file-level failures unchanged', () => {
    const result = processCsv({
      bytes: Buffer.from('x\n1\n'),
      schema: makeSchema([{ name: 'id', type: 'integer' }]),
      regex: nativeRegexEngine,
    });
    expect(result).toMatchObject({ status: 'failed', fileError: { code: 'MISSING_COLUMN' } });
    expect('cleaned' in result).toBe(false);
  });
});
