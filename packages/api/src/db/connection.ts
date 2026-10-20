import Database from 'better-sqlite3';
import { MIGRATIONS, type Migration } from './migrations.js';

export type Db = Database.Database;

/** Opens SQLite in WAL mode with foreign keys on and applies pending migrations (FR-DB1, FR-DB5, FR-DB7). */
export function openDatabase(path: string, migrations: readonly Migration[] = MIGRATIONS): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  migrate(db, migrations);
  return db;
}

export function migrate(db: Db, migrations: readonly Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
    })();
  }
}
