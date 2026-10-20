# 01 — Software Requirements Specification: CSV Validator & Cleaner

Status: v0.3
Depends on: `00-problem.md`

Requirement keywords MUST, MUST NOT, SHOULD, MAY follow RFC 2119.

## 1. Scope and Definitions

| Term | Meaning |
|---|---|
| Schema | A named, user-defined set of column definitions and rules |
| Run | One validation of one uploaded file against one schema |
| Snapshot | An immutable copy of the schema as it was when a Run executed |
| Valid row | A data row that produces zero errors under the snapshot |
| Cell value | The raw field text after CSV parsing, before any cleaning |
| Empty | A cell value that is the empty string after trimming |

Row numbers in all outputs are **1-based data row numbers**, excluding the header (the first data row is row 1). Column identifiers are the schema column `name`.

Out of scope (v1): authentication and multi-tenancy, `.xlsx` input, background jobs, non-rule-based ("AI") cleaning, per-column casing normalization (deferred; not decided in this iteration).

## 2. Functional Requirements

### 2.1 Schema management

- **FR-1** The system MUST allow creating a schema with a unique `name` (case-insensitive, 1-100 chars after trimming) and an ordered list of one or more columns.
- **FR-2** The system MUST allow listing, retrieving, updating, and deleting schemas.
- **FR-3** Each column definition MUST have a `name` (non-empty, unique within the schema, case-sensitive) and a `type`. All other properties are optional and specified in §3.
- **FR-4** The system MUST reject an invalid schema definition with an error identifying the offending column and property (for example `min` greater than `max`, a `pattern` that is not valid RE2 syntax or uses an unsupported feature, `dateFormat` on a non-date column).
- **FR-5** Updating or deleting a schema MUST NOT alter or delete any existing Run or its snapshot (see FR-22).

### 2.2 Upload and parsing

- **FR-6** The system MUST accept a CSV upload and a schema identifier in a single validation request.
- **FR-7** The system MUST reject files larger than 10 MiB (10,485,760 bytes) with a size error (`FILE_TOO_LARGE`, HTTP `413`), without parsing them. This is a transport-level rejection: no Run is created. All other file-level failures (FR-8, FR-12, FR-14) create a Run with `status: "failed"`.
- **FR-8** The system MUST reject empty files and files with no header row.
- **FR-9** Encoding detection MUST, in order:
  1. UTF-16 if a UTF-16 BOM is present (LE or BE);
  2. UTF-8 if a UTF-8 BOM is present, or if the bytes are valid UTF-8;
  3. otherwise decode as `windows-1251`.

  A UTF-8 BOM MUST be stripped. The detected encoding MUST be recorded in the Run.
- **FR-10** Delimiter detection MUST count unquoted `,` and `;` in the header line and select the more frequent. A tie (including zero of both) MUST select `,`. The detected delimiter MUST be recorded in the Run. Other delimiters are not supported.
- **FR-11** Parsing MUST follow RFC 4180 quoting (quoted fields, doubled quotes, embedded delimiters and newlines in quoted fields) and MUST accept `\n`, `\r\n`, and `\r` line endings. A blank trailing line MUST be ignored.
- **FR-12** Header matching MUST be exact after trimming whitespace. A schema column absent from the file MUST produce a file-level error `MISSING_COLUMN` and no row validation SHALL run. A header name that matches a schema column more than once MUST produce a file-level error `DUPLICATE_COLUMN`. Columns in the file that are not in the schema ("pass-through columns") MUST NOT be validated and MUST be preserved in the cleaned output per FR-20; they MUST be listed in the Run as `passthroughColumns`, in file order.
- **FR-13** A data row whose field count differs from the header's MUST produce a row-level error `COLUMN_COUNT_MISMATCH` (column `null`) and the row MUST be treated as invalid.
- **FR-14** An unrecoverable parse failure (for example an unterminated quoted field) MUST fail the Run with a file-level error and MUST NOT produce a cleaned file.

### 2.3 Validation

- **FR-15** For each data row and each schema column, the system MUST evaluate the column rules in §3 and emit zero or more errors.
- **FR-16** Whitespace trimming MUST occur before any rule is evaluated; rules apply to the trimmed value.
- **FR-17** Evaluation MUST be deterministic: the same file bytes and the same snapshot MUST always produce an identical report and a byte-identical cleaned file.
- **FR-18** The system MUST evaluate every row (it MUST NOT stop at the first error) so that the totals are exact.
- **FR-19** Errors MUST be ordered by row ascending, then by schema column order, then by the rule order in §3.1. At most one error per (row, column) is emitted for type-level failures; see §3.1.

### 2.4 Cleaning

- **FR-20** The cleaned CSV MUST:
  1. contain **all columns of the original file, in the original header order**, including pass-through columns; the header names are emitted trimmed;
  2. contain only valid rows, in original order;
  3. exclude rows dropped as `NOT_UNIQUE` duplicates and all other invalid rows;
  4. contain trimmed values for schema columns;
  5. contain `date` values of schema columns normalized to `YYYY-MM-DD`;
  5a. emit the values of pass-through columns unchanged (not trimmed, not normalized), except for FR-21 sanitization;
  6. be UTF-8 without BOM, `,`-delimited, `\n` line endings, with fields quoted only when they contain `,`, `"`, `\r`, or `\n`;
  7. have formula-injection sanitization applied per FR-21.
- **FR-21** (Formula injection) For each cleaned cell, if the value begins with `=`, `+`, `-`, or `@` and the cell belongs to a schema column of type `string` or `email` (a `date` is always cleaned to `YYYY-MM-DD`) or to a pass-through column, the system MUST prefix it with a single apostrophe `'`. Cells in schema columns of type `integer` and `decimal` MUST NOT be prefixed (negative numbers such as `-7` stay intact). Pass-through columns have no declared type and are treated as text. Sanitization is applied only to the cleaned export, never to validation or to the stored error report. Run metadata MUST report the number of sanitized cells.
- **FR-21a** The system MUST NOT otherwise alter cell values (no case changes, no type coercion beyond date normalization, no value guessing), and MUST NOT drop or reorder columns.
- **FR-21b** Rows that contain errors MUST be reported but MUST NOT appear in the cleaned CSV. If zero valid rows remain, the cleaned CSV MUST still be produced with only the header row.

### 2.5 Runs, history, persistence

- **FR-22** Each validation request MUST create a persisted Run containing the data in §5.2, including a full snapshot of the schema as it was at execution time. A Run MUST remain complete and readable after its schema is changed or deleted.
- **FR-23** The system MUST persist the Run's metadata, error summary, stored errors (capped per FR-26), and the generated cleaned CSV (as a file on the local filesystem, FR-DB6). The raw uploaded file MUST NOT be retained after the request completes, including on failure.
- **FR-24** The system MUST list Runs, newest first, with pagination, showing at least: id, created time, original filename, schema name (from the snapshot), status, row counts, and total error count.
- **FR-25** The system MUST allow retrieving a Run's full report (paginated errors) and downloading its cleaned CSV. Downloading a Run with status `failed` or one that has no cleaned file MUST return a not-found style error.
- **FR-26** A Run MUST store and expose at most **1000** errors (the first 1000 in the order of FR-19). It MUST additionally store the exact total error count, exact per-code counts, and a `truncated` flag that is true when total errors exceed 1000. Counts MUST NOT be derived from the stored (capped) list.
- **FR-27** The system SHOULD allow deleting a Run (metadata, errors, and the cleaned CSV file together).

### 2.6 Web UI

- **FR-28** The web app MUST provide: a schema builder (create/edit/delete), a validation screen (select schema, upload file, see results), a report viewer (summary, per-code counts, error table with row/column/code/message, truncation notice), a cleaned-CSV download button, and a history list.
- **FR-29** The UI MUST show the truncation notice whenever `truncated` is true, including the exact total.
- **FR-30** The UI MUST perform no validation logic of its own; all results come from the API.

### 2.7 API

- **FR-31** The API MUST expose the capabilities of FR-1 to FR-27 over HTTP with JSON bodies (multipart for upload), and MUST validate all request bodies against declared schemas, returning structured `4xx` errors for invalid input (for example `413` for oversize files, `404` for unknown ids, `422` for invalid schema definitions).
- **FR-32** `packages/core` MUST contain all parsing, validation, and cleaning logic and MUST NOT depend on HTTP, the database, the filesystem, or any native module. Regex support is provided by a `RegexEngine` interface (compile pattern, test string) defined in `core` and injected by the caller; `packages/api` injects an RE2-backed implementation. `core` MUST also export the Zod schema-definition validator and its inferred TypeScript types as the single source of truth for schema shape (FR-3, FR-4). The API and web packages MUST NOT reimplement rule logic, and `packages/web` MUST import from `core` using type-only imports.

## 3. Rule Specifications

A schema column has these properties:

| Property | Applies to | Default | Meaning |
|---|---|---|---|
| `name` | all | required | Header name in the file |
| `type` | all | required | `string`, `integer`, `decimal`, `date`, `boolean`, `email` |
| `required` | all | `false` | Empty value is an error |
| `unique` | all | `false` | Values must be unique across the file |
| `pattern` | string, email | none | Regex the whole value must match |
| `min` / `max` | integer, decimal, string (length), date | none | Inclusive bounds |
| `enum` | string, integer, decimal | none | Non-empty list of allowed values |
| `dateFormat` | date | `YYYY-MM-DD` | Expected input format |

### 3.1 Evaluation order per cell

1. **trim** the value;
2. **required**: if empty and `required`, emit `REQUIRED` and stop for this cell;
3. if empty and not required, the cell is valid, **skip all remaining rules including `unique`**;
4. **type**: if the value does not conform, emit `INVALID_TYPE` (or `INVALID_DATE`; see below) and stop for this cell;
5. **pattern**, **enum**, **min/max** (in that order), each emitting its own error; several may be emitted;
6. **unique** (evaluated last, see §3.9).

### 3.2 `required`

- **FR-R1** A cell that is empty after trimming MUST produce `REQUIRED` when `required` is true. A missing field is distinct from a missing column (FR-12).

### 3.3 `type`

- **FR-T1 `string`**: any non-empty text is valid.
- **FR-T2 `integer`**: MUST match `^[+-]?\d+$`. No thousands separators, no decimal point, no exponent. Cleaned output MUST preserve the trimmed text exactly (including a leading `+` or leading zeros); the system does not canonicalize numbers. Range checks use the parsed value; values beyond `Number.MAX_SAFE_INTEGER` MUST produce `INVALID_TYPE`.
- **FR-T3 `decimal`**: MUST match `^[+-]?(\d+(\.\d+)?|\.\d+)$`. The decimal separator is `.` only; a `,` is `INVALID_TYPE`. No exponent, no thousands separators.
- **FR-T4 `boolean`**: MUST be one of `true`, `false` (case-insensitive). `1`, `0`, `yes`, `no` are `INVALID_TYPE`. Cleaned output preserves the trimmed text.
- **FR-T5 `email`**: MUST match a pragmatic pattern: exactly one `@`, a non-empty local part without whitespace, and a domain of at least two dot-separated labels without whitespace. The system MUST NOT perform DNS or deliverability checks. Total length MUST NOT exceed 254 characters.
- **FR-T6 `date`**: see §3.7.

### 3.4 `pattern`

- **FR-P1** `pattern` is a regular expression in **RE2 syntax**. Lookahead, lookbehind, and backreferences are **not supported** and MUST be rejected at schema save (FR-P2). The pattern MUST match the **entire** trimmed value: it is compiled as `^(?:<pattern>)$`. Failure emits `PATTERN_MISMATCH`.
- **FR-P2** The schema MUST be rejected at creation/update if the pattern fails to compile under RE2 or exceeds 500 characters. The error MUST name the column and, where the engine reports it, the unsupported construct (for example "lookahead is not supported"). Because RE2 evaluates in time linear in the input, no additional backtracking guard is required. The schema builder UI SHOULD state the RE2 dialect next to the pattern input.
- **FR-P3** Regex compilation and matching MUST go through the `RegexEngine` port defined by `packages/core` (FR-32). The pattern semantics of FR-P1 are those of the injected engine; the production engine is RE2.

### 3.5 `min` / `max`

- **FR-M1** For `integer` and `decimal`: numeric comparison, inclusive. Failures emit `BELOW_MIN` / `ABOVE_MAX`.
- **FR-M2** For `string` and `email`: `min`/`max` bound the character length (Unicode code points) of the trimmed value.
- **FR-M3** For `date`: `min`/`max` are given in `YYYY-MM-DD` and compared against the parsed date.
- **FR-M4** `min` MUST be less than or equal to `max` when both are present.

### 3.6 `enum`

- **FR-E1** The value MUST equal one of the listed entries, with a case-sensitive comparison on the trimmed value. For `integer`/`decimal`, comparison is numeric. Failure emits `NOT_IN_ENUM`.

### 3.7 `date` and `dateFormat`

- **FR-D1** Supported `dateFormat` values: `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`. Anything else MUST be rejected at schema save.
- **FR-D2** A date cell is valid if it parses under the column's declared `dateFormat` **or** under canonical `YYYY-MM-DD`. This ensures that a cleaned file always passes its own schema.
- **FR-D3** Parsing is strict: the format is exact, day and month are two digits (zero-padded), the year is four digits, and the calendar date MUST exist (for example `31.04.2024` and `29.02.2023` are invalid). No time component is permitted.
- **FR-D4** Ambiguity is resolved only by the declared format; the system MUST NOT try other formats. Because the canonical form is `YYYY-MM-DD` (which cannot be confused with any other supported format), no ambiguity arises in the dual acceptance.
- **FR-D5** A cell that fails both formats emits `INVALID_DATE`.
- **FR-D6** Valid dates MUST be rewritten to `YYYY-MM-DD` in the cleaned CSV.

### 3.8 `unique`

- **FR-U1** When `unique` is true, the value MUST be unique among all data rows, evaluated on the **normalized** value (trimmed; dates in canonical form so `01.03.2024` and `2024-03-01` collide; other types compared as trimmed text, case-sensitive).
- **FR-U2** Empty values are exempt from uniqueness.
- **FR-U3** The first occurrence in file order (lowest row number) claims the value. Each later occurrence MUST emit `NOT_UNIQUE`, with a message referencing the first row, and the row is dropped from the cleaned file (it is invalid like any other errored row).
- **FR-U4** The first occurrence claims the value **even if that row is invalid for another reason** (deterministic and independent of other columns). See §7, decision 2.
- **FR-U5** Uniqueness on multiple columns forms independent constraints; composite keys are out of scope for v1.

## 4. Error Report Model

### 4.1 Row-level error

```json
{
  "row": 12,
  "column": "invoice_date",
  "code": "INVALID_DATE",
  "message": "Expected DD.MM.YYYY or YYYY-MM-DD, got '31.04.2024'",
  "value": "31.04.2024"
}
```

- **FR-ER1** `row` MUST be an integer ≥ 1. `column` MUST be a schema column name, or `null` for `COLUMN_COUNT_MISMATCH`. `code` MUST be from the catalog in §4.3. `message` MUST be a human-readable, deterministic English string. `value` is the trimmed offending value.
- **FR-ER2** `value` MUST be truncated to 200 characters in stored errors.
- **FR-ER3** Messages MUST NOT embed more than the (truncated) offending value; logs MUST NOT contain cell contents (NFR-9).

### 4.2 File-level error

A Run that fails at file level has `status: "failed"`, no row errors, and one error object `{ "code": "...", "message": "..." }` with a code from §4.3.

### 4.3 Error code catalog

| Code | Level | Trigger |
|---|---|---|
| `FILE_TOO_LARGE` | file | Upload exceeds 10 MiB |
| `FILE_EMPTY` | file | Zero bytes, or no header |
| `PARSE_ERROR` | file | Unrecoverable CSV syntax failure (FR-14) |
| `MISSING_COLUMN` | file | Schema column not in header (FR-12) |
| `DUPLICATE_COLUMN` | file | Header contains a schema column name more than once (FR-12) |
| `COLUMN_COUNT_MISMATCH` | row | Field count ≠ header count |
| `REQUIRED` | row | Empty value in a required column |
| `INVALID_TYPE` | row | Value does not conform to `integer`/`decimal`/`boolean`/`email` |
| `INVALID_DATE` | row | Value fails the declared format and the canonical format |
| `PATTERN_MISMATCH` | row | Fails `pattern` |
| `NOT_IN_ENUM` | row | Not in `enum` |
| `BELOW_MIN` | row | Under `min` |
| `ABOVE_MAX` | row | Over `max` |
| `NOT_UNIQUE` | row | Repeated value in a `unique` column |

### 4.4 Report summary

- **FR-ER4** A Run report MUST include: `status` (`completed` or `failed`), `totalRows`, `validRows`, `invalidRows`, `duplicateRowsDropped`, `totalErrors`, `errorCountsByCode`, `truncated`, `errors` (capped list, paginated on retrieval), `passthroughColumns`, `detectedEncoding`, `detectedDelimiter`, `sanitizedCells`.
- **FR-ER5** Invariants: `validRows + invalidRows = totalRows`; `sum(errorCountsByCode) = totalErrors`; `len(errors) = min(totalErrors, 1000)`; the cleaned CSV has exactly `validRows` data rows.
- **FR-ER6** A Run with row errors still has `status: "completed"` (validation completed; the data is not clean). `failed` is reserved for file-level failures.

## 5. Data and Persistence

### 5.1 Schema record

`id`, `name`, `columns[]` (as in §3), `createdAt`, `updatedAt`.

### 5.2 Run record

`id`, `createdAt`, `originalFilename`, `fileSizeBytes`, `fileSha256`, `schemaSnapshot` (full schema JSON, including the schema's `id` and name at that time), `status`, the report summary fields from FR-ER4, the capped `errors`, and the path of the cleaned CSV file (`cleanedPath`, relative to the data directory; null if none).

- **FR-DB1** Storage MUST be SQLite accessed through `better-sqlite3`.
- **FR-DB2** The Run's snapshot MUST NOT be a foreign key that cascades; deleting the schema MUST NOT affect Runs.
- **FR-DB3** A Run MUST be written atomically (all or nothing); a crash MUST NOT leave a partial Run visible. The cleaned CSV file MUST be written to a temporary name and renamed into place before the database row is committed; an orphaned cleaned file (crash between rename and commit) MUST be removed by a startup sweep.
- **FR-DB4** The raw upload MUST be stored only in temporary memory or a temp file, and MUST be removed on both success and failure paths.
- **FR-DB5** Schema changes (migrations) MUST be versioned and applied at startup.
- **FR-DB6** Cleaned CSVs MUST be stored on the local filesystem at `<dataDir>/cleaned/<runId>.csv` (default `dataDir` is `./data`), not as database BLOBs. The database MUST hold only the relative path. Deleting a Run MUST delete its file.
- **FR-DB7** SQLite MUST run in WAL mode with foreign keys enabled.

## 6. Non-Functional Requirements

- **NFR-1 Performance** A 10 MiB file MUST complete validation and cleaning in ≤ 5 s at p95 on a 2020-or-newer laptop-class machine, for a file with a typical mix of rule types, including a worst-case in which every row has an error. Processing runs inline in the request (no worker threads in v1); concurrent requests may be delayed while a file is processed.
- **NFR-2 Memory** The server SHOULD stay under 512 MB resident while processing a 10 MiB file; processing MUST NOT keep an unbounded error list in memory (stop storing after 1000, continue counting).
- **NFR-3 Determinism** Same bytes + same snapshot → identical report and identical cleaned bytes, independent of locale, timezone, and time of day. Core MUST NOT call the clock or use randomness.
- **NFR-4 Idempotence** Feeding a cleaned CSV back through the same schema MUST yield zero errors, with the exception that cells sanitized by FR-21 are subject to the schema's rules like any other value (see §7, decision 1).
- **NFR-5 Purity** `packages/core` exports pure functions and takes bytes, a schema, and a `RegexEngine`, returning plain data. It has no I/O, no clock, no randomness, and no native dependencies; identifiers and timestamps are assigned by the caller.
- **NFR-6 Testability** Core line coverage MUST be ≥ 90%, and each error code MUST have at least one test. API tests MUST run against an in-memory SQLite database.
- **NFR-7 Type safety** The repo MUST compile with TypeScript `strict`, shared types MUST be imported from `core` and not duplicated.
- **NFR-8 Security** The API MUST enforce the size limit while streaming (not after buffering), MUST bind to `127.0.0.1` by default, and MUST apply the FR-21 sanitization to every cleaned download. See NFR-13 for browser-origin hardening.
- **NFR-9 Privacy** Logs MUST NOT contain cell values or file content. Only ids, sizes, counts, durations, and error codes may be logged.
- **NFR-10 Usability** The UI SHOULD be usable at a 1280 px wide viewport and keyboard-accessible for the upload and download flow. Displayed error tables SHOULD paginate.
- **NFR-11 Portability** Runs on Node.js LTS on macOS and Linux with `npm install && npm test` as the only setup. The `re2` native module MUST install from a prebuilt binary on these platforms.
- **NFR-12 Observability** Each request SHOULD carry a request id that is included in logs and in error responses.
- **NFR-13 Localhost hardening** The API MUST send CORS headers only for the configured web SPA origin (never `*`), MUST reject requests whose `Host` header is not an expected loopback host/port with `403`, MUST reject state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) whose `Origin` header is present and not the configured SPA origin with `403`, and MUST serve cleaned CSV downloads with `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` (with a sanitized filename).

## 7. Finalized Decisions

Confirmed by the Lead Engineer; each is binding for v1.

1. **Formula sanitization** (FR-21). Non-numeric cells starting with `=`, `+`, `-`, `@` are prefixed with `'` in the cleaned export; raw formulas become text. Schema columns of type `integer`/`decimal` are exempt, so `-7` stays `-7`. The stored cleaned CSV is the sanitized one. Consequence: a re-uploaded cleaned file may fail strict `pattern`/`enum` rules on sanitized cells (NFR-4 is scoped accordingly).
2. **Unique claim** (FR-U4). The first occurrence claims the key regardless of errors in other columns, which keeps column rules decoupled and deterministic.
3. **Extra columns are preserved** (FR-12, FR-20, FR-21a). Cleaned output keeps all original columns in original order; only schema columns are validated and cleaned. Pass-through values are untouched except for FR-21 sanitization. A missing schema column still fails the Run (`MISSING_COLUMN`), and a duplicated schema column name fails it with `DUPLICATE_COLUMN`.
4. **No casing normalization in v1.** May return later as an optional `case` column property.
5. **Retention.** Run records (in SQLite) and their cleaned CSV files (on disk) are kept until explicitly deleted (FR-27); no automatic expiry.
6. **`windows-1251` fallback.** The detected encoding is always recorded in the Run (FR-9), so a misdetected legacy encoding is visible. A manual encoding override is a candidate for v1.1.
7. **Wrong field count** is a row error (FR-13), never repaired.
8. **Regex dialect.** RE2 via an injected `RegexEngine` (FR-P1 to FR-P3); lookaround and backreferences are rejected at schema save.
9. **Localhost hardening** is a requirement (NFR-13), since an unauthenticated local API is reachable from any web page in the user's browser.
10. **Cleaned CSVs live on the filesystem**, not in SQLite (FR-DB6).

## 8. Acceptance Criteria

Each AC is testable and traces to requirements.

### Schema
- **AC-1** (FR-1, FR-3) Given a valid schema payload, when it is created, then it is retrievable by id with identical columns in the same order. Creating a second schema with the same name (any casing) fails.
- **AC-2** (FR-4) Given `min: 10, max: 5`, an invalid `pattern` such as `(`, or `dateFormat` on an `integer` column, then creation fails with an error naming the column and property.
- **AC-3** (FR-5, FR-22, FR-DB2) Given a completed Run, when its schema is edited and then deleted, then the Run's report, snapshot, and cleaned CSV remain retrievable unchanged.

### Upload and parsing
- **AC-4** (FR-7) A 10,485,761-byte file is rejected with `FILE_TOO_LARGE`; a 10,485,760-byte file is accepted.
- **AC-5** (FR-9) The same logical data supplied as UTF-8, UTF-8 with BOM, UTF-16 LE with BOM, and windows-1251 (Cyrillic values) produces the same cleaned output, and the recorded encodings are respectively `utf-8`, `utf-8`, `utf-16le`, and `windows-1251`.
- **AC-6** (FR-10) A header of `id;name;date` is detected as `;`; `id,name,date` as `,`; a header with a single column defaults to `,`.
- **AC-7** (FR-11) A quoted field containing a comma, a doubled quote, and a newline round-trips through validation and the cleaned output without corruption.
- **AC-8** (FR-12) A file lacking schema column `email` fails with `MISSING_COLUMN` and has no row errors. A header with `email` twice fails with `DUPLICATE_COLUMN`. A file with an extra column `notes` succeeds and lists `notes` in `passthroughColumns`.
- **AC-9** (FR-13) A row with too few or too many fields yields `COLUMN_COUNT_MISMATCH` with `column: null`, and the row is absent from the cleaned CSV.

### Rules
- **AC-10** (FR-R1) For a required column, `""` and `"   "` both yield `REQUIRED`; for an optional column both are valid and skip all other rules, including `unique`.
- **AC-11** (FR-T2) For `integer`: `42`, `-7`, `+3`, `007` are valid; `4.2`, `1,000`, `1e3`, `abc`, and `9007199254740993` yield `INVALID_TYPE`.
- **AC-12** (FR-T3) For `decimal`: `4.2`, `-0.5`, `.5`, `10` are valid; `4,2`, `1e3`, `5.`, `abc` yield `INVALID_TYPE`.
- **AC-13** (FR-T4) For `boolean`: `true`, `FALSE`, `True` are valid; `yes`, `1`, `0` yield `INVALID_TYPE`.
- **AC-14** (FR-T5) For `email`: `a@b.co` is valid; `a@b`, `a@@b.co`, `a b@c.co`, and `@b.co` yield `INVALID_TYPE`.
- **AC-15** (FR-P1) With `pattern: "[A-Z]{3}"`, `ABC` is valid; `ABCD` and `abc` yield `PATTERN_MISMATCH` (full-value match). A pattern using alternation such as `a|b` matches only the whole value `a` or `b`, not `ab` or `xb`.
- **AC-15a** (FR-P2, FR-4) Creating a schema with the pattern `^(?!0)\d+$` (lookahead), `(a)\1` (backreference), or `(?<=x)y` (lookbehind) fails with an error naming the column, `pattern`, and the unsupported construct; a pattern longer than 500 characters also fails.
- **AC-16** (FR-M1, FR-M2, FR-M3) `min: 1, max: 10` on `integer` accepts `1` and `10`, rejects `0` (`BELOW_MIN`) and `11` (`ABOVE_MAX`); on `string`, bounds apply to character length; on `date`, to the calendar date.
- **AC-17** (FR-E1) With `enum: ["USD","EUR"]`, `USD` is valid; `usd` and `GBP` yield `NOT_IN_ENUM`.
- **AC-18** (FR-D1-FR-D3) Under `DD.MM.YYYY`: `01.03.2024` is valid; `1.3.2024`, `31.04.2024`, `29.02.2023`, `2024-13-01`, and `01/03/2024` yield `INVALID_DATE`. Under `MM/DD/YYYY`: `03/01/2024` is read as March 1.
- **AC-19** (FR-D2, FR-D6) A column with `dateFormat: "DD.MM.YYYY"` accepts both `01.03.2024` and `2024-03-01`, and the cleaned output contains `2024-03-01` for both.
- **AC-20** (FR-U1-FR-U4) Given a `unique` column with values `A, B, a, A` in rows 1-4: row 4 yields `NOT_UNIQUE` referencing row 1; `a` is not a duplicate; row 4 is dropped from the cleaned CSV. Given dates `01.03.2024` (row 1) and `2024-03-01` (row 2) in a unique date column, row 2 yields `NOT_UNIQUE`.

### Cleaning
- **AC-21** (FR-16, FR-20) Input `"  Alice  "` in a schema column is output as `Alice`; header names are trimmed.
- **AC-21a** (FR-20, FR-12) Given a 25-column file with a 3-column schema, the cleaned CSV has 25 columns in the original header order; pass-through cell values are byte-identical to the input (leading/trailing spaces and date formats preserved), except for FR-21 sanitization; the 3 schema columns are cleaned in place.
- **AC-22** (FR-20, FR-21b) The cleaned CSV contains exactly `validRows` data rows in original order, and contains none of the rows that produced any error.
- **AC-23** (FR-21b) When every row is invalid, the cleaned CSV is a header line only.
- **AC-24** (FR-21) In a `string` column or a pass-through column, `=1+1`, `+x`, `-y`, `@z` appear as `'=1+1`, `'+x`, `'-y`, `'@z`; in an `integer` column, `-7` remains `-7`; `sanitizedCells` equals the number of prefixed cells.
- **AC-25** (FR-20) Cleaned output is UTF-8 with no BOM, `\n` line endings, and quotes only where needed.
- **AC-26** (FR-17, NFR-3) Running the same file and schema twice (including on different dates/timezones) yields byte-identical cleaned CSVs and deep-equal reports.
- **AC-27** (NFR-4) A cleaned CSV produced from a schema without cell-leading `= + - @` strings and re-validated against the same schema yields zero errors.

### Report
- **AC-28** (FR-ER1, FR-19) Errors are ordered by row, then column order, then rule order, and every error has `row ≥ 1`, a known `code`, and a non-empty `message`.
- **AC-29** (FR-26, FR-ER5) For a file generating 5,000 errors: `totalErrors = 5000`, `errors.length = 1000`, `truncated = true`, `sum(errorCountsByCode) = 5000`, and these are the first 1000 errors in order. For a file generating exactly 1000 errors, `truncated = false`.
- **AC-30** (FR-ER5, FR-ER6) For any completed Run, `validRows + invalidRows = totalRows`, and a Run with errors still has `status = "completed"`.
- **AC-31** (FR-ER2) A 5,000-character offending value is stored truncated to 200 characters.

### Persistence and history
- **AC-32** (FR-22, FR-23) After a validation, the Run is retrievable with its snapshot, summary, stored errors, and a downloadable cleaned CSV byte-identical to the one produced at execution time (read from `<dataDir>/cleaned/<runId>.csv`).
- **AC-33** (FR-DB4) After success and after failure (for example `PARSE_ERROR`), no raw upload file remains in the temp directory.
- **AC-34** (FR-24) History lists Runs newest first, with pagination, each row showing filename, schema name from the snapshot, status, counts, and time.
- **AC-35** (FR-25) Downloading the cleaned CSV of a `failed` Run returns `404`.
- **AC-36** (FR-DB3) If persistence fails mid-write (simulated), no partial Run appears in history, and the startup sweep removes any orphaned `cleaned/<id>.csv` that has no Run row.
- **AC-36a** (FR-27, FR-DB6) Deleting a Run removes its database rows and its cleaned file; the database holds a relative path only and no CSV content; WAL mode is enabled.

### API and UI
- **AC-37** (FR-31) Invalid bodies return `4xx` with a structured error; unknown ids return `404`; oversize uploads return `413`.
- **AC-38** (FR-28, FR-29) In the UI, a user can create a schema, upload a CSV, see the summary and error table, and download the cleaned file; when `truncated` is true the notice shows the exact total.
- **AC-39** (FR-32, NFR-5) `packages/core` has no import of `fastify`, `better-sqlite3`, `re2`, `node:fs`, `node:http`, or React, and `packages/web` imports from `core` with type-only imports (enforced by a lint rule or dependency check). `core` tests run with a non-RE2 `RegexEngine`.

### Non-functional
- **AC-40** (NFR-1) A generated 10 MiB file (all-error worst case included) completes in ≤ 5 s at p95 over 20 runs on the reference machine.
- **AC-41** (NFR-2) Processing a 10 MiB all-error file never holds more than 1000 error objects in memory, while counts stay exact.
- **AC-42** (NFR-6) Core coverage ≥ 90% and every code in §4.3 is exercised by at least one test.
- **AC-43** (NFR-8, NFR-9) The server listens on `127.0.0.1` by default, and a test confirms no log line contains a known cell value after a validation.
- **AC-44** (NFR-13) A request with a foreign `Host` header, or a `POST` with `Origin: https://evil.example`, returns `403`; a preflight from the SPA origin succeeds and from any other origin gets no CORS allow headers; a download response carries `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`.

## 9. Traceability Summary

| Area | Requirements | Acceptance criteria |
|---|---|---|
| Schema | FR-1 to FR-5 | AC-1 to AC-3 |
| Upload/parsing | FR-6 to FR-14 | AC-4 to AC-9 |
| Rules | FR-15 to FR-19, §3 | AC-10 to AC-20 |
| Cleaning | FR-20, FR-21 | AC-21 to AC-27 |
| Report | §4, FR-26 | AC-28 to AC-31 |
| Persistence/history | FR-22 to FR-27, FR-DB* | AC-32 to AC-36 |
| API/UI | FR-28 to FR-32 | AC-37 to AC-39 |
| NFR | NFR-1 to NFR-13 | AC-40 to AC-44 |
