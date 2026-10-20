# 04 — AI Usage: how the work was split

This project was built by one engineer (the author) working with an AI coding assistant (Claude, running as Claude Code). This note records who decided what, what the assistant was good and bad at, and what the author should be able to explain. The assistant drafted it from the session record, so the author should read it critically and correct anything that does not match their memory.

## 1. How we worked

The author set the rules at the start and kept them throughout:

- **The author is the lead engineer; the assistant is a pair programmer.** The author owned architecture and product decisions. The assistant proposed, built and verified.
- **Document first.** Problem definition, then requirements (SRS), then design, then a milestone roadmap, then code. Each document was reviewed and committed by the author before the next began.
- **One milestone at a time.** The assistant wrote code and tests and ran typecheck, lint, formatting, tests and build until green. It then stopped with a summary and a suggested commit message and waited for the author's go-ahead.
- **The assistant never ran `git add`, `commit` or `push`.** The author reviewed every diff and made every commit. A shell hook also blocked those commands.
- **Comment style set by the author:** selective comments that cite requirement IDs, JSDoc of one or two lines, acceptance-criteria IDs in test names.

## 2. Who decided what

| Area | Decided by the author | Proposed or built by the assistant |
|---|---|---|
| Product scope | v1 scope, the non-goals (no auth, no `.xlsx`, no queues, no "AI" cleaning) | Turned it into the problem definition and a list of open questions with recommended defaults |
| Cleaning behaviour | Auto-fix only unambiguous things; every date column must also accept ISO so a cleaned file passes its own schema; duplicates keep the first row; invalid rows are excluded; every run snapshots its schema; cap of 1000 stored errors with exact counts; formula sanitising | Drafted the rules, the error catalogue and the report model |
| Encoding | Auto-detect the delimiter; support windows-1251 and UTF-16 as well as UTF-8; always export UTF-8 | Specified the detection order and recorded the detected encoding on every run |
| The key correction | **Preserve all original columns, in order, including ones not in the schema.** The assistant's draft had dropped them. | Updated the SRS, added the `DUPLICATE_COLUMN` file error and sanitising of pass-through cells (the author accepted both) |
| Stack and shape | npm workspaces with `core`, `api`, `web`; Fastify; React + Vite; SQLite; RE2; Zod as the single schema definition; cleaned files on disk, not in the database; inline processing for v1 | Reviewed the plan and raised five concerns (§3); wrote the design document with diagrams and trade-offs |
| Inline vs worker threads | **Inline.** The assistant had recommended worker threads from the start; the author chose the simpler design and had the worker path documented as the v2 step. | Documented the upgrade path |
| Security | Added the localhost hardening requirement | Raised the point that loopback alone does not stop a web page from driving an unauthenticated local API |
| Process | The milestone protocol, Prettier from the start, Node version, comment and JSDoc style, the roadmap's home in the design document, the `start` and `dev` scripts, the scope of M15 | Wrote the roadmap and the code |
| Code and tests | Reviewed and committed each milestone | Wrote all code, tests, scripts and (apart from the decisions above) the documents |

## 3. Where the assistant helped most

- **Spikes before commitments.** The `csv-parse` spike (M4) showed it corrupts data on mixed line endings and rejects ordinary quotes, so the parser was written by hand. Measuring beat assuming.
- **Raising risks early.** The RE2 dialect change, the `RegexEngine` port, the localhost cross-origin risk, the tension between formula sanitising and re-uploading a cleaned file, and the unique-key edge cases were all raised before they became code.
- **Checking its own tests.** After several milestones the assistant broke the code on purpose to confirm a test failed. That found a test that passed with the behaviour removed (§4) and confirmed the rest.
- **Reading generated output.** Every golden file was read by hand before it was accepted as the oracle.
- **Environment problems found by running things.** The newest `better-sqlite3` crashed on this machine's Node; `re2` had advisories; `typescript-eslint` did not support the newest TypeScript. All were caught by installing and running, then pinned and recorded.
- **Honest benchmarking.** An early run looked like it broke the memory budget. Instead of tuning to a number, the assistant separated "one request needs this much" from "V8 is slow to collect garbage", showed both, and changed what the benchmark gates.

## 4. Where the assistant went wrong

Listed plainly, because the author needs to know which parts of the repository deserve extra scrutiny.

**A destructive mistake.** During M14 the assistant smoke-tested `npm start`, saw that `./data` already existed, ran against it, and then deleted it as "cleanup". That directory was git-ignored and probably held the author's own test schemas and runs from trying the UI; it cannot be recovered. The lesson is simple: clean up only what you created. The assistant used throwaway directories for every check after that.

**Tests it got wrong first time.** Each was caught by running the tests, a mutation check or review, not by the assistant's first reading of its own work:

- a test for "a type failure does not claim its unique key" that passed without the behaviour (M7);
- an email-length test with wrong arithmetic (M5);
- a test claiming "all problems are reported at once" when the validator reports structure first and patterns second (M10);
- a test helper that did not mirror what the server does at start-up (M11);
- a user-event call that treated `[` as key syntax, and a reused `Response` body (M13, M14);
- AC-38 described as covered when no test cited it; found by the trace script in M15;
- 45 leaked temporary directories from the API tests; found while benchmarking in M15.

**Assumptions that cost time.** The assistant did not check native-module and Node compatibility before installing (the `better-sqlite3` crash, the `re2` advisory). It also wrote a design note, "a type failure does not claim its unique key", that describes behaviour nobody can observe.

**Process slips.**

- Twice the author replied with a bare "Approved" and the assistant took it as "proceed to the next milestone" rather than asking. The author's protocol was stricter than that reading.
- A shell command was blocked by a hook because the text mentioned git commands inside a here-document, even though no git command was run. The assistant reworded it.
- Early milestone summaries sometimes said more than the evidence supported. The validation report in this milestone is stricter.
- The web app was never looked at in a real browser: the browser extension was not connected when the assistant tried. The UI is covered by component tests and a scripted HTTP check only, and the docs say so.

**Port collisions.** The author asked about these. In this project's record the assistant did not hit one: its checks used separate fixed ports (3917 to 3920) and it checked that 3001 and 5173 were free before running the dev servers. That is luck and care, not a safeguard. Nothing in the product handles a busy port: if 3001 is taken, `npm start` fails to start and `npm run dev` fails on the API, and the Vite proxy target is hard-coded to 3001. This is not documented as a limitation beyond the `PORT` setting, and it should be.

## 5. What the assistant did not do

It did not commit, push or publish anything. It did not make product decisions: where the SRS was silent it proposed a default and asked, and the author's answers are what is built. It did not run the application in a real browser. It cannot tell whether the author understands the code; §6 is a checklist, not a claim.

## 6. What the author should be able to explain

If someone asks about this project, these are the things the author should be able to answer from memory. Each points at where to look.

1. **Why `core` is pure.** No I/O, no clock, no randomness, no native modules, and the regex engine is injected. What does that buy (determinism, tests without a server, a web package that cannot pull in native code), and how is it enforced (`eslint.config.js`, `.dependency-cruiser.cjs`)?
2. **Why RE2, and what it costs.** Linear-time matching removes ReDoS, but there is no lookahead, lookbehind or backreference. Why patterns are compiled twice (raw, then wrapped as `^(?:…)$`) in `core/src/regex.ts`.
3. **How one cell is judged.** The rule order in SRS §3.1: trim, required, type, then pattern, enum and range, then unique. Why empty optional cells skip everything, and why the first occurrence claims a unique key even if its row is invalid elsewhere.
4. **What the cleaned file guarantees and what it does not.** Trimmed schema columns, ISO dates, only valid rows, all original columns kept, formulas neutralised. Why re-uploading it usually produces zero errors, and the cases where it cannot (a strict `max` length or `pattern` on a cell that started with `=`).
5. **Why pass-through columns exist** and the three extra behaviours around them: sanitised cells, sanitised headers, quoted headers containing `;`.
6. **How a run is stored safely.** Snapshot the schema, write the cleaned file to a temp name, fsync, rename, then commit the database row, remove the file if the commit fails, sweep orphans at start-up. What happens if the power fails between each step?
7. **The security model of an unauthenticated local API.** Loopback bind, Host check against DNS rebinding, Origin check on writes, strict CORS, `nosniff` and attachment downloads, CSP, no values in logs. And what it does not protect against: anyone with access to the port.
8. **Why processing is inline** and what it costs (the event loop is blocked for about a third of a second per 10 MiB file), and what the worker-thread step would change.
9. **What the tests prove and what they do not.** Per-rule tests, golden files, properties, fault injection by database triggers, mutation checks. And the honest gaps: no real-browser test, no accessibility audit, macOS only, no CI.
10. **How to read the benchmark.** Fast (p95 about 0.3 s), memory per request about 250 MiB, and why uncapped repeated runs show about 590 MiB (V8 garbage-collection laziness, not a leak).
11. **The deviations from the written requirements.** `03-validation-report.md` §3 lists them; the SRS and design documents still say the old thing until they are synced.
12. **The mistakes in §4**, including the deleted `./data` directory.

Things the author should not claim: that the web app was tested in a real browser, that it runs on Linux or Windows, that it is safe on a shared network, or that the SRS and design documents match the final code.
