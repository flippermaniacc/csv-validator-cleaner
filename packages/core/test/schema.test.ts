import { describe, expect, it } from 'vitest';
import { validateSchemaDefinition, type SchemaIssue } from '../src/index.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';

const validate = (input: unknown) => validateSchemaDefinition(input, nativeRegexEngine);

function issuesOf(input: unknown): SchemaIssue[] {
  const result = validate(input);
  if (result.ok) throw new Error('expected the schema to be rejected');
  return result.issues;
}

/** Builds a one-column schema and returns the issues for that column. */
const columnIssues = (column: Record<string, unknown>) =>
  issuesOf({ name: 'S', columns: [{ name: 'c', ...column }] });

describe('validateSchemaDefinition: accepted definitions', () => {
  it('accepts a full definition and applies defaults', () => {
    const result = validate({
      name: '  Partner invoices ',
      columns: [
        { name: 'id', type: 'integer', required: true, unique: true, min: 1, max: 99 },
        { name: 'code', type: 'string', pattern: '[A-Z]{3}', min: 3, max: 3 },
        { name: 'currency', type: 'string', enum: ['USD', 'EUR'] },
        { name: 'rate', type: 'decimal', min: 0.5, enum: [1.5, 2] },
        {
          name: 'issued',
          type: 'date',
          dateFormat: 'DD.MM.YYYY',
          min: '2020-01-01',
          max: '2030-12-31',
        },
        { name: 'paid', type: 'boolean' },
        { name: 'contact', type: 'email', max: 254 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.name).toBe('Partner invoices');
    expect(result.schema.columns[5]).toEqual({
      name: 'paid',
      type: 'boolean',
      required: false,
      unique: false,
    });
  });

  it('keeps column order', () => {
    const result = validate({
      name: 'S',
      columns: [
        { name: 'b', type: 'string' },
        { name: 'a', type: 'string' },
      ],
    });
    expect(result.ok && result.schema.columns.map((c) => c.name)).toEqual(['b', 'a']);
  });

  it('treats column names as case-sensitive and trims them', () => {
    const result = validate({
      name: 'S',
      columns: [
        { name: ' Id ', type: 'string' },
        { name: 'id', type: 'string' },
      ],
    });
    expect(result.ok && result.schema.columns.map((c) => c.name)).toEqual(['Id', 'id']);
  });

  it('accepts min equal to max', () => {
    const result = validate({
      name: 'S',
      columns: [{ name: 'n', type: 'integer', min: 5, max: 5 }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateSchemaDefinition: structural rejections', () => {
  it('rejects non-objects', () => {
    for (const input of [null, undefined, 42, 'x', []]) {
      expect(validate(input).ok).toBe(false);
    }
  });

  it('rejects an empty or too-long schema name', () => {
    expect(issuesOf({ name: '   ', columns: [{ name: 'a', type: 'string' }] })[0]?.property).toBe(
      'name',
    );
    const tooLong = issuesOf({ name: 'x'.repeat(101), columns: [{ name: 'a', type: 'string' }] });
    expect(tooLong[0]).toMatchObject({ property: 'name', column: null });
  });

  it('accepts a 100-character schema name', () => {
    expect(validate({ name: 'x'.repeat(100), columns: [{ name: 'a', type: 'string' }] }).ok).toBe(
      true,
    );
  });

  it('rejects a schema without columns', () => {
    expect(issuesOf({ name: 'S', columns: [] })[0]).toMatchObject({
      property: 'columns',
      column: null,
    });
  });

  it('rejects duplicate column names, naming the second one', () => {
    const issues = issuesOf({
      name: 'S',
      columns: [
        { name: 'a', type: 'string' },
        { name: 'a ', type: 'integer' },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['columns', 1, 'name'],
      column: 'a',
      property: 'name',
    });
  });

  it('rejects an empty column name and an unknown type', () => {
    expect(columnIssues({ name: '  ', type: 'string' })[0]?.property).toBe('name');
    expect(columnIssues({ type: 'float' })[0]?.property).toBe('type');
  });

  it('rejects unknown properties so typos are not silently ignored', () => {
    const issues = columnIssues({ type: 'string', requried: true });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.column).toBe('c');
  });
});

describe('validateSchemaDefinition: min / max', () => {
  it('rejects min greater than max for numbers and dates (AC-2)', () => {
    expect(columnIssues({ type: 'integer', min: 10, max: 5 })[0]).toMatchObject({
      column: 'c',
      property: 'min',
    });
    expect(columnIssues({ type: 'date', min: '2024-02-01', max: '2024-01-01' })[0]?.property).toBe(
      'min',
    );
    expect(columnIssues({ type: 'string', min: 5, max: 2 })[0]?.property).toBe('min');
  });

  it('requires integers for integer columns and any finite number for decimal', () => {
    expect(columnIssues({ type: 'integer', min: 0.5 })[0]?.property).toBe('min');
    expect(validate({ name: 'S', columns: [{ name: 'c', type: 'decimal', min: 0.5 }] }).ok).toBe(
      true,
    );
    expect(columnIssues({ type: 'decimal', max: '5' })[0]?.property).toBe('max');
  });

  it('requires non-negative integer lengths for string and email columns', () => {
    for (const type of ['string', 'email']) {
      expect(columnIssues({ type, min: -1 })[0]?.property).toBe('min');
      expect(columnIssues({ type, max: 1.5 })[0]?.property).toBe('max');
      expect(columnIssues({ type, max: '5' })[0]?.property).toBe('max');
    }
  });

  it('requires real calendar dates in YYYY-MM-DD for date columns', () => {
    for (const bad of ['2024-02-30', '01.02.2024', '2024-2-1', 5]) {
      expect(columnIssues({ type: 'date', min: bad })[0]?.property).toBe('min');
    }
    expect(
      validate({ name: 'S', columns: [{ name: 'c', type: 'date', min: '2024-02-29' }] }).ok,
    ).toBe(true);
  });

  it('rejects min/max on boolean columns', () => {
    expect(columnIssues({ type: 'boolean', min: 0 })[0]?.property).toBe('min');
  });
});

describe('validateSchemaDefinition: enum', () => {
  it('rejects an empty enum', () => {
    expect(columnIssues({ type: 'string', enum: [] })[0]?.property).toBe('enum');
  });

  it('rejects enum on unsupported types', () => {
    for (const type of ['date', 'boolean', 'email']) {
      expect(columnIssues({ type, enum: ['x'] })[0]?.property).toBe('enum');
    }
  });

  it('requires entries matching the column type', () => {
    expect(columnIssues({ type: 'string', enum: [1] })[0]?.property).toBe('enum');
    expect(columnIssues({ type: 'integer', enum: ['1'] })[0]?.property).toBe('enum');
    expect(columnIssues({ type: 'integer', enum: [1.5] })[0]?.property).toBe('enum');
  });

  it('rejects string entries that could never match a trimmed cell', () => {
    expect(columnIssues({ type: 'string', enum: [' USD'] })[0]?.property).toBe('enum');
    expect(columnIssues({ type: 'string', enum: [''] })[0]?.property).toBe('enum');
  });

  it('rejects duplicate entries', () => {
    expect(columnIssues({ type: 'string', enum: ['A', 'A'] })[0]?.property).toBe('enum');
    expect(columnIssues({ type: 'integer', enum: [1, 2, 1] })[0]?.property).toBe('enum');
  });
});

describe('validateSchemaDefinition: dateFormat', () => {
  it('rejects dateFormat on a non-date column (AC-2)', () => {
    expect(columnIssues({ type: 'integer', dateFormat: 'DD.MM.YYYY' })[0]).toMatchObject({
      column: 'c',
      property: 'dateFormat',
    });
  });

  it('rejects unsupported date formats', () => {
    expect(columnIssues({ type: 'date', dateFormat: 'YYYY/MM/DD' })[0]?.property).toBe(
      'dateFormat',
    );
  });

  it.each(['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'])('accepts %s', (dateFormat) => {
    expect(validate({ name: 'S', columns: [{ name: 'c', type: 'date', dateFormat }] }).ok).toBe(
      true,
    );
  });
});

describe('validateSchemaDefinition: pattern', () => {
  it('rejects a pattern on non-text columns', () => {
    expect(columnIssues({ type: 'integer', pattern: '\\d+' })[0]?.property).toBe('pattern');
  });

  it('rejects a pattern longer than 500 characters but accepts exactly 500', () => {
    expect(columnIssues({ type: 'string', pattern: 'a'.repeat(501) })[0]?.property).toBe('pattern');
    expect(
      validate({ name: 'S', columns: [{ name: 'c', type: 'string', pattern: 'a'.repeat(500) }] })
        .ok,
    ).toBe(true);
  });

  it.each([
    ['^(?!0)\\d+$', 'lookahead'],
    ['(?<=x)y', 'lookbehind'],
    ['(a)\\1', 'backreference'],
  ])('rejects %s naming the %s (AC-15a)', (pattern, construct) => {
    const issue = columnIssues({ type: 'string', pattern })[0];
    expect(issue).toMatchObject({ column: 'c', property: 'pattern' });
    expect(issue?.message).toContain(construct);
  });

  it('rejects patterns that do not compile, including unbalanced ones the wrapper would absorb', () => {
    for (const pattern of ['(', '[a-', 'a)(b', ')|(']) {
      expect(columnIssues({ type: 'string', pattern })[0]?.property).toBe('pattern');
    }
  });

  it('reports the offending column among several', () => {
    const issues = issuesOf({
      name: 'S',
      columns: [
        { name: 'ok', type: 'string', pattern: 'a+' },
        { name: 'bad', type: 'email', pattern: '(?=x)' },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['columns', 1, 'pattern'], column: 'bad' });
  });

  it('accepts alternation, which full-match wrapping must keep working', () => {
    expect(
      validate({ name: 'S', columns: [{ name: 'c', type: 'string', pattern: 'a|b' }] }).ok,
    ).toBe(true);
  });
});
