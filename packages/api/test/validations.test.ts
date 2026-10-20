import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { processCsv, validateSchemaDefinition } from '@csv-validator/core';
import { afterEach, describe, expect, it } from 'vitest';
import { re2Engine } from '../src/regex-re2.js';
import { MAX_UPLOAD_BYTES, safeFilename } from '../src/routes/validations.routes.js';
import { multipartBody, type TestApp } from './helpers/app.js';
import {
  createSchema,
  filePart,
  GOOD_CSV,
  SCHEMA,
  schemaPart,
  startApp,
  upload,
} from './helpers/runs.js';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const start = async (options: Parameters<typeof startApp>[0] = {}) =>
  (current = await startApp(options));

const runRow = (t: TestApp, id: string) =>
  t.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown>;
const cleanedDir = (t: TestApp) => join(t.dataDir, 'cleaned');

describe('POST /api/validations: successful run (AC-32)', () => {
  it('validates, stores the run and the cleaned file, and returns the summary', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    const response = await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV, 'invoices.csv')]);

    expect(response.statusCode).toBe(201);
    const run = response.json();
    expect(run).toMatchObject({
      status: 'completed',
      originalFilename: 'invoices.csv',
      fileSizeBytes: Buffer.byteLength(GOOD_CSV),
      schema: { id: schemaId, name: 'Invoices' },
      detectedEncoding: 'utf-8',
      detectedDelimiter: ',',
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      totalErrors: 0,
      truncated: false,
      passthroughColumns: ['memo'],
      fileError: null,
      createdAt: '2026-02-03T04:05:06.000Z',
    });
    expect(run.id).toMatch(/^00000000-0000-4000-8000-0000000000\d\d$/);
    expect(run.fileSha256).toBe(createHash('sha256').update(GOOD_CSV).digest('hex'));
  });

  it('stores a cleaned file byte-identical to what core produced', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    const run = (await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV)])).json();

    const parsed = validateSchemaDefinition(SCHEMA, re2Engine);
    if (!parsed.ok) throw new Error('bad schema');
    const expected = processCsv({
      bytes: Buffer.from(GOOD_CSV),
      schema: parsed.schema,
      regex: re2Engine,
    });
    if (expected.status !== 'completed') throw new Error('expected completion');

    const stored = readFileSync(join(cleanedDir(t), `${run.id}.csv`));
    expect(Buffer.compare(stored, Buffer.from(expected.cleaned))).toBe(0);
    expect(stored.toString('utf8')).toBe(
      'id,issued,name,memo\n1,2024-03-01,Ann, keep \n2,2024-03-02,Bob,\n',
    );
    expect(run.cleanedSizeBytes).toBe(stored.length);
  });

  it('records a relative cleaned path, never an absolute one', async () => {
    const t = await start();
    const run = (await upload(t, [schemaPart(await createSchema(t)), filePart(GOOD_CSV)])).json();
    expect(runRow(t, run.id)['cleaned_path']).toBe(`cleaned/${run.id}.csv`);
  });

  it('stores a snapshot of the schema as it was, unaffected by later edits (AC-3)', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    const run = (await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV)])).json();

    await t.app.inject({
      method: 'PUT',
      url: `/api/schemas/${schemaId}`,
      payload: { name: 'Renamed', columns: [{ name: 'other', type: 'string' }] },
    });
    await t.app.inject({ method: 'DELETE', url: `/api/schemas/${schemaId}` });

    const row = runRow(t, run.id);
    expect(row['schema_name']).toBe('Invoices');
    const snapshot = JSON.parse(row['schema_snapshot'] as string);
    expect(snapshot).toMatchObject({ id: schemaId, name: 'Invoices' });
    expect(snapshot.columns.map((c: { name: string }) => c.name)).toEqual(['id', 'issued', 'name']);
    expect(snapshot.columns[0]).toMatchObject({ required: true, unique: true });
  });

  it('accepts the file part before the schemaId field', async () => {
    const t = await start();
    const response = await upload(t, [filePart(GOOD_CSV), schemaPart(await createSchema(t))]);
    expect(response.statusCode).toBe(201);
  });

  it('ignores unknown fields and a missing filename', async () => {
    const t = await start();
    const { payload, headers } = multipartBody([
      { name: 'note', value: 'hello' },
      schemaPart(await createSchema(t)),
      { name: 'file', filename: '', data: GOOD_CSV },
    ]);
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/validations',
      payload,
      headers,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().originalFilename).toBe('upload.csv');
  });

  it('decodes a windows-1251 semicolon file and stores UTF-8 output', async () => {
    const t = await start();
    const schemaId = await createSchema(t, {
      name: 'Cyr',
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ],
    });
    const cp1251 = Buffer.from([
      ...Buffer.from('id;name\n1;'),
      0xcf,
      0xf0,
      0xe8,
      0xe2,
      0xe5,
      0xf2,
      0x0a,
    ]);
    const run = (await upload(t, [schemaPart(schemaId), filePart(cp1251)])).json();
    expect(run).toMatchObject({ detectedEncoding: 'windows-1251', detectedDelimiter: ';' });
    expect(readFileSync(join(cleanedDir(t), `${run.id}.csv`), 'utf8')).toBe('id,name\n1,Привет\n');
  });

  it('stores errors in report order with the run (FR-23)', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    const csv = 'id,issued,name\nx,31.04.2024,a\n1,01.01.2024,b\n1,02.01.2024,c\n';
    const run = (await upload(t, [schemaPart(schemaId), filePart(csv)])).json();

    expect(run).toMatchObject({
      totalRows: 3,
      validRows: 1,
      invalidRows: 2,
      duplicateRowsDropped: 1,
      totalErrors: 3,
      errorCountsByCode: { INVALID_TYPE: 1, INVALID_DATE: 1, NOT_UNIQUE: 1 },
    });
    const stored = t.db
      .prepare(
        'SELECT seq, "row", "column", code, value FROM run_errors WHERE run_id = ? ORDER BY seq',
      )
      .all(run.id);
    expect(stored).toEqual([
      { seq: 0, row: 1, column: 'id', code: 'INVALID_TYPE', value: 'x' },
      { seq: 1, row: 1, column: 'issued', code: 'INVALID_DATE', value: '31.04.2024' },
      { seq: 2, row: 3, column: 'id', code: 'NOT_UNIQUE', value: '1' },
    ]);
    expect(readFileSync(join(cleanedDir(t), `${run.id}.csv`), 'utf8')).toBe(
      'id,issued,name\n1,2024-01-01,b\n',
    );
  });

  it('stores at most 1000 errors but exact totals (FR-26)', async () => {
    const t = await start();
    const schemaId = await createSchema(t, {
      name: 'N',
      columns: [{ name: 'n', type: 'integer' }],
    });
    const csv = `n\n${Array.from({ length: 1500 }, () => 'x').join('\n')}\n`;
    const run = (await upload(t, [schemaPart(schemaId), filePart(csv)])).json();
    expect(run).toMatchObject({
      totalErrors: 1500,
      truncated: true,
      errorCountsByCode: { INVALID_TYPE: 1500 },
    });
    expect(
      t.db.prepare('SELECT COUNT(*) AS n FROM run_errors WHERE run_id = ?').get(run.id),
    ).toEqual({ n: 1000 });
  });
});

describe('POST /api/validations: failed runs (D-15)', () => {
  const failedRun = async (csv: Buffer | string, columns = SCHEMA.columns) => {
    const t = await start();
    const schemaId = await createSchema(t, { name: 'S', columns });
    const response = await upload(t, [schemaPart(schemaId), filePart(csv)]);
    return { t, response, run: response.json() };
  };

  it('persists MISSING_COLUMN as a failed run without a file or errors', async () => {
    const { t, response, run } = await failedRun('id,name\n1,a\n');
    expect(response.statusCode).toBe(201);
    expect(run).toMatchObject({
      status: 'failed',
      fileError: { code: 'MISSING_COLUMN' },
      totalRows: 0,
      totalErrors: 0,
      cleanedSizeBytes: null,
    });
    expect(runRow(t, run.id)['cleaned_path']).toBeNull();
    expect(readdirSync(cleanedDir(t))).toEqual([]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM run_errors').get()).toEqual({ n: 0 });
  });

  it('persists PARSE_ERROR with the detected delimiter and no file', async () => {
    const { t, run } = await failedRun('id;issued;name\n1;"never closed\n');
    expect(run).toMatchObject({
      status: 'failed',
      fileError: { code: 'PARSE_ERROR' },
      detectedDelimiter: ';',
      detectedEncoding: 'utf-8',
    });
    expect(existsSync(cleanedDir(t)) ? readdirSync(cleanedDir(t)) : []).toEqual([]);
  });

  it('persists FILE_EMPTY for a zero-byte upload', async () => {
    const { run } = await failedRun(Buffer.alloc(0));
    expect(run).toMatchObject({
      status: 'failed',
      fileError: { code: 'FILE_EMPTY' },
      fileSizeBytes: 0,
    });
  });

  it('keeps failed runs in the database, with their snapshot', async () => {
    const { t, run } = await failedRun('x\n1\n');
    const row = runRow(t, run.id);
    expect(row['status']).toBe('failed');
    expect(JSON.parse(row['schema_snapshot'] as string).name).toBe('S');
    expect(JSON.parse(row['file_error'] as string).code).toBe('MISSING_COLUMN');
  });
});

describe('upload size limit (AC-4, FR-7)', () => {
  /** A valid one-column CSV of exactly `size` bytes: header plus one very long cell. */
  const csvOfSize = (size: number) => Buffer.from(`a\n${'x'.repeat(size - 2)}`);

  it('accepts a file of exactly 10 MiB', async () => {
    const t = await start();
    const schemaId = await createSchema(t, {
      name: 'Big',
      columns: [{ name: 'a', type: 'string' }],
    });
    const csv = csvOfSize(MAX_UPLOAD_BYTES);
    expect(csv.length).toBe(10_485_760);
    const response = await upload(t, [schemaPart(schemaId), filePart(csv)]);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: 'completed',
      fileSizeBytes: 10_485_760,
      totalRows: 1,
    });
  });

  it('rejects one byte more with 413 FILE_TOO_LARGE and creates no run', async () => {
    const t = await start();
    const schemaId = await createSchema(t, {
      name: 'Big',
      columns: [{ name: 'a', type: 'string' }],
    });
    const response = await upload(t, [
      schemaPart(schemaId),
      filePart(csvOfSize(MAX_UPLOAD_BYTES + 1)),
    ]);
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
    expect(existsSync(cleanedDir(t)) ? readdirSync(cleanedDir(t)) : []).toEqual([]);
  });

  it('rejects an oversize file even when it arrives before the schemaId', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    const response = await upload(t, [
      filePart(csvOfSize(MAX_UPLOAD_BYTES + 1)),
      schemaPart(schemaId),
    ]);
    expect(response.statusCode).toBe(413);
  });
});

describe('request validation (AC-37)', () => {
  it('answers 400 for a missing file part', async () => {
    const t = await start();
    const response = await upload(t, [schemaPart(await createSchema(t))]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 400 for a file under the wrong field name', async () => {
    const t = await start();
    const response = await upload(t, [
      schemaPart(await createSchema(t)),
      { name: 'upload', filename: 'a.csv', data: 'a\n1\n' },
    ]);
    expect(response.statusCode).toBe(400);
  });

  it('answers 400 for a missing, empty or malformed schemaId', async () => {
    const t = await start();
    for (const parts of [
      [filePart(GOOD_CSV)],
      [{ name: 'schemaId', value: '' }, filePart(GOOD_CSV)],
      [schemaPart('not-a-uuid'), filePart(GOOD_CSV)],
    ]) {
      const response = await upload(t, parts);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('answers 404 for a well-formed but unknown schemaId and stores nothing', async () => {
    const t = await start();
    const response = await upload(t, [
      schemaPart('11111111-1111-4111-8111-111111111111'),
      filePart(GOOD_CSV),
    ]);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SCHEMA_NOT_FOUND');
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });

  it('answers 400 when more than one file is sent', async () => {
    const t = await start();
    const response = await upload(t, [
      schemaPart(await createSchema(t)),
      filePart(GOOD_CSV, 'a.csv'),
      filePart(GOOD_CSV, 'b.csv'),
    ]);
    expect(response.statusCode).toBe(400);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });

  it('answers 415 for a non-multipart request', async () => {
    const t = await start();
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/validations',
      payload: { schemaId: 'x' },
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a foreign Origin before reading anything', async () => {
    const t = await start();
    const { payload, headers } = multipartBody([
      schemaPart(await createSchema(t)),
      filePart(GOOD_CSV),
    ]);
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/validations',
      payload,
      headers: { ...headers, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });
});

describe('the raw upload is never retained (AC-33, FR-DB4)', () => {
  const suspicious = () => readdirSync(tmpdir()).filter((n) => /upload|multipart|\.csv$/i.test(n));

  it('leaves only the cleaned file behind after a success', async () => {
    const t = await start();
    const before = suspicious();
    const run = (await upload(t, [schemaPart(await createSchema(t)), filePart(GOOD_CSV)])).json();
    expect(readdirSync(t.dataDir).sort()).toEqual(['cleaned']);
    expect(readdirSync(cleanedDir(t))).toEqual([`${run.id}.csv`]);
    expect(suspicious()).toEqual(before);
  });

  it('leaves nothing behind after a file-level failure', async () => {
    const t = await start();
    const before = suspicious();
    await upload(t, [schemaPart(await createSchema(t)), filePart('x\n1\n')]);
    expect(readdirSync(t.dataDir).sort()).toEqual(['cleaned']);
    expect(readdirSync(cleanedDir(t))).toEqual([]);
    expect(suspicious()).toEqual(before);
  });

  it('leaves nothing behind after a rejected oversize upload', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    await upload(t, [schemaPart(schemaId), filePart(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61))]);
    expect(readdirSync(t.dataDir).sort()).toEqual(['cleaned']);
    expect(readdirSync(cleanedDir(t))).toEqual([]);
  });
});

describe('persistence failures (FR-DB3)', () => {
  it('removes the cleaned file and stores no run when the database write fails', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    t.db.exec(
      `CREATE TRIGGER fail_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'disk on fire'); END`,
    );

    const response = await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV)]);
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('disk on fire');
    expect(readdirSync(cleanedDir(t))).toEqual([]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });

  it('rolls back all stored errors with the run', async () => {
    const t = await start();
    const schemaId = await createSchema(t, {
      name: 'N',
      columns: [{ name: 'n', type: 'integer' }],
    });
    t.db.exec(
      `CREATE TRIGGER fail_err BEFORE INSERT ON run_errors BEGIN SELECT RAISE(ABORT, 'nope'); END`,
    );
    const response = await upload(t, [schemaPart(schemaId), filePart('n\nx\ny\n')]);
    expect(response.statusCode).toBe(500);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
    expect(readdirSync(cleanedDir(t))).toEqual([]);
  });

  it('refuses to run against a stored schema that is no longer valid', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    t.db
      .prepare('UPDATE schemas SET definition = ? WHERE id = ?')
      .run('{"name":"S","columns":[]}', schemaId);
    const response = await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV)]);
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('STORED_SCHEMA_INVALID');
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });
});

describe('logging during uploads (NFR-9)', () => {
  it('never logs cell values or the file name content', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    const t = await start({ logger: { level: 'info', stream } });
    const schemaId = await createSchema(t);
    const secret = 'TOP-SECRET-CELL-9931';
    await upload(t, [
      schemaPart(schemaId),
      filePart(`id,issued,name\nx,${secret},${secret}\n`, `${secret}.csv`),
    ]);
    expect(lines.join('')).not.toContain(secret);
    expect(lines.some((l) => l.includes('"route":"/api/validations"'))).toBe(true);
  });
});

describe('safeFilename', () => {
  it.each([
    ['report.csv', 'report.csv'],
    ['C:\\Users\\me\\..\\data.csv', 'data.csv'],
    ['../../etc/passwd', 'passwd'],
    ['a\r\nb\u0000.csv', 'ab.csv'],
    ['  spaced.csv  ', 'spaced.csv'],
    ['', 'upload.csv'],
    [undefined, 'upload.csv'],
    ['///', 'upload.csv'],
    ['x'.repeat(400), 'x'.repeat(255)],
    ['отчёт.csv', 'отчёт.csv'],
  ])('maps %j to %j', (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });
});
