# 00 — Problem Definition: CSV Validator & Cleaner

Status: Draft v0.1

## 1. Problem

Analysts, finance operators, and developers routinely receive CSV files from external partners and legacy systems. These files are frequently malformed:

- Mixed date formats within one column (`2024-03-01`, `03/01/2024`, `1 Mar 24`)
- Duplicate identifiers
- Missing required fields
- Inconsistent casing (`USD`, `usd`, `Usd`)
- Leading/trailing whitespace

The common workaround is manual repair in Excel. This is:

- **Tedious**: scales linearly with file size and number of files.
- **Error-prone**: Excel silently reinterprets dates, strips leading zeros, and coerces types.
- **Unrepeatable**: the same partner sends the same defects every month, and the fix is redone from scratch.
- **Unauditable**: there is no record of what was changed, by whom, or why.

## 2. Goal

A standalone tool that lets a user define the expectations for a CSV once (a schema), then repeatedly validate and clean files against it, with a precise error report and a persistent history.

## 3. Target Users

| User | Primary need |
|---|---|
| Analyst | Trust the data before analysis; know exactly what is wrong |
| Finance operator | Repeatable monthly partner-file intake with an audit trail |
| Developer | Deterministic, scriptable validation/cleaning that can sit in a pipeline |

## 4. v1 Scope

1. **Reusable validation schemas**: create, view, update, and delete named schemas describing columns and rules.
2. **Upload**: CSV files up to 10 MB.
3. **Validation**: returns a granular error report; each error has `row`, `column`, `code`, `message`.
4. **Cleaned download**: a deterministically cleaned CSV:
   - trimmed whitespace
   - dates normalized to ISO 8601
   - duplicate keys removed (rule for which row survives must be fixed and documented)
5. **Validation history**: a list of past validation runs and their results.

## 5. Non-Goals (v1)

- Multi-tenant auth / user accounts
- `.xlsx` / Excel input
- Background job queues (processing is synchronous within the request)
- "AI-magic" cleaning. Cleaning is strictly rule-based and deterministic.

## 6. Success Criteria

- **Determinism**: same input + same schema version always yields byte-identical cleaned output and an identical error report.
- **Completeness**: every defect class listed in §1 is detectable and has a stable error code.
- **Performance**: a 10 MB file validates within a bounded time (target to be set in the SRS, e.g. p95 < 5 s on a laptop-class machine).
- **Auditability**: any past run can be traced to the schema version and input it used.
- **Testability**: validation and cleaning logic is pure and unit-testable without I/O.

## 7. Constraints and Assumptions

- Single deployment, no auth: assumed to run locally or on a trusted internal network.
- Synchronous processing only; 10 MB bound is what makes this viable.
- Input is untrusted: malformed quoting, odd encodings, huge cells, and CSV-injection payloads must not crash the tool or be echoed unsafely.

## 8. Open Technical Questions

These should be resolved before writing the SRS. Recommended defaults are given so we can decide quickly.

### A. Product behavior

1. **Which defects are auto-fixed vs. only reported?**
   Trimming is clearly a fix. Duplicates and ambiguous dates are riskier. *Recommendation:* the cleaned file applies only unambiguous, schema-declared fixes; everything else remains an error in the report.
2. **Ambiguous dates (`03/04/2024`: March 4 or April 3?).**
   *Recommendation:* each date column in the schema declares its accepted input format(s) explicitly; no guessing. A value matching none is an error, not a silent fix.
3. **Duplicate key policy: which row survives?**
   *Recommendation:* keep the first occurrence, report the removed rows. Alternative: keep last, or fail instead of dropping. Must be a schema option or a fixed rule.
4. **What happens to rows with errors in the cleaned CSV?** Included as-is, excluded, or does download get blocked?
   *Recommendation:* the cleaned file contains only rows that pass; rejected rows are listed in the report (optionally downloadable as a separate rejects file).
5. **Casing normalization:** is it per-column configurable (upper/lower/title/none)? *Recommendation:* yes, explicit per column; default none.
6. **Is missing-required-field a hard fail or a warning?** Do we need severity levels (error vs. warning)?

### B. Schema model

7. **Schema format and expressiveness.** Column name, type (string, int, decimal, date, enum, boolean), required, unique, pattern, min/max, allowed values, casing. Is a JSON document enough or do we want a DSL?
   *Recommendation:* JSON, validated by a JSON Schema / Zod definition. No custom DSL.
8. **Schema versioning.** If a schema is edited, do history records point at the old version? *Recommendation:* immutable versions; a run references `schema_id + version`.
9. **Header handling:** strict column match, extra columns allowed, reordered columns, case-insensitive header match?

### C. CSV parsing edge cases

10. **Encoding and delimiter:** UTF-8 only? BOM handling? Auto-detect `;` / tab, or require declared delimiter? *Recommendation:* UTF-8 (with BOM stripped); delimiter is configurable on the schema, default `,`.
11. **Line endings and quoting:** normalize output to `\n` or `\r\n`? Always quote, or quote only when needed?
12. **Row limit** in addition to the 10 MB limit (very wide or very narrow rows change memory use).
13. **CSV/formula injection:** do we neutralize cells starting with `=`, `+`, `-`, `@` in cleaned output? This conflicts with "don't alter data". *Recommendation:* report as a warning; do not alter by default.

### D. Architecture and stack

14. **Runtime and form factor:** web app with an API, CLI, or both? A shared core library with thin API/CLI wrappers is the most testable shape. *(Assuming Node/TypeScript given the vitest mention; please confirm.)*
15. **Parsing strategy:** streaming parser vs. load-in-memory. At 10 MB, in-memory is simpler and fine, but it should be hidden behind an interface so it can change.
16. **Persistence:** SQLite vs. Postgres vs. flat files for schemas and history. *Recommendation:* SQLite for v1 (zero-ops, transactional).
17. **Are uploaded and cleaned files stored?** History needs at least metadata and the error report. Storing the files enables re-download but adds retention and privacy concerns. Options: store nothing, store with a TTL, or store indefinitely.
18. **Error report size:** a bad 10 MB file could produce hundreds of thousands of errors. Cap and paginate? Return aggregated counts plus the first N? Downloadable full report?
19. **Idempotency/caching:** hash the input to dedupe repeated uploads?

### E. Non-functional

20. **Performance target** for the 10 MB case (see §6).
21. **Privacy:** the data may be financial. Without auth, what are the minimum safeguards (bind to localhost by default, no logging of cell contents)?

## 9. Proposed Next Steps

1. You answer or override the recommendations in §8 (especially A1-A4, B7-B8, C10, D14, D16, D17).
2. `docs/01-design.md`: architecture and trade-offs for the chosen options.
3. `docs/02-srs.md`: numbered functional requirements, error-code catalog, and acceptance criteria.
4. Implementation in small, test-first increments, starting with the pure core (parse, validate, clean).
