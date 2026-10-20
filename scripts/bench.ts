/**
 * Benchmarks 10 MiB validation (NFR-1, NFR-2, AC-40, AC-41).
 *
 *   npm run bench                    # every scenario, 20 runs each
 *   npm run bench -- --runs 5        # fewer runs
 *   npm run bench -- --only core-typical --json
 *   npm run bench -- --heap-mib 256  # cap V8's old space, as a small container would
 *
 * NFR-2 is judged on the peak RSS of the first request. Over repeated runs V8 may let RSS
 * drift upwards while it has heap to spare, so that sustained peak is reported but not gated.
 *
 * Each scenario runs in its own process, so its peak-memory figure belongs to it alone.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../packages/api/src/app.ts';
import { openDatabase } from '../packages/api/src/db/connection.ts';
import { re2Engine } from '../packages/api/src/regex-re2.ts';
import { processCsv, validateSchemaDefinition } from '../packages/core/src/index.ts';
import {
  BENCH_SCHEMA,
  ERRORS_PER_ALL_ERROR_ROW,
  generateAllErrorCsv,
  generateTypicalCsv,
} from '../packages/core/test/fixtures/gen/bench-data.ts';

const P95_LIMIT_MS = 5000; // NFR-1
const RSS_LIMIT_MIB = 512; // NFR-2
const MAX_STORED_ERRORS = 1000; // FR-26

const SCENARIOS = ['core-typical', 'core-all-error', 'api-typical', 'api-all-error'] as const;
type Scenario = (typeof SCENARIOS)[number];

/** What one run reports, whichever layer it went through. */
interface Outcome {
  totalRows: number;
  validRows: number;
  totalErrors: number;
  /** Errors held in memory (core) or stored (API). */
  heldErrors: number;
}

interface Runner {
  once(): Promise<Outcome>;
  /** Untimed work after each run, e.g. deleting the stored run so disk use stays flat. */
  afterRun?(): Promise<void>;
  close(): Promise<void>;
}

interface Result {
  scenario: Scenario;
  runs: number;
  fileBytes: number;
  rows: number;
  timesMs: number[];
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** Peak RSS right after the first run: the working set of one request, Node baseline included. */
  firstRunRssMiB: number;
  /** Peak RSS after all runs. */
  peakRssMiB: number;
  checks: { name: string; ok: boolean; detail: string }[];
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : (args[i + 1] ?? 'true');
};

/** Nearest-rank percentile of an ascending list. */
const percentile = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] as number;

function coreRunner(bytes: Buffer): Runner {
  const parsed = validateSchemaDefinition(BENCH_SCHEMA, re2Engine);
  if (!parsed.ok) throw new Error('benchmark schema rejected');
  return {
    async once() {
      const result = processCsv({ bytes, schema: parsed.schema, regex: re2Engine });
      if (result.status !== 'completed') throw new Error('benchmark file failed');
      const { report } = result;
      return {
        totalRows: report.totalRows,
        validRows: report.validRows,
        totalErrors: report.totalErrors,
        heldErrors: report.errors.length,
      };
    },
    async close() {},
  };
}

/** The full request path: multipart parse, validation, cleaning, file write and database insert. */
async function apiRunner(bytes: Buffer): Promise<Runner> {
  const dataDir = mkdtempSync(join(tmpdir(), 'csvv-bench-'));
  mkdirSync(join(dataDir, 'cleaned'));
  const db = openDatabase(':memory:');
  const app = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 3001,
      dataDir,
      webOrigin: 'http://localhost:5173',
      webDist: join(dataDir, 'none'),
      allowedHosts: [],
    },
    db,
  });

  const schema = await app.inject({
    method: 'POST',
    url: '/api/schemas',
    payload: BENCH_SCHEMA as object,
  });
  const boundary = '----benchboundary';
  const head =
    `--${boundary}\r\nContent-Disposition: form-data; name="schemaId"\r\n\r\n${schema.json().id}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bench.csv"\r\nContent-Type: text/csv\r\n\r\n`;
  const request = {
    payload: Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };

  let lastRunId = '';
  return {
    async once() {
      const response = await app.inject({ method: 'POST', url: '/api/validations', ...request });
      if (response.statusCode !== 201) throw new Error(`upload answered ${response.statusCode}`);
      const run = response.json();
      lastRunId = run.id;
      return {
        totalRows: run.totalRows,
        validRows: run.validRows,
        totalErrors: run.totalErrors,
        heldErrors: Math.min(run.totalErrors, MAX_STORED_ERRORS),
      };
    },
    async afterRun() {
      await app.inject({ method: 'DELETE', url: `/api/validations/${lastRunId}` });
    },
    async close() {
      await app.close();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Row count of a generated file: every line but the header. */
const countRows = (bytes: Buffer) => bytes.toString('latin1').split('\n').length - 2;

async function measure(scenario: Scenario, runs: number, file: string): Promise<Result> {
  const allError = scenario.endsWith('all-error');
  // Read from disk so generator memory does not count towards this scenario's peak RSS.
  const bytes = readFileSync(file);
  const data = { bytes, rows: countRows(bytes) };
  const runner = scenario.startsWith('core') ? coreRunner(data.bytes) : await apiRunner(data.bytes);

  const timesMs: number[] = [];
  let first: Outcome | undefined;
  let firstRunRssMiB = 0;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const outcome = await runner.once();
    timesMs.push(performance.now() - start);
    first ??= outcome;
    if (i === 0) firstRunRssMiB = process.resourceUsage().maxRSS / 1024;
    await runner.afterRun?.();
  }
  await runner.close();

  const outcome = first as Outcome;
  const check = (name: string, ok: boolean, detail: string) => ({ name, ok, detail });
  const checks = [
    check(
      'row count matches the generated file',
      outcome.totalRows === data.rows,
      `${outcome.totalRows} of ${data.rows}`,
    ),
  ];
  if (allError) {
    checks.push(
      check('no row is valid', outcome.validRows === 0, `${outcome.validRows} valid`),
      check(
        'error total is exact',
        outcome.totalErrors === data.rows * ERRORS_PER_ALL_ERROR_ROW,
        `${outcome.totalErrors} = ${data.rows} x ${ERRORS_PER_ALL_ERROR_ROW}`,
      ),
      check(
        `at most ${MAX_STORED_ERRORS} errors held (AC-41)`,
        outcome.heldErrors === MAX_STORED_ERRORS && outcome.totalErrors > MAX_STORED_ERRORS,
        `${outcome.heldErrors} held of ${outcome.totalErrors}`,
      ),
    );
  } else {
    checks.push(
      check(
        'most rows are valid',
        outcome.validRows > data.rows * 0.95,
        `${outcome.validRows} valid`,
      ),
    );
  }

  const sorted = [...timesMs].sort((a, b) => a - b);
  return {
    scenario,
    runs,
    fileBytes: data.bytes.length,
    rows: data.rows,
    timesMs,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) as number,
    firstRunRssMiB,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    checks,
  };
}

function orchestrate(runs: number) {
  const only = flag('only');
  const heapMiB = flag('heap-mib');
  const selected = SCENARIOS.filter((s) => !only || s === only);
  if (selected.length === 0) {
    console.error(`Unknown scenario "${only}". Choose from: ${SCENARIOS.join(', ')}`);
    process.exit(2);
  }

  const results: Result[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'csvv-bench-data-'));
  const files = { typical: join(dir, 'typical.csv'), 'all-error': join(dir, 'all-error.csv') };
  writeFileSync(files.typical, generateTypicalCsv().bytes);
  writeFileSync(files['all-error'], generateAllErrorCsv().bytes);

  for (const scenario of selected) {
    process.stderr.write(`running ${scenario} (${runs} runs)...\n`);
    const file = scenario.endsWith('all-error') ? files['all-error'] : files.typical;
    const child = spawnSync(
      process.execPath,
      [
        ...process.execArgv,
        ...(heapMiB ? [`--max-old-space-size=${heapMiB}`] : []),
        fileURLToPath(import.meta.url),
        '--scenario',
        scenario,
        '--runs',
        String(runs),
        '--file',
        file,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const line = child.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    if (child.status !== 0 || !line) {
      rmSync(dir, { recursive: true, force: true });
      console.error(child.stderr || child.stdout);
      process.exit(1);
    }
    results.push(JSON.parse(line.slice('RESULT '.length)) as Result);
  }
  rmSync(dir, { recursive: true, force: true });

  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else print(results);

  const failures = results.flatMap((r) => [
    ...(r.p95Ms > P95_LIMIT_MS
      ? [`${r.scenario}: p95 ${r.p95Ms.toFixed(0)} ms is over ${P95_LIMIT_MS} ms (NFR-1)`]
      : []),
    ...(r.firstRunRssMiB > RSS_LIMIT_MIB
      ? [
          `${r.scenario}: first-request RSS ${r.firstRunRssMiB.toFixed(0)} MiB is over ${RSS_LIMIT_MIB} MiB (NFR-2)`,
        ]
      : []),
    ...r.checks.filter((c) => !c.ok).map((c) => `${r.scenario}: ${c.name} failed (${c.detail})`),
  ]);
  if (failures.length > 0) {
    console.error(`\nFAIL\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  if (!args.includes('--json')) {
    console.log(
      `\nPASS: p95 <= ${P95_LIMIT_MS} ms, first-request RSS <= ${RSS_LIMIT_MIB} MiB, error accounting exact.`,
    );
  }
}

function print(results: Result[]) {
  const line = (cells: (string | number)[]) =>
    cells.map((c, i) => String(c).padEnd(i === 0 ? 16 : 13)).join('');
  console.log(
    `\nNode ${process.version}, ${process.platform}/${process.arch}, ${results[0]?.runs} runs each\n`,
  );
  console.log(
    line([
      'scenario',
      'file MiB',
      'rows',
      'p50 ms',
      'p95 ms',
      'max ms',
      'RSS 1st MiB',
      'RSS peak MiB',
    ]),
  );
  for (const r of results) {
    console.log(
      line([
        r.scenario,
        (r.fileBytes / 1048576).toFixed(2),
        r.rows,
        r.p50Ms.toFixed(0),
        r.p95Ms.toFixed(0),
        r.maxMs.toFixed(0),
        r.firstRunRssMiB.toFixed(0),
        r.peakRssMiB.toFixed(0),
      ]),
    );
  }
  console.log('');
  for (const r of results) {
    for (const c of r.checks)
      console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${r.scenario}: ${c.name} (${c.detail})`);
  }
}

const runs = Number(flag('runs') ?? 20);
const scenario = flag('scenario') as Scenario | undefined;
if (scenario) {
  // Worker mode: run one scenario and report it as a single JSON line.
  const file = flag('file');
  if (!file) throw new Error('worker mode needs --file');
  process.stdout.write(`RESULT ${JSON.stringify(await measure(scenario, runs, file))}\n`);
} else {
  orchestrate(runs);
}
