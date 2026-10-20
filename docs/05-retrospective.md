# 05 — Retrospective

A short look back at v1: what we built, what worked, what hurt, and what comes next.

## What we built

A schema-driven CSV validator and cleaner: a pure TypeScript `core`, a Fastify and SQLite API, and a React app, in about 11,000 lines including tests. 608 automated tests, 99.75% line coverage on `core`, 12 end-to-end smoke checks, and a 10 MiB file validated in about 0.3 s at p95. Fifteen milestones, each reviewed and committed by hand.

## What went well

- **Writing the problem, requirements and design first.** The SRS gave every later decision an ID to point at, and every acceptance criterion ended up with at least one test that names it. When the SRS was wrong it was cheap to fix (the dropped columns, the 413 rule) because it was still paper.
- **A pure core behind a port.** Because `core` does no I/O and takes its regex engine as an argument, 250 tests run in under a second with no server, determinism could be tested by running twice, and swapping in RE2 later touched no core code.
- **Measuring before choosing.** The CSV-parser spike, the native-module install check and the benchmark each overturned an assumption. Three of our dependency pins exist because something was run, not read about.
- **Distrusting green tests.** Breaking the code on purpose found a test that proved nothing. Reading each golden file by eye caught nothing wrong, which is the point of doing it.
- **One milestone at a time with a human commit.** Small diffs were easy to review, and the author stayed in control of what entered the repository.

## What hurt

- **Specs drifted from code.** Eight behaviours were added in implementation (header quoting, sanitised headers, a `""` for single-column blanks and others). Each was reviewed at the time, but the SRS and design were not updated, so they now disagree with the product. The validation report records it; fixing it is the first follow-up.
- **Environment surprises arrived late.** A crash in the newest `better-sqlite3`, advisories in `re2`, and a TypeScript version outside the linter's range all surfaced only at install time. A short "check the toolchain" step before each milestone that adds a dependency would have found them sooner.
- **Verification fell short of the claims in places.** AC-38 was described as covered before a test named it; the web app was never opened in a real browser; only one operating system was tried. These are listed in the validation report instead of being left implicit.
- **A careless deletion.** The assistant removed a `./data` directory it did not create. Small in effect, avoidable in principle; see `04-ai-usage.md`.
- **Tests leaked temporary files** until the benchmark milestone made it visible.

## What we learned

1. A requirement ID in a test name is cheap and makes the trace almost free; an ID nobody cites is a signal to look harder.
2. "Deterministic" is a property you can test: run it twice, in different time zones, on random input.
3. A benchmark number needs a story. 590 MiB and 250 MiB were both true; only one was the cost of a request.
4. Sanitising untrusted output has second-order effects (the cleaned file no longer equals its input, headers can be formulas, a `;` can change delimiter detection). Test the round trip, not just the output.
5. An unauthenticated local server is still a network service. Loopback stops other machines, not other web pages.
6. Decide where the docs live after the code changes, not before.

## Next steps

Ordered by value; the full list with reasons is in `03-validation-report.md` §7.

1. **Sync the documents** with the code (SRS v0.4, design v0.3). Small and unblocks everything else.
2. **CI on Linux and macOS** running lint, tests, build, `smoke` and `bench`, to close the portability gap and catch regressions.
3. **A browser test and an accessibility pass** (Playwright and axe) to close the two UI gaps.
4. **Worker threads for validation**, so one large upload no longer pauses every other request. Needed before more than one person uses it.
5. **Streaming for files over 10 MiB**, plus an export of every error rather than the first 1000.
6. **Retention**: expire old runs and show disk use.
7. **Schema auto-inference**: propose a schema from a sample file using deterministic statistics, shown to the user for approval and never applied silently. This keeps the "no AI magic in cleaning" rule intact while removing the blank-page problem.
8. **`.xlsx` input**, then composite unique keys and optional case normalisation.
9. **Authentication and multi-tenancy** only if it ever leaves a single machine.
