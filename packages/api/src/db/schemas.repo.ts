import type { SchemaDefinition } from '@csv-validator/core';
import type { Db } from './connection.js';

export interface SchemaRecord {
  id: string;
  definition: SchemaDefinition;
  createdAt: string;
  updatedAt: string;
}

export type WriteResult = { ok: true } | { ok: false; reason: 'name_taken' };

interface Row {
  id: string;
  definition: string;
  created_at: string;
  updated_at: string;
}

/** Case-insensitive uniqueness key for schema names (FR-1). */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export class SchemasRepo {
  constructor(private readonly db: Db) {}

  create(record: SchemaRecord): WriteResult {
    return this.write(() =>
      this.db
        .prepare(
          `INSERT INTO schemas (id, name, name_key, definition, created_at, updated_at)
           VALUES (@id, @name, @key, @definition, @createdAt, @updatedAt)`,
        )
        .run(toParams(record)),
    );
  }

  /** Replaces name and columns; `created_at` is preserved. Returns null when the id is unknown. */
  update(id: string, definition: SchemaDefinition, updatedAt: string): WriteResult | null {
    let found = true;
    const result = this.write(() => {
      const info = this.db
        .prepare(
          `UPDATE schemas SET name = @name, name_key = @key, definition = @definition, updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          name: definition.name,
          key: nameKey(definition.name),
          definition: JSON.stringify(definition),
          updatedAt,
        });
      found = info.changes > 0;
    });
    return found || !result.ok ? result : null;
  }

  get(id: string): SchemaRecord | null {
    const row = this.db.prepare('SELECT * FROM schemas WHERE id = ?').get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  list(): SchemaRecord[] {
    const rows = this.db.prepare('SELECT * FROM schemas ORDER BY name_key, id').all() as Row[];
    return rows.map(fromRow);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM schemas WHERE id = ?').run(id).changes > 0;
  }

  private write(statement: () => unknown): WriteResult {
    try {
      statement();
      return { ok: true };
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { ok: false, reason: 'name_taken' };
      }
      throw error;
    }
  }
}

function toParams(record: SchemaRecord) {
  return {
    id: record.id,
    name: record.definition.name,
    key: nameKey(record.definition.name),
    definition: JSON.stringify(record.definition),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function fromRow(row: Row): SchemaRecord {
  return {
    id: row.id,
    definition: JSON.parse(row.definition) as SchemaDefinition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
