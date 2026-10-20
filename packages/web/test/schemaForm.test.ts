import { describe, expect, it } from 'vitest';
import type { SchemaIssue } from '@csv-validator/core';
import {
  COLUMN_TYPES,
  DATE_FORMATS,
  emptyColumn,
  emptyForm,
  fromResource,
  groupIssues,
  toDraft,
  type ColumnForm,
  type SchemaForm,
} from '../src/schemaForm';
import { schemaResource } from './helpers';

const form = (...columns: Partial<ColumnForm>[]): SchemaForm => ({
  name: 'S',
  columns: columns.map((c, i) => ({ ...emptyColumn(i + 1), name: `c${i}`, ...c })),
});
const columnOf = (partial: Partial<ColumnForm>) => toDraft(form(partial)).columns[0]!;

describe('type tables', () => {
  it('cover every column type and date format', () => {
    expect(COLUMN_TYPES).toEqual(['string', 'integer', 'decimal', 'date', 'boolean', 'email']);
    expect(DATE_FORMATS).toEqual(['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']);
  });
});

describe('toDraft', () => {
  it('sends only name, type and flags for a bare column', () => {
    expect(columnOf({ type: 'string' })).toEqual({
      name: 'c0',
      type: 'string',
      required: false,
      unique: false,
    });
  });

  it('keeps the schema name and the column order', () => {
    const draft = toDraft({ ...form({ name: 'b' }, { name: 'a' }), name: ' Spaced ' });
    expect(draft.name).toBe(' Spaced ');
    expect(draft.columns.map((c) => c.name)).toEqual(['b', 'a']);
  });

  it('converts numeric bounds for integer and decimal columns', () => {
    expect(columnOf({ type: 'integer', min: '1', max: '10' })).toMatchObject({ min: 1, max: 10 });
    expect(columnOf({ type: 'decimal', min: '-0.5', max: '2.25' })).toMatchObject({
      min: -0.5,
      max: 2.25,
    });
  });

  it('converts length bounds for string and email columns', () => {
    expect(columnOf({ type: 'string', min: '3', max: '9' })).toMatchObject({ min: 3, max: 9 });
    expect(columnOf({ type: 'email', max: '254' })).toMatchObject({ max: 254 });
  });

  it('keeps date bounds as text', () => {
    expect(columnOf({ type: 'date', min: '2024-01-01', max: '2024-12-31' })).toMatchObject({
      min: '2024-01-01',
      max: '2024-12-31',
    });
  });

  it('sends unparseable numbers as typed so the server can reject them', () => {
    expect(columnOf({ type: 'integer', min: 'abc' })).toMatchObject({ min: 'abc' });
    expect(columnOf({ type: 'integer', enumText: '1\nabc' })).toMatchObject({ enum: [1, 'abc'] });
  });

  it('omits empty optional fields', () => {
    const column = columnOf({ type: 'integer', min: '', max: '', enumText: '\n\n' });
    expect(column).not.toHaveProperty('min');
    expect(column).not.toHaveProperty('max');
    expect(column).not.toHaveProperty('enum');
  });

  it('parses enum lines per type without trimming strings', () => {
    expect(columnOf({ type: 'string', enumText: 'USD\r\nEUR\n GBP' })).toMatchObject({
      enum: ['USD', 'EUR', ' GBP'],
    });
    expect(columnOf({ type: 'decimal', enumText: '1.5\n2' })).toMatchObject({ enum: [1.5, 2] });
  });

  it('sends pattern only for text types and dateFormat only for dates', () => {
    expect(columnOf({ type: 'string', pattern: '[A-Z]+' })).toMatchObject({ pattern: '[A-Z]+' });
    expect(columnOf({ type: 'email', pattern: '.+@.+' })).toMatchObject({ pattern: '.+@.+' });
    expect(columnOf({ type: 'date', dateFormat: 'DD.MM.YYYY' })).toMatchObject({
      dateFormat: 'DD.MM.YYYY',
    });
    expect(columnOf({ type: 'date', dateFormat: '' })).not.toHaveProperty('dateFormat');
  });

  it('drops fields that the chosen type does not support, even if they hold text', () => {
    const stale = {
      pattern: 'x',
      min: '1',
      max: '2',
      enumText: 'a',
      dateFormat: 'DD.MM.YYYY' as const,
    };
    for (const type of ['boolean'] as const) {
      expect(Object.keys(columnOf({ type, ...stale })).sort()).toEqual([
        'name',
        'required',
        'type',
        'unique',
      ]);
    }
    expect(columnOf({ type: 'integer', ...stale })).not.toHaveProperty('pattern');
    expect(columnOf({ type: 'integer', ...stale })).not.toHaveProperty('dateFormat');
    expect(columnOf({ type: 'date', ...stale })).not.toHaveProperty('enum');
    expect(columnOf({ type: 'email', ...stale })).not.toHaveProperty('enum');
  });
});

describe('fromResource', () => {
  it('round-trips a stored schema into form text and back', () => {
    const resource = schemaResource();
    const loaded = fromResource(resource);
    expect(loaded.name).toBe('Invoices');
    expect(loaded.columns[0]).toMatchObject({
      name: 'id',
      type: 'integer',
      required: true,
      min: '1',
    });
    expect(loaded.columns[1]).toMatchObject({ type: 'date', dateFormat: 'DD.MM.YYYY' });
    expect(loaded.columns[2]).toMatchObject({ enumText: 'USD\nEUR' });
    expect(toDraft(loaded)).toEqual({
      name: 'Invoices',
      columns: resource.columns,
    });
  });

  it('assigns unique keys and starts new forms with one column', () => {
    expect(new Set(fromResource(schemaResource()).columns.map((c) => c.key)).size).toBe(3);
    expect(emptyForm().columns).toHaveLength(1);
  });
});

describe('groupIssues', () => {
  const issue = (path: (string | number)[], message: string): SchemaIssue => ({
    path,
    column: null,
    property: null,
    message,
  });

  it('places issues by column index and property', () => {
    const grouped = groupIssues([
      issue(['columns', 1, 'min'], 'min too big'),
      issue(['columns', 1, 'min'], 'again'),
      issue(['columns', 0, 'pattern'], 'bad pattern'),
      issue(['columns', 2], 'unknown key'),
    ]);
    expect(grouped.columns.get(1)).toEqual({ min: ['min too big', 'again'] });
    expect(grouped.columns.get(0)).toEqual({ pattern: ['bad pattern'] });
    expect(grouped.columns.get(2)).toEqual({ '': ['unknown key'] });
  });

  it('places schema-level issues by property and keeps the rest', () => {
    const grouped = groupIssues([
      issue(['name'], 'name empty'),
      issue(['columns'], 'need a column'),
      issue([], 'weird'),
    ]);
    expect(grouped.schema).toEqual({ name: ['name empty'], columns: ['need a column'] });
    expect(grouped.other).toEqual(['weird']);
    expect(grouped.columns.size).toBe(0);
  });

  it('is empty without issues', () => {
    expect(groupIssues([])).toEqual({ schema: {}, columns: new Map(), other: [] });
  });
});
