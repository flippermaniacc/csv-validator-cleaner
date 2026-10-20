import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseRecords, processCsv, validateSchemaDefinition } from '../src/index.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';

/**
 * No pattern, enum or length bounds on strings: sanitization adds a character and
 * a collision-prone unique string column could not survive a second pass.
 */
const SCHEMA = (() => {
  const result = validateSchemaDefinition(
    {
      name: 'Props',
      columns: [
        { name: 'id', type: 'integer', unique: true },
        { name: 'price', type: 'decimal' },
        { name: 'when', type: 'date', dateFormat: 'DD.MM.YYYY' },
        { name: 'name', type: 'string' },
        { name: 'email', type: 'email' },
        { name: 'ok', type: 'boolean' },
      ],
    },
    nativeRegexEngine,
  );
  if (!result.ok) throw new Error('bad property schema');
  return result.schema;
})();

const SCHEMA_NAMES = new Set(SCHEMA.columns.map((c) => c.name));

const weirdText = fc
  .array(
    fc.constantFrom(
      'a',
      'B',
      ' ',
      '=',
      '+',
      '-',
      '@',
      ',',
      '"',
      '\n',
      '\r',
      ';',
      'é',
      '😀',
      "'",
      '\t',
    ),
    {
      maxLength: 8,
    },
  )
  .map((chars) => chars.join(''));

const cells = {
  id: fc.oneof(
    fc.integer({ min: -3, max: 6 }).map(String),
    fc.constantFrom('', ' 3 ', 'x', '1.5', '+2'),
  ),
  price: fc.oneof(
    fc
      .tuple(fc.integer({ min: -9, max: 99 }), fc.integer({ min: 0, max: 99 }))
      .map(([a, b]) => `${a}.${b}`),
    fc.constantFrom('', 'abc', ',5', ' 2 '),
  ),
  when: fc.constantFrom(
    '01.03.2024',
    '29.02.2024',
    '31.04.2024',
    '2024-03-01',
    '',
    'x',
    ' 05.06.2020 ',
  ),
  name: weirdText,
  email: fc.constantFrom('a@b.co', '=x@y.zz', '+t@y.zz', 'bad', '', ' a@b.co '),
  ok: fc.constantFrom('true', 'FALSE', '', 'yes'),
  pass: weirdText,
};

const passHeader = weirdText.filter((h) => !SCHEMA_NAMES.has(h.trim()));

/** A CSV with schema columns plus two pass-through columns, every field quoted, some rows ragged. */
const csvArb = fc
  .record({
    passA: passHeader,
    passB: passHeader,
    rows: fc.array(
      fc.record({
        id: cells.id,
        price: cells.price,
        passA: cells.pass,
        when: cells.when,
        name: cells.name,
        email: cells.email,
        ok: cells.ok,
        passB: cells.pass,
        drop: fc.option(fc.integer({ min: 0, max: 7 }), { nil: undefined }),
      }),
      { maxLength: 25 },
    ),
  })
  .map(({ passA, passB, rows }) => {
    const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const header = ['id', 'price', passA, 'when', 'name', 'email', 'ok', passB];
    const lines = [header.map(quote).join(',')];
    for (const r of rows) {
      const fields = [r.id, r.price, r.passA, r.when, r.name, r.email, r.ok, r.passB];
      if (r.drop !== undefined) fields.splice(r.drop, 1);
      lines.push(fields.map(quote).join(','));
    }
    return lines.join('\n');
  });

const run = (csv: string | Uint8Array) =>
  processCsv({
    bytes: typeof csv === 'string' ? Buffer.from(csv, 'utf8') : csv,
    schema: SCHEMA,
    regex: nativeRegexEngine,
  });

describe('processCsv properties', () => {
  it('is deterministic (AC-26)', () => {
    fc.assert(
      fc.property(csvArb, (csv) => {
        const a = run(csv);
        const b = run(csv);
        expect(a).toEqual(b);
      }),
    );
  });

  it('keeps the report invariants and emits exactly the valid rows (AC-30, AC-22)', () => {
    fc.assert(
      fc.property(csvArb, (csv) => {
        const result = run(csv);
        if (result.status !== 'completed') return;
        const { report, cleaned } = result;
        expect(report.validRows + report.invalidRows).toBe(report.totalRows);
        expect(Object.values(report.errorCountsByCode).reduce((a, b) => a + b, 0)).toBe(
          report.totalErrors,
        );
        expect(report.errors.length).toBe(Math.min(report.totalErrors, 1000));

        const reread = parseRecords(Buffer.from(cleaned).toString('utf8'), ',');
        if (!reread.ok) throw new Error('cleaned output is not parseable');
        expect(reread.records.length - 1).toBe(report.validRows);
      }),
    );
  });

  it('cleans to a fixed point that revalidates with zero errors (AC-27)', () => {
    fc.assert(
      fc.property(csvArb, (csv) => {
        const first = run(csv);
        if (first.status !== 'completed') return;
        const second = run(first.cleaned);
        if (second.status !== 'completed')
          throw new Error(`reread failed: ${second.fileError.message}`);
        expect(second.report.totalErrors).toBe(0);
        expect(second.report.sanitizedCells).toBe(0);
        expect(Buffer.from(second.cleaned).equals(Buffer.from(first.cleaned))).toBe(true);
      }),
    );
  });
});
