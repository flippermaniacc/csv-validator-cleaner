# 03 — Validation Report: CSV Validator & Cleaner v1

Status: Final for v1
Checked against: `01-srs.md` (v0.3) and `02-design.md` (v0.2)

This report answers three questions: did we build what the SRS asked for, how do we know, and where did the result differ from the documents or fall short.

## 1. Verdict

All 133 identified requirements and acceptance criteria (73 FR, 13 NFR, 47 AC) are implemented. None is unmet. Three are only partly verified and two carry a caveat; they are listed here so nobody has to find them in the tables.

| Item | State | Why |
|---|---|---|
| NFR-10 usability | Partly verified | Controls are labelled and the component tests find them by label and role, and the layout is responsive, but keyboard order was never tested, there has been no accessibility audit, and nothing was checked in a real browser. |
| NFR-11 portability | Partly verified | Built and run on macOS (Apple silicon) only. No Linux or Windows run, no CI. |
| AC-38 UI flow | Partly verified | Proven with component tests against a stubbed API (including one test that walks create schema → upload → report → download), and the API half is proven over real HTTP by `npm run smoke`. The two have not been joined in a real browser. |
| NFR-2 memory (SHOULD) | Met, with a caveat | One request peaks at 234–304 MiB RSS. Over 20 repeated runs with an uncapped V8 heap RSS drifts to about 590 MiB because V8 delays garbage collection; with the heap capped at 256 MiB it stays at or below 333 MiB. See §2.1. |
| NFR-13 hardening | Met, with a deviation | The Host check compares host names, not host and port (§3.1). |

## 2. Evidence

Everything below was run on the final tree.

| Check | Result |
|---|---|
| `npm run typecheck`, `lint`, `format:check`, `build` | All pass. Lint includes the package-boundary rules (ESLint `no-restricted-imports`, dependency-cruiser). |
| `npm test` | 608 tests pass: 250 in `core`, 247 in `api`, 111 in `web`. |
| Coverage of `packages/core` (`npm run test:coverage`) | 99.75% lines, 98.94% statements, 97.87% branches, 100% functions (threshold 90%). |
| `npm run smoke` | 12 checks pass over real HTTP against the built server: health, built SPA with CSP, create schema, upload with expected counts, ordered errors, cleaned download, 413 at 10 MiB + 1 byte, history, 403 for a foreign Host and Origin, delete, clean SIGTERM exit. |
| `npm run bench` | PASS. p95 between 252 and 309 ms against a 5 s budget; first-request RSS 234–299 MiB. |
| Mutation checks | At milestones M7, M8, M10, M11 and M12 a key behaviour was deliberately broken to confirm a test fails (empty cells skipping rules, the stop at a type failure, the 1000-error cap, the case-insensitive name key, sanitizer double-prefix, header quoting, pass-through header sanitising, DB-failure cleanup, keyset tie-break, code filter, delete ordering). One survivor was found and fixed (§3.4). |
| Golden files | 12 fixtures under `packages/core/test/fixtures/golden`; each expected output was read by hand before being accepted. |

### 2.1 Benchmark detail (AC-40, AC-41, NFR-1, NFR-2)

Machine: Apple M1, 8 cores, 16 GiB, macOS (Darwin 25.2.0), Node 22.13.0. Each scenario runs in its own process on a 10 MiB file read from disk (so generator memory is not counted); 20 runs, the first one cold and included. The typical file has 96,456 rows with about 2% flawed; the all-error file has 137,821 rows and every row fails seven rules, 964,747 errors in all.

Default heap (`npm run bench`):

| Scenario | p50 ms | p95 ms | max ms | RSS after 1st run MiB | RSS peak MiB |
|---|---|---|---|---|---|
| core, typical | 238 | 252 | 270 | 271 | 274 |
| core, all-error | 257 | 299 | 301 | 234 | 529 |
| full API upload, typical | 267 | 309 | 322 | 299 | 588 |
| full API upload, all-error | 273 | 308 | 320 | 256 | 586 |

Heap capped at 256 MiB (`npm run bench -- --heap-mib 256`):

| Scenario | p50 ms | p95 ms | max ms | RSS after 1st run MiB | RSS peak MiB |
|---|---|---|---|---|---|
| core, typical | 261 | 279 | 303 | 268 | 312 |
| core, all-error | 281 | 294 | 303 | 235 | 311 |
| full API upload, typical | 300 | 315 | 337 | 304 | 317 |
| full API upload, all-error | 314 | 325 | 325 | 247 | 333 |

- **Time (NFR-1, AC-40):** met with a factor of 15 or more to spare. "Full API upload" includes the multipart parse, SHA-256, validation, cleaning, the file write and the database insert.
- **AC-41:** on the all-error file every run held exactly 1000 errors while counting 964,747 exactly (`137,821 rows × 7`). The same property is asserted in `packages/core/test/bench-data.test.ts`.
- **NFR-2:** it says the server SHOULD stay under 512 MB resident. An early run of the benchmark showed 532–592 MiB peaks and looked like a failure. Two further runs showed it was not a leak: a single request needs about 234–304 MiB (including Node and the `tsx` loader), and a capped heap holds the sustained peak at or below 333 MiB over 20 runs. The uncapped drift is V8 declining to collect garbage while it has memory to spare. The benchmark therefore gates NFR-2 on the first-request peak and reports the sustained peak for information. Anyone running in a small container should set `--max-old-space-size`.
- These figures come from one machine. They show the design has a large margin, not what any other machine will do.

## 3. Differences from the documents

Things the build does that the SRS or design did not say, or says differently. Items 3.1 and 3.2 should become SRS v0.4 and a design v0.3; until then this section is the record.

### 3.1 Behaviour not in the SRS text (accepted when the milestone was reviewed)

| # | Behaviour | Where | Reason |
|---|---|---|---|
| 1 | Header cells containing `;` are quoted in the cleaned CSV. | `core/src/clean.ts` | Delimiter detection reads only the header. An unquoted `a;b;c` header can make a re-uploaded cleaned file detect `;` and misparse. FR-20 item 6 lists only `,`, `"`, CR and LF. |
| 2 | In a single-column file an empty value is written as `""`. | `clean.ts` | A bare empty line is dropped at the end of a file on re-read, silently losing rows. |
| 3 | Pass-through column **headers** are sanitized like cells; schema column headers never are. | `clean.ts` | A header such as `=cmd` would otherwise stay a live formula. FR-21 speaks only of cells. |
| 4 | Year `0000` is not a valid date. | `core/src/calendar.ts` | It is almost always a placeholder. FR-D3 does not mention it. |
| 5 | Schema `enum` entries for text must be non-empty, already trimmed and unique; enum messages list at most 10 entries. | `core/src/schema/definition.ts`, `rules/enum.ts` | A padded entry could never match a trimmed cell. |
| 6 | NFR-13's Host check compares the host **name** only, not the port. | `api/src/security.ts` | Rebinding is defeated by the name; this also works with port 0. The SRS says "expected loopback host/port". |
| 7 | An `ALLOWED_HOSTS` setting and a `WEB_DIST` setting exist. | `api/src/config.ts` | Needed to serve beyond loopback deliberately and to locate the built web app. |
| 8 | HTML responses carry a strict Content-Security-Policy. | `api/src/static.ts` | Cheap hardening for the served SPA. |

### 3.2 Changes from the design document

| # | Design said | What was built | Reason |
|---|---|---|---|
| 1 | `csv-parse` (provisional, D-12) | A hand-written RFC 4180 parser in `core/src/parse.ts` | The M4 spike showed `csv-parse` corrupts data on mixed line endings, throws on a stray quote such as `5" pipe`, and treats blank lines as records. |
| 2 | `migrations/001_init.sql` | SQL as strings in `api/src/db/migrations.ts` | `tsc` does not copy `.sql` files into `dist/`. |
| 3 | `vitest.workspace.ts` | `vitest.config.ts` with `test.projects` | Vitest 5 removed the workspace file. |
| 4 | TypeScript latest | TypeScript `~6.0.3` | `typescript-eslint` supports `<6.1.0`; TypeScript 7.x breaks lint. |
| 5 | `better-sqlite3` (no version) | `^12.11.1` | 13.x segfaults on `new Database(':memory:')` with Node 22.13.0 on arm64. |
| 6 | `re2` (no version) | `^1.27.0` | 1.26.0 and earlier have published advisories; the first install resolved 1.24.1. |
| 7 | Web app built through `tsc -b` | Built with Vite; only `core` and `api` use `tsc -b` | A Vite app does not emit declarations. |
| 8 | §11 item 2: "a cell failing `type` does not claim its unique key" | The behaviour is the same, but the claim cannot be observed | A value that fails its type can never equal a type-valid key. What the tests pin down is that a type failure stops the cell before `unique`. The design text should say so. |
| 9 | Default route `/` is not specified | `/` redirects to Validate | It is the main action; it points to schema creation when none exists. |
| 10 | The roadmap lists no root scripts | `npm start` (`scripts/start.mjs`) and `npm run dev`; the default data directory is now `<repo>/data` whatever the working directory | Requested at M14. |

### 3.3 Where the SRS was already updated

FR-7 was clarified in SRS v0.3: an oversize file is `413 FILE_TOO_LARGE` and creates no run, while every other file-level failure creates a run with `status: "failed"`.

### 3.4 Defects found in our own work along the way

Kept here because they show what the checks catch.

- The test for "a type failure does not claim its unique key" passed even with the behaviour removed. A mutation check exposed it and the test now pins the real behaviour (M7).
- AC-38 had no test that cited it, although the milestone summary implied coverage. The trace script in §5 found it; a flow test was added (M15).
- 45 temporary directories leaked from the API tests, because tests that started several apps closed only the last. Found while benchmarking; fixed so every app is tracked and closed (M15).
- An early benchmark counted the data generator's memory as the server's. The generator now runs in the orchestrator and workers read the file (M15).

## 4. Traceability

Evidence is cited as file names. Source files are under `packages/<package>/src`, tests under `packages/<package>/test`. "Met" means implemented and covered by an automated test unless the row says otherwise. The mapping was generated by searching the code and tests for each requirement ID and then checked by hand; every AC is cited by at least one test.

Abbreviations: `core` = `packages/core`, `api` = `packages/api`, `web` = `packages/web`.

### 4.1 Functional requirements: schemas, upload and parsing

| ID | Implementation | Verified by | Status |
|---|---|---|---|
| FR-1 | `api/db/schemas.repo.ts` (case-insensitive unique key), `api/routes/schemas.routes.ts`, `core/schema/definition.ts` (name length) | `schemas.routes.test`, `schema.test`, `db.test` | Met |
| FR-2 | `api/routes/schemas.routes.ts` | `schemas.routes.test` | Met |
| FR-3 | `core/schema/definition.ts` (strict object, name and type) | `schema.test` | Met |
| FR-4 | `core/schema/validate.ts`, `definition.ts`; issues shown by `web/schemaForm.ts`, `ColumnRuleForm.tsx` | `schema.test`, `regex-re2.test`, `schemas.routes.test`, `SchemaEditor.test` | Met |
| FR-5 | `api/routes/schemas.routes.ts`; no foreign key from runs to schemas | `schemas.routes.test`, `runs.routes.test`, `db.test` | Met |
| FR-6 | `api/routes/validations.routes.ts` | `validations.test`, `smoke.mjs` | Met |
| FR-7 | `validations.routes.ts` (`MAX_UPLOAD_BYTES`, 413, no run) | `validations.test` (exactly 10 MiB accepted, +1 byte rejected), `smoke.mjs` | Met |
| FR-8 | `core/process.ts` (`FILE_EMPTY`) | `process.test`, golden `empty-file`, `validations.test` | Met |
| FR-9 | `core/decode.ts` | `decode.test`, `clean.test`, `validations.test` | Met |
| FR-10 | `core/delimiter.ts` | `delimiter.test`, `parse.test` | Met |
| FR-11 | `core/parse.ts` | `parse.test`, golden `crlf-bom-trailing`, `semicolon-quoting` | Met |
| FR-12 | `core/header.ts` | `header.test`, `process.test`, golden `missing-column`, `duplicate-column` | Met |
| FR-13 | `core/process.ts` (`COLUMN_COUNT_MISMATCH`) | `process.test`, golden `mixed-errors` | Met |
| FR-14 | `core/parse.ts`, `process.ts` (`PARSE_ERROR`) | `parse.test`, `process.test`, golden `parse-error`, `validations.test` | Met |

### 4.2 Functional requirements: validation, cleaning, persistence, UI

| ID | Implementation | Verified by | Status |
|---|---|---|---|
| FR-15 | `core/process.ts` | `process.test`, golden files | Met |
| FR-16 | `core/process.ts` (trim before rules) | `process.test`, `clean.test` | Met |
| FR-17 | `core/process.ts` (pure, no clock or randomness; lint-enforced) | `clean.test` (three time zones), `properties.test` | Met |
| FR-18 | `core/process.ts`, `report.ts` | `process.test` (5000-error file), `bench-data.test` | Met |
| FR-19 | `core/process.ts` | `process.test` (row, column, rule order) | Met |
| FR-20 | `core/clean.ts`, `process.ts` | `clean.test`, golden files | Met, with extensions 3.1 #1 and #2 |
| FR-21 | `core/clean.ts` | `clean.test`, golden `sanitization`, `runs.routes.test` (download) | Met, with extension 3.1 #3 |
| FR-21a | `core/clean.ts` | `clean.test` (25 columns), golden `clean-basic` | Met |
| FR-21b | `core/process.ts`, `clean.ts` | `clean.test`, golden `all-invalid` | Met |
| FR-22 | `api/services/validation.service.ts`, `db/runs.repo.ts` | `validations.test`, `runs.routes.test` | Met |
| FR-23 | `validation.service.ts`, `storage/cleaned-files.ts` | `validations.test` | Met |
| FR-24 | `api/routes/runs.routes.ts`, `runs.repo.ts` (keyset) | `runs.routes.test`, `History.test` | Met |
| FR-25 | `runs.routes.ts` (detail, errors, download) | `runs.routes.test`, `RunDetail.test`, `smoke.mjs` | Met |
| FR-26 | `core/report.ts`, `api/db/runs.repo.ts` | `process.test`, `validations.test`, `runs.routes.test`, `bench-data.test`, `bench.ts` | Met |
| FR-27 | `runs.routes.ts` (delete), `storage/cleaned-files.ts` | `runs.routes.test`, `History.test`, `RunDetail.test` | Met |
| FR-28 | `web/pages/*`, `web/components/*` | `Schemas.test`, `SchemaEditor.test`, `Validate.test`, `RunDetail.test`, `History.test`, `flow.test` | Met (component level) |
| FR-29 | `web/components/TruncationNotice.tsx` | `RunDetail.test`, `flow.test` | Met |
| FR-30 | `web/schemaForm.ts` shapes input only; the client validates nothing | `boundaries.test`, `schemaForm.test` | Met |
| FR-31 | `api/routes/*`, `errors.ts` (Ajv for transport, Zod from `core` for schemas) | `schemas.routes.test`, `validations.test`, `runs.routes.test`, `app.test` | Met |
| FR-32 | `core` purity: `eslint.config.js`, `.dependency-cruiser.cjs`, `RegexEngine` port | `boundaries.test`, lint, `regex.test` | Met |

### 4.3 Functional requirements: rule specifications

| ID | Implementation | Verified by | Status |
|---|---|---|---|
| FR-R1 | `core/rules/required.ts`, `process.ts` | `rules-scalar.test`, `process.test` | Met |
| FR-T1 string | `core/rules/types.ts` | `rules-scalar.test` | Met |
| FR-T2 integer | `types.ts` (safe-integer range) | `rules-scalar.test` | Met |
| FR-T3 decimal | `types.ts` | `rules-scalar.test` | Met |
| FR-T4 boolean | `types.ts` | `rules-scalar.test` | Met |
| FR-T5 email | `types.ts` (254-character limit) | `rules-scalar.test` | Met |
| FR-T6 date | `core/rules/date.ts` | `rules-date.test` | Met |
| FR-P1 | `core/regex.ts` (`^(?:…)$`), `rules/pattern.ts`, `api/regex-re2.ts` | `regex.test`, `regex-re2.test`, `rules-constraints.test` | Met |
| FR-P2 | `core/schema/validate.ts`, `definition.ts` (500-character cap), `api/regex-re2.ts` (names the construct) | `schema.test`, `regex-re2.test`, `schemas.routes.test` | Met |
| FR-P3 | `core/regex.ts` (port), `api/regex-re2.ts` | `regex.test`, `regex-re2.test`, `native-regex-engine` test double | Met |
| FR-M1 | `core/rules/range.ts` (numbers) | `rules-constraints.test` | Met |
| FR-M2 | `range.ts` (length in code points) | `rules-constraints.test` | Met |
| FR-M3 | `range.ts` (ISO dates) | `rules-constraints.test` | Met |
| FR-M4 | `core/schema/definition.ts` (`min` ≤ `max`) | `schema.test` | Met |
| FR-E1 | `core/rules/enum.ts` | `rules-constraints.test` | Met, with extension 3.1 #5 |
| FR-D1 | `definition.ts` (`DATE_FORMATS`) | `schema.test` | Met |
| FR-D2 | `rules/date.ts` (canonical ISO always accepted) | `rules-date.test`, `clean.test` | Met |
| FR-D3 | `date.ts` (fixed width, real calendar) | `rules-date.test`, `calendar.test` | Met, with extension 3.1 #4 |
| FR-D4 | `date.ts` (declared format only, no guessing) | `rules-date.test` | Met |
| FR-D5 | `date.ts` (`INVALID_DATE`) | `rules-date.test`, golden `mixed-errors` | Met |
| FR-D6 | `date.ts`, `process.ts` (ISO output) | `clean.test`, golden `clean-basic` | Met |
| FR-U1 | `core/unique.ts`, `process.ts` (normalised comparison, dates by ISO) | `process.test` | Met |
| FR-U2 | `process.ts` (empty values exempt) | `process.test` | Met |
| FR-U3 | `unique.ts` | `process.test` | Met |
| FR-U4 | `process.ts` | `process.test` (first row claims the key even if invalid elsewhere) | Met |
| FR-U5 | `process.ts` (independent per-column constraints; no composite keys) | `process.test` (two columns collide on one row) | Met |
| FR-ER1 | `core/report.ts` (`RowError`) | `process.test`, `runs.routes.test` | Met |
| FR-ER2 | `core/rules/issue.ts` (`truncateValue`) | `rules-scalar.test`, `process.test` | Met |
| FR-ER3 | `issue.ts` (`quoteValue`), `api/errors.ts` | `rules-scalar.test`, `logging.test` | Met |
| FR-ER4 | `core/report.ts`, `process.ts`, `api/routes/present.ts` | `process.test`, `runs.routes.test` | Met |
| FR-ER5 | `report.ts`, database `CHECK` constraint | `process.test`, `properties.test`, `db.test` | Met |
| FR-ER6 | `process.ts`, `validation.service.ts` | `validations.test`, `process.test` | Met |

### 4.4 Functional requirements: persistence

| ID | Implementation | Verified by | Status |
|---|---|---|---|
| FR-DB1 | `api/db/connection.ts` (`better-sqlite3`) | `db.test` | Met |
| FR-DB2 | `migrations.ts` (no foreign key to schemas) | `db.test`, `runs.routes.test` | Met |
| FR-DB3 | `validation.service.ts`, `cleaned-files.ts` (temp, fsync, rename; cleanup; sweep), `runs.repo.ts` (transaction), `startup.ts` | `validations.test` (trigger-injected failures), `cleaned-files.test`, `runs.routes.test` | Met |
| FR-DB4 | the upload exists only as a request buffer | `validations.test` | Met |
| FR-DB5 | `connection.ts`, `migrations.ts` | `db.test` | Met |
| FR-DB6 | `cleaned-files.ts` | `cleaned-files.test`, `runs.routes.test` | Met |
| FR-DB7 | `connection.ts` | `db.test` | Met |

### 4.5 Non-functional requirements

| ID | Implementation and evidence | Status |
|---|---|---|
| NFR-1 performance | p95 252–309 ms for 10 MiB (typical and all-error, core and full API); `scripts/bench.ts`, `bench-data.test`. See §2.1. | Met |
| NFR-2 memory | First request 234–304 MiB; the error list is capped (`report.ts`); sustained RSS depends on V8 heap, see §2.1. | Met, with caveat |
| NFR-3 determinism | No `Date`, `Math.random`, `Intl` or locale calls in `core` (lint rule); `clean.test` (time zones), `properties.test`, golden files. | Met |
| NFR-4 idempotence | `clean.test`, `properties.test`: cleaned output revalidates with zero errors and reproduces itself. Limits are documented (sanitising adds a character). | Met |
| NFR-5 purity | `core` has no I/O, clock, randomness or native modules; ids and times are assigned by the API. Lint and `boundaries.test`. | Met |
| NFR-6 testability | Core coverage 99.75% lines; every error code is produced by a test (`golden.test`, plus `FILE_TOO_LARGE` in `validations.test`); API tests run on in-memory SQLite. | Met |
| NFR-7 type safety | `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); shared types come from `core`; typecheck passes. | Met |
| NFR-8 security | Upload limit enforced as the stream is read (`@fastify/multipart` limits); bind to `127.0.0.1` by default (`config.test`, `smoke.mjs`); sanitisation on every download (`runs.routes.test`). | Met |
| NFR-9 privacy | Logs hold ids, routes, status and timings; `logging.test` and `validations.test` push secret values through query, path, body, headers, errors and an upload and assert they never appear. | Met |
| NFR-10 usability | Labelled controls, `role` and `aria` attributes asserted in component tests, responsive CSS. No keyboard-order test, no audit, no real-browser check. | Partly verified |
| NFR-11 portability | `npm install && npm test` works on macOS (Apple silicon) with Node 22.13. Not run elsewhere. | Partly verified |
| NFR-12 observability | Request ids in logs, the `x-request-id` header and the error envelope; client-supplied ids are ignored (`app.test`). | Met |
| NFR-13 localhost hardening | `api/security.ts`, `static.ts`: Host check, Origin check on writes, strict CORS, download headers. `security.test`, `static.test`, `runs.routes.test`, `smoke.mjs`. | Met, with deviation 3.1 #6 |

### 4.6 Acceptance criteria

| AC | Checks | Verified by | Status |
|---|---|---|---|
| AC-1 | Create then fetch is identical; duplicate names fail in any casing | `schemas.routes.test`, `schema.test` | Met |
| AC-2 | `min > max`, bad pattern, `dateFormat` on integer name column and property | `schema.test`, `schemas.routes.test`, `SchemaEditor.test` | Met |
| AC-3 | Editing or deleting a schema leaves old runs intact | `schemas.routes.test`, `validations.test`, `runs.routes.test`, `db.test` | Met |
| AC-4 | 10 MiB accepted, one byte more rejected | `validations.test`, `smoke.mjs` | Met |
| AC-5 | Same data in UTF-8, UTF-8 BOM, UTF-16, windows-1251 gives the same output; encoding recorded | `decode.test`, `clean.test` | Met |
| AC-6 | Delimiter detection | `delimiter.test` | Met |
| AC-7 | Quotes, commas and newlines round-trip | `parse.test`, `delimiter.test` | Met |
| AC-8 | Missing column fails; extra column passes through | `header.test`, `process.test`, golden files | Met |
| AC-9 | Wrong field count is a row error | `process.test`, `parse.test` | Met |
| AC-10 | Required and optional empties | `process.test`, `rules-scalar.test` | Met |
| AC-11 to AC-14 | Integer, decimal, boolean and email rules | `rules-scalar.test` | Met |
| AC-15 | Pattern matches the whole value | `rules-constraints.test`, `regex.test` | Met |
| AC-15a | Lookahead, lookbehind, backreference and over-long patterns rejected | `schema.test`, `regex-re2.test` (real RE2), `schemas.routes.test` | Met |
| AC-16 | `min`/`max` | `rules-constraints.test` | Met |
| AC-17 | `enum` | `rules-constraints.test` | Met |
| AC-18 | Strict dates and formats | `rules-date.test` | Met |
| AC-19 | ISO accepted in every date column and normalised | `rules-date.test`, `clean.test` | Met |
| AC-20 | Unique, case-sensitive, dates by value | `process.test` | Met |
| AC-21 | Trimming | `clean.test` | Met |
| AC-21a | 25-column file with a 3-column schema keeps all columns | `clean.test`, golden files | Met |
| AC-22 | Only valid rows, in order | `clean.test`, `properties.test` | Met |
| AC-23 | Header only when every row is invalid | `clean.test`, `bench-data.test`, golden `all-invalid` | Met |
| AC-24 | Formula sanitisation, numeric columns exempt, count reported | `clean.test`, golden `sanitization` | Met |
| AC-25 | UTF-8, no BOM, LF, quoting only when needed | `clean.test` | Met |
| AC-26 | Byte-identical output across runs and time zones | `clean.test`, `properties.test` | Met |
| AC-27 | Cleaned output revalidates with zero errors | `clean.test`, `properties.test` | Met |
| AC-28 | Error order and fields | `process.test` | Met |
| AC-29 | 5000 errors: exact total, 1000 stored, `truncated` | `process.test`, `runs.routes.test`, `RunDetail.test` | Met |
| AC-30 | Report invariants | `process.test`, `properties.test` | Met |
| AC-31 | Values truncated to 200 characters | `process.test`, `rules-scalar.test` | Met |
| AC-32 | Run retrievable with snapshot, errors and byte-identical download | `validations.test`, `runs.routes.test` | Met |
| AC-33 | Raw upload never retained | `validations.test` | Met |
| AC-34 | History newest first, paginated | `runs.routes.test`, `History.test` | Met |
| AC-35 | Failed run download is 404 | `runs.routes.test` | Met |
| AC-36 | No partial run and no orphan after a failed write; sweep clears orphans | `validations.test`, `cleaned-files.test`, `runs.routes.test` | Met |
| AC-36a | Delete removes rows and file; relative path only; WAL on | `runs.routes.test`, `db.test` | Met |
| AC-37 | API error statuses | `schemas.routes.test`, `validations.test`, `runs.routes.test` | Met |
| AC-38 | UI: create a schema, upload, see summary and errors, download, truncation notice | `flow.test`, `SchemaEditor.test`, `Validate.test`, `RunDetail.test`; API half in `smoke.mjs` | Partly verified (§1) |
| AC-39 | Package boundaries | lint, `boundaries.test`, `regex.test`; `core` tests run on a non-RE2 engine | Met |
| AC-40 | 10 MiB in at most 5 s at p95 over 20 runs, all-error included | `scripts/bench.ts`, `bench-data.test` | Met |
| AC-41 | At most 1000 errors held, exact counts | `scripts/bench.ts`, `bench-data.test` | Met |
| AC-42 | Coverage 90% or more; every error code exercised | coverage run, `golden.test`, `validations.test` | Met |
| AC-43 | Loopback by default; no cell values in logs | `config.test`, `smoke.mjs`, `logging.test`, `validations.test` | Met |
| AC-44 | Foreign Host and Origin get 403; CORS; download headers | `security.test`, `static.test`, `runs.routes.test` | Met |

## 5. How the trace was produced

A throwaway script collected the 133 identifiers from the bold IDs in `01-srs.md`, then searched every `.ts`, `.tsx` and `.mjs` file for each one. It showed that every AC is cited by at least one test, after one gap (AC-38) was closed. Roughly 30 FR and NFR identifiers are not cited by name anywhere in the code; for those the mapping above was made by reading the code, and the test file named is the one that exercises the behaviour. The script is not kept in the repository.

## 6. What was achieved

- A working tool that does what the problem statement asked: reusable schemas, 10 MiB uploads, a granular error report, a deterministic cleaned download, and a history.
- A `core` library with no I/O that carries all the logic, tested down to individual rules, with golden files, property tests and mutation checks.
- A hardened local API and a small React app, served from one port.
- Measured performance with a large margin, and a smoke script that proves the built product works end to end.

## 7. Technical debt and v2 candidates

In rough order of value:

1. **Worker threads** for validation, so a run no longer blocks the event loop. `processCsv` is already a pure function of bytes, so this is mechanical (design §9).
2. **A real-browser test and an accessibility pass** (for example Playwright and axe), to close NFR-10 and AC-38.
3. **CI on Linux and macOS**, to close NFR-11 and to run `bench` and `smoke` on every change.
4. **Sync the documents**: SRS v0.4 for §3.1 above, design v0.3 for §3.2.
5. **Streaming parsing and writing** for files beyond 10 MiB; the unique-value map then becomes the memory driver.
6. **Retention**: an expiry or a "delete runs older than N days" action and a disk-usage view, since runs are kept forever.
7. **Export of all errors**, not just the first 1000, and a manual encoding override.
8. **Schema inference**: suggest a schema from a sample file using deterministic statistics, never silently applied.
9. **`.xlsx` input**, **composite unique keys**, optional **case normalisation**.
10. **Authentication and multi-tenancy** if it ever leaves a single machine.
11. **A dry-run endpoint for patterns**, so the schema builder can flag an unsupported regex before saving.
12. Revisit the `better-sqlite3` pin when a Node patch release fixes the 13.x crash.
