/**
 * End-to-end smoke test over real HTTP against the built server: `npm run build && npm run smoke`.
 * Starts the API with the built SPA on a free port and a throwaway data directory, walks the main
 * flow, then shuts the server down with SIGTERM and checks it exits cleanly.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiEntry = join(root, 'packages/api/dist/main.js');
const webDist = join(root, 'packages/web/dist');

if (!existsSync(apiEntry) || !existsSync(join(webDist, 'index.html'))) {
  console.error('Nothing to smoke-test yet. Run `npm run build` first.');
  process.exit(2);
}

const dataDir = mkdtempSync(join(tmpdir(), 'csvv-smoke-'));
let server;
let serverLog = '';
let passed = 0;

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n${error instanceof Error ? error.message : error}`);
    throw error;
  }
}

function startServer() {
  server = spawn(process.execPath, [apiEntry], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, WEB_DIST: webDist },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => (serverLog += chunk));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server did not start:\n${serverLog}`)),
      15_000,
    );
    server.stdout.on('data', (chunk) => {
      serverLog += chunk;
      const match = /Server listening at http:\/\/127\.0\.0\.1:(\d+)/.exec(String(chunk));
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    server.on('exit', (code) => reject(new Error(`server exited early (${code}):\n${serverLog}`)));
  });
}

const exited = () =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not stop within 10 s')), 10_000);
    server.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

/** fetch cannot set a Host header, so the DNS-rebinding check goes through node:http. */
const getWithHost = (base, host) =>
  new Promise((resolve, reject) => {
    const url = new URL('/api/health', base);
    http
      .get(
        { hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on('error', reject);
  });

const SCHEMA = {
  name: 'Smoke invoices',
  columns: [
    { name: 'id', type: 'integer', required: true, unique: true },
    { name: 'issued', type: 'date', dateFormat: 'DD.MM.YYYY' },
  ],
};
const CSV =
  'id,issued,memo\n1,01.03.2024,=SUM(A1)\n2,31.04.2024,x\n1,02.03.2024,y\n3, 05.03.2024 ,z\n';

function upload(base, schemaId, bytes, filename = 'smoke.csv') {
  const form = new FormData();
  form.append('schemaId', schemaId);
  form.append('file', new Blob([bytes], { type: 'text/csv' }), filename);
  return fetch(`${base}/api/validations`, { method: 'POST', body: form });
}

try {
  let base = '';
  let runId = '';
  let schemaId = '';

  await step('server starts on a free port', async () => {
    base = await startServer();
  });

  await step('GET /api/health answers ok', async () => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  await step('the built web app is served with a strict CSP, assets included', async () => {
    const page = await fetch(`${base}/history`, { headers: { accept: 'text/html' } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<div id="root">/);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(asset, 'index.html references a script');
    const script = await fetch(`${base}${asset}`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
  });

  await step('POST /api/schemas creates a schema', async () => {
    const response = await fetch(`${base}/api/schemas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SCHEMA),
    });
    assert.equal(response.status, 201);
    schemaId = (await response.json()).id;
  });

  await step('uploading a CSV returns the expected counts', async () => {
    const response = await upload(base, schemaId, CSV);
    assert.equal(response.status, 201);
    const run = await response.json();
    runId = run.id;
    assert.equal(run.status, 'completed');
    assert.deepEqual(
      [
        run.totalRows,
        run.validRows,
        run.invalidRows,
        run.duplicateRowsDropped,
        run.totalErrors,
        run.sanitizedCells,
      ],
      [4, 2, 2, 1, 2, 1],
    );
    assert.deepEqual(run.errorCountsByCode, { INVALID_DATE: 1, NOT_UNIQUE: 1 });
    assert.deepEqual(run.passthroughColumns, ['memo']);
  });

  await step('the run report lists the errors in order and keeps the schema snapshot', async () => {
    const detail = await (await fetch(`${base}/api/validations/${runId}`)).json();
    assert.deepEqual(
      detail.errors.items.map((e) => [e.row, e.column, e.code]),
      [
        [2, 'issued', 'INVALID_DATE'],
        [3, 'id', 'NOT_UNIQUE'],
      ],
    );
    assert.equal(detail.schemaSnapshot.name, 'Smoke invoices');
  });

  await step(
    'the cleaned CSV downloads with ISO dates, sanitized formulas and safe headers',
    async () => {
      const response = await fetch(`${base}/api/validations/${runId}/cleaned`);
      assert.equal(response.status, 200);
      assert.equal(
        await response.text(),
        "id,issued,memo\n1,2024-03-01,'=SUM(A1)\n3,2024-03-05,z\n",
      );
      assert.equal(
        response.headers.get('content-disposition'),
        'attachment; filename="smoke.cleaned.csv"',
      );
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    },
  );

  await step('a file of 10 MiB + 1 byte is rejected with 413 and creates no run', async () => {
    const before = (await (await fetch(`${base}/api/validations`)).json()).items.length;
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
    const response = await upload(base, schemaId, big, 'big.csv');
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'FILE_TOO_LARGE');
    assert.equal((await (await fetch(`${base}/api/validations`)).json()).items.length, before);
  });

  await step('history lists the run', async () => {
    const { items } = await (await fetch(`${base}/api/validations`)).json();
    assert.deepEqual(
      items.map((r) => r.id),
      [runId],
    );
  });

  await step('a foreign Origin on a write and a foreign Host are refused with 403', async () => {
    const write = await fetch(`${base}/api/schemas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify(SCHEMA),
    });
    assert.equal(write.status, 403);
    assert.equal(await getWithHost(base, 'evil.example'), 403);
  });

  await step('deleting the run removes it and its cleaned file', async () => {
    const response = await fetch(`${base}/api/validations/${runId}`, { method: 'DELETE' });
    assert.equal(response.status, 204);
    assert.equal((await fetch(`${base}/api/validations/${runId}`)).status, 404);
    assert.deepEqual(readdirSync(join(dataDir, 'cleaned')), []);
  });

  await step('SIGTERM shuts the server down cleanly', async () => {
    const stopped = exited();
    server.kill('SIGTERM');
    assert.deepEqual(await stopped, { code: 0, signal: null });
    assert.deepEqual(readdirSync(join(dataDir, 'cleaned')), []);
  });

  console.log(`\nPASS: ${passed} checks`);
} catch {
  console.error(`\nFAIL after ${passed} passing checks. Server log:\n${serverLog || '(empty)'}`);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
}
