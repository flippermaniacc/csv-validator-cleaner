export interface Migration {
  version: number;
  sql: string;
}

/** Ordered, append-only list; embedded as strings so `tsc` output needs no asset copying (FR-DB5). */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE schemas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL UNIQUE,
  definition  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE runs (
  id                       TEXT PRIMARY KEY,
  created_at               TEXT NOT NULL,
  original_filename        TEXT NOT NULL,
  file_size_bytes          INTEGER NOT NULL,
  file_sha256              TEXT NOT NULL,

  schema_id                TEXT,
  schema_name              TEXT NOT NULL,
  schema_snapshot          TEXT NOT NULL,

  status                   TEXT NOT NULL CHECK (status IN ('completed','failed')),
  file_error               TEXT,
  detected_encoding        TEXT,
  detected_delimiter       TEXT,

  total_rows               INTEGER NOT NULL DEFAULT 0,
  valid_rows               INTEGER NOT NULL DEFAULT 0,
  invalid_rows             INTEGER NOT NULL DEFAULT 0,
  duplicate_rows_dropped   INTEGER NOT NULL DEFAULT 0,
  total_errors             INTEGER NOT NULL DEFAULT 0,
  truncated                INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  error_counts_by_code     TEXT NOT NULL DEFAULT '{}',
  passthrough_columns      TEXT NOT NULL DEFAULT '[]',
  sanitized_cells          INTEGER NOT NULL DEFAULT 0,

  cleaned_path             TEXT,
  cleaned_size_bytes       INTEGER,

  CHECK (valid_rows + invalid_rows = total_rows)
);

CREATE INDEX idx_runs_created ON runs (created_at DESC, id DESC);

CREATE TABLE run_errors (
  run_id   TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  "row"    INTEGER NOT NULL,
  "column" TEXT,
  code     TEXT    NOT NULL,
  message  TEXT    NOT NULL,
  value    TEXT,
  PRIMARY KEY (run_id, seq)
) WITHOUT ROWID;

CREATE INDEX idx_run_errors_code ON run_errors (run_id, code, seq);
`,
  },
];
