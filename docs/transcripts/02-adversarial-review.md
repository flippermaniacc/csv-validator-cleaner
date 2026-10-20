▗ ▗   ▖ ▖  Claude Code v2.1.304
           Sonnet 5.5 · Claude Pro
 ▘▘   ▝▝   ~/Desktop/Projects/csv-validator


❯ You are an adversarial Principal Software Engineer and Security Auditor       
  conducting a thorough, critical code review of this codebase.                 
                                                                                
  The project is a "CSV Validator & Cleaner" monorepo (packages/core,           
  packages/api, packages/web).                                                  
  Specifications are in docs/01-srs.md and design in docs/02-design.md.         
                                                                                
  Your goal is NOT to flatter or praise the code. Your goal is to find real     
  weaknesses, edge-case bugs, security vulnerabilities, or spec mismatches.     
                                                                                
  Specifically inspect:                                                         
  1. CSV parsing & decoding edge cases (RFC 4180 traps, encoding fallbacks,     
  delimiter sniffing).                                                          
  2. Rule evaluation invariants (date parsing, formula sanitization leaks,      
  uniqueness collisions).                                                       
  3. Security (ReDoS, Path traversal in cleaned files, CSV formula injection,   
  CORS, header spoofing).                                                       
  4. Fastify & SQLite concurrency (race conditions, file leaks, unhandled       
  rejections).                                                                  
  5. Any discrepancy between docs/01-srs.md requirements and the actual         
  TypeScript implementation.                                                    
                                                                                
  Provide a prioritized list of genuine technical concerns or potential bugs.   
  For each item, describe the scenario and how it could fail.                   

⏺ I'll start by mapping the source files and reading the spec.

⏺ Bash(git ls-files | grep -v -E 'package-lock|fixtures' | xargs wc -l
      2>/dev/null | sort -n | tail -80)
  ⎿        39 packages/core/src/decode.ts
           41 packages/core/src/delimiter.ts
           43 package.json
     … +77 lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

⏺ Now the core source files.

⏺ Bash(cd /Users/admin/Desktop/Projects/csv-validator/packages/core/src && for f
      in decode.ts delimiter.ts parse.ts header.ts process.ts clean.ts
      calendar.ts rules/*.t…)
  ⎿  === decode.ts
          1  export type DetectedEncoding = 'utf-8' | 'utf-16le' |
     'utf-16be'
      | 'windows-1251';
     … +742 lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

⏺ Core reviewed. Now schema definition, uniqueness, and the API layer.

⏺ Bash(cd /Users/admin/Desktop/Projects/csv-validator/packages && cat -n
      core/src/schema/definition.ts core/src/schema/validate.ts
      core/src/unique.ts core/src/errors.t…)
  ⎿       1  import { z } from 'zod';
          2  import { parseIsoDate } from '../calendar.js';
          3  import { MAX_PATTERN_LENGTH } from '../regex.js';
     … +365 lines (ctrl+o to expand)

⏺ Bash(cd /Users/admin/Desktop/Projects/csv-validator/packages/api/src && for f
      in config.ts security.ts app.ts errors.ts routes/validations.routes.ts
      services/validat…)
  ⎿  === config.ts
          1  import { resolve } from 'node:path';
          2  import { fileURLToPath } from 'node:url';
     … +514 lines (ctrl+o to expand)

⏺ Now the DB layer, run routes, startup, and static serving.

⏺ Bash(for f in routes/runs.routes.ts db/runs.repo.ts db/migrations.ts
      db/connection.ts db/schemas.repo.ts routes/schemas.routes.ts startup.ts
      main.ts static.ts routes…)
  ⎿  === routes/runs.routes.ts
          1  import { createReadStream } from 'node:fs';
          2  import { stat } from 'node:fs/promises';
     … +741 lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

⏺ Source read. Before listing concerns, I'll check a few suspicions empirically:
  memory and time on narrow-row files, RE2 cost on a huge cell, RE2 compile
  cost, and parser edge cases.

⏺ Bash(cd /Users/admin/Desktop/Projects/csv-validator && cat package.json | head
      -40; ls node_modules/.bin | grep -E '^(tsx|vitest|ts-node)$'; grep -rn
      "dangerouslySet…)
  ⎿  {
       "name": "csv-validator",
       "version": "0.0.0",
     … +59 lines (ctrl+o to expand)

⏺ Bash(S=/private/tmp/claude-501/-Users-admin-Desktop-Projects-csv-validator/b1a
      4a4ec-45ec-4eb7-bb78-0f7b73ae4214/scratchpad && cat > $S/probe.ts <<'EOF'
      import { proc…)
  ⎿  narrow-5M-rows completed 2503ms rssMB 1692 rows=5242000
     bigcell (?:a|b|ab)*c completed 190ms rssMB 1786 rows=1
     bigcell (?:[a-z]{1,50})*$x completed 206ms rssMB 1796 rows=1
     … +16 lines (ctrl+o to expand)
  ⎿  (timeout 5m)

⏺ I found no critical vulnerabilities. The real problems are in resource use,
  silent data corruption, and places where the spec itself is weak. I read all
  of core and api and ran a probe script at
  /private/tmp/claude-501/-Users-admin-Desktop-Projects-csv-validator/b1a4a4ec-4
  5ec-4eb7-bb78-0f7b73ae4214/scratchpad/probe.ts. I did not read packages/web
  closely, and I did not run the test suite. Nothing in the repo was changed.
  Each item is marked "verified" if the probe confirmed it, or "from reading" if
  it comes from reading the code only.

  High

  1. A 10 MiB file can use about 1.7 GB of memory (NFR-2, AC-41). Verified.
  - A single-column integer file of 1\n repeated 5.2M times ran in 2.5 s and the
    process reached about 1.7 GB RSS. The limit is 512 MB.
  - Each row is held several times over:
    - parseRecords builds a string[] per row.
    - const [headerRow, ...dataRows] at process.ts:74 copies the whole array.
    - record.slice() at process.ts:119 makes a second array per valid row.
    - cleanedRows holds all of them until serializeCleaned runs.
  - The cap on stored errors only bounds the error list, so it doesn't help
    here.
  - Because processCsv runs inline, two concurrent narrow-row uploads can
    exhaust the default heap.
  - Fix: iterate the records lazily and serialize cleaned rows as you go. Or cap
    the row count.

  2. A wrong encoding guess corrupts data without any warning (FR-9). Verified.
  - One stray non-UTF-8 byte makes the whole file fall back to windows-1251. In
    my test Привет became РџСЂРёРІРµС‚. Every row validated and the cleaned file
    is "UTF-8" with the mojibake saved in it (decode.ts:34-38).
  - With a UTF-8 BOM, invalid bytes become U+FFFD and are written into the
    cleaned file. The reported encoding is still utf-8 (decode.ts:30-32).
  - UTF-16 without a BOM is read as UTF-8 full of NUL bytes. The user gets a
    confusing MISSING_COLUMN for columns that are really there.
  - The encoding field on the Run is the only signal. Add a warning when the
    fallback is used or when U+FFFD appears. Add a NUL-byte check to catch
    BOM-less UTF-16.

  3. Formula sanitization has gaps and side effects (FR-21).
  - Verified: pass-through cells starting with \t or \r are not prefixed and
    reach the output intact (clean.ts:3 only checks = + - @). OWASP lists tab
    and CR as triggers. String columns are safe because they are trimmed first.
  - Verified: pass-through headers are sanitized and counted in sanitizedCells,
    so a header -note becomes '-note in the output. This conflicts with FR-20.1
    ("header names emitted trimmed") and AC-24, which counts cells.
    Schema-column headers are never sanitized.
  - Verified: a phone number like +79991234567 in a string or pass-through
    column gets an apostrophe. This is the SRS's own decision 1, but phone
    numbers like this are very common in the data this tool targets.
    Re-validating the cleaned file against a pattern then fails.

  Medium

  4. File handling can lose or leak files.
  - main.ts:12 runs the orphan sweep before app.listen. If you start a second
    instance against the same DATA_DIR, for example with npm start while dev is
    running, the sweep runs first. It then deletes the first instance's
    in-flight .tmp and uncommitted cleaned files before the second instance dies
    with EADDRINUSE.
  - The sweep also deletes any file in cleaned/ that isn't a known run
    (cleaned-files.ts:53).
  - CleanedFileStore.write has no cleanup if writeFile, sync or rename fails
    (for example ENOSPC). The .tmp file stays until the next restart
    (cleaned-files.ts:23-30).
  - It also never fsyncs the directory after the rename. This is from reading
    the code. After a power loss, a committed Run could point at a cleaned file
    that is missing.

  5. Download usability for the target audience (from reading, plus FR-20.6).
  - downloadHeaders replaces every non-ASCII run with _ (security.ts:46). A
    download named Продажи.csv becomes _.cleaned.csv. There is no RFC 5987
    filename*.
  - The cleaned file is UTF-8 with no BOM and comma-delimited. Excel in a
    Russian locale will show mojibake or a single column. The spec requires
    this, but it clashes with the windows-1251 and semicolon inputs that FR-9
    and FR-10 are built for. An opt-in BOM or delimiter would help.

  6. The parser is strict in ways that hurt in practice (FR-11, FR-14).
  - Verified: "x" ,2 (a space after the closing quote) fails the whole file with
    PARSE_ERROR (parse.ts:59-61). One malformed row in 10 MiB loses the entire
    run, where a row-level error would be kinder.
  - Verified: a blank line in the middle of a file gives COLUMN_COUNT_MISMATCH,
    and so does a whitespace-only line. FR-11 only exempts a blank trailing
    line. By the same logic, a whitespace-only trailing line also errors, which
    I did not test.

  7. unique ignores how values are normally compared (FR-U1). Verified.
  - In a unique integer column, 1, 01 and +1 all pass. In a unique email column,
    A@x.com, a@x.com and a@X.com all pass.
  - This matches the spec text ("trimmed text, case-sensitive"). But it
    contradicts enum, which compares numerically, and it lets obvious duplicates
    through. I'd change the spec so numeric types compare by value and emails
    compare case-insensitively on the domain.

  Low

  - FR-U4 gap: a COLUMN_COUNT_MISMATCH row never claims a unique value
    (process.ts:107-117). FR-U4 says a row claims it "even if invalid for
    another reason".
  - NFR-13: it says "loopback host/port", but hostnameOf drops the port
    (security.ts:12), so the port is never checked. This has little practical
    effect.
  - Decimal precision: decimals beyond about 15 digits are compared through
    Number(). In a decimal column, 9007199254740993.0 matches an enum entry of
    9007199254740992. Only integers get the safe-integer check.
  - duplicateRowsDropped: it counts any row that has a NOT_UNIQUE error,
    including rows that also failed for other reasons. The spec is ambiguous on
    this.
  - Mislabeled regex error: the UNSUPPORTED regexes in regex-re2.ts also match
    an escaped backslash followed by a digit, such as \\1. That can mislabel a
    compile failure as a backreference. It only affects the error message.
  - Stale SPA page: index.html is read once at startup (static.ts:16), but other
    assets are served from disk. After a web rebuild, a running server serves a
    stale index with the wrong hashed asset names.
  - Filenames in the UI: safeFilename keeps bidi override characters such as
    U+202E, which could be used to spoof a filename in the history table.

  What I checked and found sound

  - ReDoS: not a real risk. A 10 MiB single cell against three adversarial RE2
    patterns finished in about 200 ms each. RE2 rejected the compile bombs in 38
    ms or less.
  - Path traversal: cleanedPath is only ever generated by the server. Route ids
    are validated as UUIDs and resolve() has a prefix guard.
  - Input and storage: SQL is fully parameterized, run inserts are
    transactional, and the upload size limit is enforced while streaming.
  - Request filtering: the Host and Origin checks, CORS limited to the SPA
    origin, and nosniff all work as described. Missing-Origin requests are only
    possible from non-browser clients.
  - Dates: date parsing is strict, locale-independent, and rejects year 0000.

  I'd fix items 1 to 3 first. Items 5 and 7 need a spec decision before any code
  change. Want me to start on 1 to 3?

✻ Cogitated for 4m 1s · done 18:13