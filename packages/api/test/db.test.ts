import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../src/db/connection.js';
import { MIGRATIONS } from '../src/db/migrations.js';

const open: Db[] = [];
const dirs: string[] = [];
afterEach(() => {
  open.splice(0).forEach((db) => db.open && db.close());
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
const memory = () => {
  const db = openDatabase(':memory:');
  open.push(db);
  return db;
};

const insertRun = (db: Db, id: string, overrides: Record<string, unknown> = {}) => {
  const row = {
    id,
    created_at: '2026-01-01T00:00:00.000Z',
    original_filename: 'f.csv',
    file_size_bytes: 1,
    file_sha256: 'x',
    schema_id: 'ghost-schema',
    schema_name: 'S',
    schema_snapshot: '{}',
    status: 'completed',
    total_rows: 2,
    valid_rows: 1,
    invalid_rows: 1,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO runs (id, created_at, original_filename, file_size_bytes, file_sha256, schema_id,
       schema_name, schema_snapshot, status, total_rows, valid_rows, invalid_rows)
     VALUES (@id, @created_at, @original_filename, @file_size_bytes, @file_sha256, @schema_id,
       @schema_name, @schema_snapshot, @status, @total_rows, @valid_rows, @invalid_rows)`,
  ).run(row);
};

describe('migrations (FR-DB5)', () => {
  it('creates every table and records the applied versions', () => {
    const db = memory();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(['schemas', 'runs', 'run_errors', 'schema_migrations']),
    );
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
  });

  it('applies each migration exactly once, however often it is called', () => {
    const db = memory();
    migrate(db, MIGRATIONS);
    migrate(db, MIGRATIONS);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 });
  });

  it('applies only newer migrations when the database is behind', () => {
    const db = memory();
    migrate(db, [
      ...MIGRATIONS,
      { version: 2, sql: 'CREATE TABLE later (id INTEGER PRIMARY KEY)' },
    ]);
    migrate(db, [
      ...MIGRATIONS,
      { version: 2, sql: 'CREATE TABLE later (id INTEGER PRIMARY KEY)' },
    ]);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
  });

  it('rolls a failing migration back completely', () => {
    const db = memory();
    const broken = {
      version: 2,
      sql: 'CREATE TABLE ok_table (id INTEGER); SELECT * FROM no_such_table;',
    };
    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_table'").get(),
    ).toBeUndefined();
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
  });
});

describe('connection settings (FR-DB7)', () => {
  it('uses WAL for file databases and enables foreign keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csvv-db-'));
    dirs.push(dir);
    const db = openDatabase(join(dir, 'app.db'));
    open.push(db);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('persists across reopening without re-running migrations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csvv-db-'));
    dirs.push(dir);
    const path = join(dir, 'app.db');
    openDatabase(path).close();
    const again = openDatabase(path);
    open.push(again);
    expect(again.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 });
  });
});

describe('schema constraints', () => {
  it('rejects a second schema name differing only by case or spacing key', () => {
    const db = memory();
    const insert = db.prepare(
      'INSERT INTO schemas (id, name, name_key, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insert.run('1', 'Invoices', 'invoices', '{}', 't', 't');
    expect(() => insert.run('2', 'INVOICES', 'invoices', '{}', 't', 't')).toThrow(/UNIQUE/);
  });

  it('keeps runs when their schema is absent: no foreign key (AC-3, FR-DB2)', () => {
    const db = memory();
    expect(() => insertRun(db, 'r1', { schema_id: 'never-existed' })).not.toThrow();
  });

  it('enforces valid + invalid = total rows (FR-ER5)', () => {
    const db = memory();
    expect(() => insertRun(db, 'r1', { total_rows: 5, valid_rows: 1, invalid_rows: 1 })).toThrow(
      /CHECK/,
    );
  });

  it('only allows the two run statuses', () => {
    const db = memory();
    expect(() => insertRun(db, 'r1', { status: 'running' })).toThrow(/CHECK/);
  });

  it('deletes run errors together with their run', () => {
    const db = memory();
    insertRun(db, 'r1');
    db.prepare(
      'INSERT INTO run_errors (run_id, seq, "row", "column", code, message, value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('r1', 0, 1, 'c', 'REQUIRED', 'Value is required', '');
    db.prepare('DELETE FROM runs WHERE id = ?').run('r1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_errors').get()).toEqual({ n: 0 });
  });

  it('rejects run errors for an unknown run', () => {
    const db = memory();
    expect(() =>
      db
        .prepare(
          'INSERT INTO run_errors (run_id, seq, "row", code, message) VALUES (?, ?, ?, ?, ?)',
        )
        .run('missing', 0, 1, 'REQUIRED', 'x'),
    ).toThrow(/FOREIGN KEY/);
  });

  it('allows a null column for file-shape row errors', () => {
    const db = memory();
    insertRun(db, 'r1');
    expect(() =>
      db
        .prepare(
          'INSERT INTO run_errors (run_id, seq, "row", "column", code, message) VALUES (?, ?, ?, NULL, ?, ?)',
        )
        .run('r1', 0, 1, 'COLUMN_COUNT_MISMATCH', 'x'),
    ).not.toThrow();
  });
});
