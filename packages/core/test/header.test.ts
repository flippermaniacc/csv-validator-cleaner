import { describe, expect, it } from 'vitest';
import { mapHeader, validateSchemaDefinition, type SchemaDefinition } from '../src/index.js';
import { nativeRegexEngine } from './helpers/native-regex-engine.js';

function schemaOf(...names: string[]): SchemaDefinition {
  const result = validateSchemaDefinition(
    { name: 'S', columns: names.map((name) => ({ name, type: 'string' })) },
    nativeRegexEngine,
  );
  if (!result.ok) throw new Error('bad test schema');
  return result.schema;
}

describe('mapHeader (AC-8)', () => {
  it('fails with MISSING_COLUMN, listing every absent schema column', () => {
    const result = mapHeader(['id', 'name'], schemaOf('id', 'email', 'name', 'phone'));
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'MISSING_COLUMN',
        message: 'Header is missing schema columns: "email", "phone"',
      },
    });
  });

  it('keeps extra columns as pass-through, in file order', () => {
    const result = mapHeader(['id', 'notes', 'email', 'extra'], schemaOf('id', 'email'));
    expect(result.ok && result.mapping.passthroughColumns).toEqual(['notes', 'extra']);
  });

  it('binds schema columns by file position, in schema order', () => {
    const result = mapHeader(['email', 'x', 'id'], schemaOf('id', 'email'));
    if (!result.ok) throw new Error('expected success');
    expect(result.mapping.schemaColumns.map((c) => [c.definition.name, c.index])).toEqual([
      ['id', 2],
      ['email', 0],
    ]);
  });

  it('lists every file column in file order, tagged by schema membership', () => {
    const result = mapHeader(['email', 'x', 'id'], schemaOf('id', 'email'));
    if (!result.ok) throw new Error('expected success');
    expect(
      result.mapping.fileColumns.map((c) => [c.index, c.name, c.schema?.name ?? null]),
    ).toEqual([
      [0, 'email', 'email'],
      [1, 'x', null],
      [2, 'id', 'id'],
    ]);
  });

  it('maps 3 schema columns inside a 25-column file', () => {
    const header = Array.from({ length: 25 }, (_, i) => `col${i}`);
    const result = mapHeader(header, schemaOf('col3', 'col10', 'col24'));
    if (!result.ok) throw new Error('expected success');
    expect(result.mapping.fileColumns).toHaveLength(25);
    expect(result.mapping.passthroughColumns).toHaveLength(22);
    expect(result.mapping.schemaColumns.map((c) => c.index)).toEqual([3, 10, 24]);
  });

  it('matches names exactly after trimming, case-sensitively', () => {
    expect(mapHeader([' id ', '\temail'], schemaOf('id', 'email')).ok).toBe(true);
    const result = mapHeader(['ID', 'email'], schemaOf('id', 'email'));
    expect(result.ok === false && result.error.code).toBe('MISSING_COLUMN');
  });

  it('emits trimmed header names', () => {
    const result = mapHeader([' id ', ' notes '], schemaOf('id'));
    expect(result.ok && result.mapping.fileColumns.map((c) => c.name)).toEqual(['id', 'notes']);
  });

  it('fails with DUPLICATE_COLUMN when a schema column appears twice', () => {
    const result = mapHeader(['id', 'email', ' id'], schemaOf('id', 'email'));
    expect(result).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_COLUMN', message: 'Header repeats schema columns: "id"' },
    });
  });

  it('allows duplicated and empty pass-through headers', () => {
    const result = mapHeader(['id', 'tag', 'tag', ''], schemaOf('id'));
    expect(result.ok && result.mapping.passthroughColumns).toEqual(['tag', 'tag', '']);
  });

  it('reports MISSING_COLUMN before DUPLICATE_COLUMN when both apply', () => {
    const result = mapHeader(['id', 'id'], schemaOf('id', 'email'));
    expect(result.ok === false && result.error.code).toBe('MISSING_COLUMN');
  });
});
