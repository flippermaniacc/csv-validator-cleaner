import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestApp } from './helpers/app.js';
import {
  createSchema,
  filePart,
  GOOD_CSV,
  runOf,
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
const get = (t: TestApp, url: string) => t.app.inject({ method: 'GET', url });
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

/** A clock that advances one minute per call, so runs have distinct created_at values. */
function ticking() {
  let minute = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, minute++, 0));
}

const badRows = (n: number, value = 'x') =>
  `n\n${Array.from({ length: n }, () => value).join('\n')}\n`;
const NUMBERS = { name: 'Numbers', columns: [{ name: 'n', type: 'integer' }] };

describe('GET /api/validations: history (AC-34, FR-24)', () => {
  it('is empty at first', async () => {
    const t = await start();
    expect((await get(t, '/api/validations')).json()).toEqual({ items: [], nextCursor: null });
  });

  it('lists runs newest first with filename, schema name, status, counts and time', async () => {
    const t = await start({ deps: { now: ticking() } });
    const schemaId = await createSchema(t);
    const ids: string[] = [];
    for (const name of ['a.csv', 'b.csv', 'c.csv']) {
      ids.push((await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV, name)])).json().id);
    }
    // ticking() also advanced for the schema create, so ids order == creation order
    const { items, nextCursor } = (await get(t, '/api/validations')).json();
    expect(nextCursor).toBeNull();
    expect(items.map((r: { id: string }) => r.id)).toEqual([...ids].reverse());
    expect(items[0]).toMatchObject({
      originalFilename: 'c.csv',
      schema: { id: schemaId, name: 'Invoices' },
      status: 'completed',
      totalRows: 2,
      validRows: 2,
      totalErrors: 0,
    });
    expect(items[0].createdAt > items[2].createdAt).toBe(true);
  });

  it('pages with an opaque cursor, without gaps or overlaps', async () => {
    const t = await start({ deps: { now: ticking() } });
    const schemaId = await createSchema(t);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push((await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV)])).json().id);

    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const url: string = `/api/validations?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await get(t, url)).json();
      sizes.push(page.items.length);
      seen.push(...page.items.map((r: { id: string }) => r.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(sizes).toEqual([2, 2, 1]);
    expect(seen).toEqual([...ids].reverse());
  });

  it('has no next cursor when the last page is exactly full', async () => {
    const t = await start({ deps: { now: ticking() } });
    const schemaId = await createSchema(t);
    for (let i = 0; i < 4; i++) await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV)]);
    const page = (await get(t, '/api/validations?limit=4')).json();
    expect(page.items).toHaveLength(4);
    expect(page.nextCursor).toBeNull();
  });

  it('orders runs sharing a timestamp by id, newest first, and pages through them (keyset tie-break)', async () => {
    const t = await start();
    const schemaId = await createSchema(t);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++)
      ids.push((await upload(t, [schemaPart(schemaId), filePart(GOOD_CSV)])).json().id);

    const first = (await get(t, '/api/validations?limit=3')).json();
    const second = (await get(t, `/api/validations?limit=3&cursor=${first.nextCursor}`)).json();
    const all = [...first.items, ...second.items].map((r: { id: string }) => r.id);
    expect(all).toEqual([...ids].sort().reverse());
  });

  it('defaults to 20 per page', async () => {
    const t = await start({ deps: { now: ticking() } });
    const schemaId = await createSchema(t);
    for (let i = 0; i < 22; i++) await upload(t, [schemaPart(schemaId), filePart('id\n1\n')]);
    const page = (await get(t, '/api/validations')).json();
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it('includes failed runs with their file error', async () => {
    const t = await start();
    await runOf(t, 'x\n1\n');
    const [item] = (await get(t, '/api/validations')).json().items;
    expect(item).toMatchObject({
      status: 'failed',
      fileError: { code: 'MISSING_COLUMN' },
      totalRows: 0,
    });
  });

  it.each(['0', '101', '-1', 'x', '1.5'])('rejects limit=%s with 400', async (limit) => {
    const t = await start();
    const response = await get(t, `/api/validations?limit=${limit}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    'garbage',
    Buffer.from('not json').toString('base64url'),
    Buffer.from('{"createdAt":1}').toString('base64url'),
  ])('rejects cursor %j with 400 INVALID_CURSOR', async (cursor) => {
    const t = await start();
    const response = await get(t, `/api/validations?cursor=${cursor}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_CURSOR');
  });
});

describe('GET /api/validations/:id (FR-25)', () => {
  it('returns the summary, the schema snapshot and the first page of errors', async () => {
    const t = await start();
    const { run } = await runOf(t, 'id,issued,name\nx,01.01.2024,a\n1,31.04.2024,b\n');
    const response = await get(t, `/api/validations/${run.id}`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ id: run.id, status: 'completed', totalErrors: 2, validRows: 0 });
    expect(body.schemaSnapshot).toMatchObject({ name: 'Invoices' });
    expect(body.schemaSnapshot.columns).toHaveLength(3);
    expect(body.errors).toMatchObject({ offset: 0, limit: 100, total: 2 });
    expect(body.errors.items).toEqual([
      expect.objectContaining({ row: 1, column: 'id', code: 'INVALID_TYPE', value: 'x' }),
      expect.objectContaining({
        row: 2,
        column: 'issued',
        code: 'INVALID_DATE',
        value: '31.04.2024',
      }),
    ]);
  });

  it('returns a failed run with its file error and no errors', async () => {
    const t = await start();
    const { run } = await runOf(t, 'x\n1\n');
    const body = (await get(t, `/api/validations/${run.id}`)).json();
    expect(body).toMatchObject({ status: 'failed', fileError: { code: 'MISSING_COLUMN' } });
    expect(body.errors).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
  });

  it('returns only the first 100 errors in the detail view', async () => {
    const t = await start();
    const { run } = await runOf(t, badRows(250), { schema: NUMBERS });
    const body = (await get(t, `/api/validations/${run.id}`)).json();
    expect(body.errors.items).toHaveLength(100);
    expect(body.errors.total).toBe(250);
  });

  it('answers 404 for an unknown run and 400 for a malformed id (AC-37)', async () => {
    const t = await start();
    const missing = await get(t, `/api/validations/${MISSING_ID}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('RUN_NOT_FOUND');
    expect((await get(t, '/api/validations/not-a-uuid')).statusCode).toBe(400);
  });
});

describe('GET /api/validations/:id/errors', () => {
  it('pages through stored errors in report order', async () => {
    const t = await start();
    const { run } = await runOf(t, badRows(250), { schema: NUMBERS });
    const page1 = (await get(t, `/api/validations/${run.id}/errors`)).json();
    const page2 = (await get(t, `/api/validations/${run.id}/errors?offset=100`)).json();
    const page3 = (await get(t, `/api/validations/${run.id}/errors?offset=200&limit=100`)).json();

    expect([page1.items.length, page2.items.length, page3.items.length]).toEqual([100, 100, 50]);
    expect(page1).toMatchObject({ total: 250, offset: 0, limit: 100 });
    const rows = [...page1.items, ...page2.items, ...page3.items].map(
      (e: { row: number }) => e.row,
    );
    expect(rows).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
  });

  it('returns nothing past the end and allows a limit of 1000', async () => {
    const t = await start();
    const { run } = await runOf(t, badRows(5), { schema: NUMBERS });
    expect((await get(t, `/api/validations/${run.id}/errors?offset=50`)).json().items).toEqual([]);
    const all = (await get(t, `/api/validations/${run.id}/errors?limit=1000`)).json();
    expect(all.items).toHaveLength(5);
  });

  it('filters by error code and pages within the filter', async () => {
    const t = await start();
    const schema = {
      name: 'Mixed',
      columns: [{ name: 'n', type: 'integer', unique: true, max: 5 }],
    };
    const csv = 'n\nx\n1\n1\n9\n1\n2\ny\n';
    const { run } = await runOf(t, csv, { schema });
    const counts = run.errorCountsByCode;
    expect(counts).toEqual({ INVALID_TYPE: 2, ABOVE_MAX: 1, NOT_UNIQUE: 2 });

    const dup = (await get(t, `/api/validations/${run.id}/errors?code=NOT_UNIQUE`)).json();
    expect(dup.total).toBe(2);
    expect(dup.items.map((e: { row: number; code: string }) => [e.row, e.code])).toEqual([
      [3, 'NOT_UNIQUE'],
      [5, 'NOT_UNIQUE'],
    ]);
    const paged = (
      await get(t, `/api/validations/${run.id}/errors?code=NOT_UNIQUE&limit=1&offset=1`)
    ).json();
    expect(paged.items.map((e: { row: number }) => e.row)).toEqual([5]);
    expect(paged.total).toBe(2);
  });

  it('exposes the cap: 1500 errors found, 1000 stored and pageable (AC-29)', async () => {
    const t = await start();
    const { run } = await runOf(t, badRows(1500), { schema: NUMBERS });
    expect(run).toMatchObject({ totalErrors: 1500, truncated: true });
    const last = (await get(t, `/api/validations/${run.id}/errors?offset=900&limit=1000`)).json();
    expect(last.total).toBe(1000);
    expect(last.items).toHaveLength(100);
    expect(last.items.at(-1).row).toBe(1000);
  });

  it('keeps null column and value for field-count errors', async () => {
    const t = await start();
    const { run } = await runOf(t, 'id,issued,name\n1\n');
    const [error] = (await get(t, `/api/validations/${run.id}/errors`)).json().items;
    expect(error).toEqual({
      row: 1,
      column: null,
      code: 'COLUMN_COUNT_MISMATCH',
      message: 'Expected 3 fields, got 1',
      value: null,
    });
  });

  it.each([
    ['limit=0'],
    ['limit=1001'],
    ['offset=-1'],
    ['offset=x'],
    ['code=NOPE'],
    ['code=FILE_EMPTY'],
  ])('rejects %s with 400', async (query) => {
    const t = await start();
    const { run } = await runOf(t, badRows(2), { schema: NUMBERS });
    const response = await get(t, `/api/validations/${run.id}/errors?${query}`);
    expect(response.statusCode).toBe(400);
  });

  it('answers 404 for an unknown run', async () => {
    const t = await start();
    expect((await get(t, `/api/validations/${MISSING_ID}/errors`)).statusCode).toBe(404);
  });
});

describe('GET /api/validations/:id/cleaned (AC-35, NFR-13)', () => {
  it('downloads the stored file with attachment headers', async () => {
    const t = await start();
    const { run } = await runOf(t, GOOD_CSV, { filename: 'invoices.csv' });
    const response = await get(t, `/api/validations/${run.id}/cleaned`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('id,issued,name,memo\n1,2024-03-01,Ann, keep \n2,2024-03-02,Bob,\n');
    expect(response.headers).toMatchObject({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="invoices.cleaned.csv"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    expect(Number(response.headers['content-length'])).toBe(run.cleanedSizeBytes);
    expect(
      Buffer.compare(
        response.rawPayload,
        readFileSync(join(t.dataDir, 'cleaned', `${run.id}.csv`)),
      ),
    ).toBe(0);
  });

  it('serves the sanitized content, so formulas never reach a download (FR-21)', async () => {
    const t = await start();
    const schema = { name: 'F', columns: [{ name: 'v', type: 'string' }] };
    const { run } = await runOf(t, 'v,memo\n=cmd|calc,+x\n', { schema });
    const body = (await get(t, `/api/validations/${run.id}/cleaned`)).body;
    expect(body).toBe("v,memo\n'=cmd|calc,'+x\n");
  });

  it.each([
    ['report', 'report.cleaned.csv'],
    ['invoices.csv', 'invoices.cleaned.csv'],
    ['REPORT.CSV', 'REPORT.cleaned.csv'],
    ['../../etc/passwd', 'passwd.cleaned.csv'],
    ['my report.csv', 'my_report.cleaned.csv'],
  ])('names the download for %j as %j', async (filename, expected) => {
    const t = await start();
    const { run } = await runOf(t, GOOD_CSV, { filename });
    const header = (await get(t, `/api/validations/${run.id}/cleaned`)).headers[
      'content-disposition'
    ];
    expect(header).toBe(`attachment; filename="${expected}"`);
  });

  it('keeps hostile filenames out of response headers', async () => {
    const t = await start();
    const { run } = await runOf(t, GOOD_CSV, { filename: 'a"b\r\nSet-Cookie: x=1.csv' });
    const response = await get(t, `/api/validations/${run.id}/cleaned`);
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="[A-Za-z0-9._-]+"$/,
    );
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers 404 for a failed run, which has no file (AC-35)', async () => {
    const t = await start();
    const { run } = await runOf(t, 'x\n1\n');
    const response = await get(t, `/api/validations/${run.id}/cleaned`);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CLEANED_FILE_NOT_FOUND');
  });

  it('answers 404 for an unknown run and 400 for a malformed id', async () => {
    const t = await start();
    expect((await get(t, `/api/validations/${MISSING_ID}/cleaned`)).statusCode).toBe(404);
    expect((await get(t, '/api/validations/nope/cleaned')).statusCode).toBe(400);
  });

  it('answers 404, not 500, when the file vanished from disk', async () => {
    const t = await start();
    const { run } = await runOf(t);
    rmSync(join(t.dataDir, 'cleaned', `${run.id}.csv`));
    const response = await get(t, `/api/validations/${run.id}/cleaned`);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CLEANED_FILE_NOT_FOUND');
  });
});

describe('schema changes never touch history (AC-3, FR-5)', () => {
  it('keeps report, snapshot and download readable after the schema is edited and deleted', async () => {
    const t = await start();
    const { schemaId, run } = await runOf(t, 'id,issued,name\nx,01.01.2024,a\n1,01.01.2024,b\n');
    const before = (await get(t, `/api/validations/${run.id}`)).json();
    const fileBefore = (await get(t, `/api/validations/${run.id}/cleaned`)).body;

    await t.app.inject({
      method: 'PUT',
      url: `/api/schemas/${schemaId}`,
      payload: { name: 'Renamed', columns: [{ name: 'zzz', type: 'string' }] },
    });
    await t.app.inject({ method: 'DELETE', url: `/api/schemas/${schemaId}` });

    expect((await get(t, `/api/validations/${run.id}`)).json()).toEqual(before);
    expect((await get(t, `/api/validations/${run.id}/cleaned`)).body).toBe(fileBefore);
    const [item] = (await get(t, '/api/validations')).json().items;
    expect(item.schema).toEqual({ id: schemaId, name: 'Invoices' });
  });
});

describe('DELETE /api/validations/:id (AC-36a, FR-27)', () => {
  it('removes the run, its errors and its cleaned file together', async () => {
    const t = await start();
    const { run } = await runOf(t, badRows(3), { schema: NUMBERS });
    const { run: other } = await runOf(t, 'n\n1\n', { schema: { ...NUMBERS, name: 'Other' } });
    expect(existsSync(join(t.dataDir, 'cleaned', `${run.id}.csv`))).toBe(true);

    const response = await t.app.inject({ method: 'DELETE', url: `/api/validations/${run.id}` });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    expect(existsSync(join(t.dataDir, 'cleaned', `${run.id}.csv`))).toBe(false);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE id = ?').get(run.id)).toEqual({
      n: 0,
    });
    expect(
      t.db.prepare('SELECT COUNT(*) AS n FROM run_errors WHERE run_id = ?').get(run.id),
    ).toEqual({ n: 0 });
    expect((await get(t, `/api/validations/${run.id}`)).statusCode).toBe(404);
    expect(
      (await get(t, '/api/validations')).json().items.map((r: { id: string }) => r.id),
    ).toEqual([other.id]);
    expect(existsSync(join(t.dataDir, 'cleaned', `${other.id}.csv`))).toBe(true);
  });

  it('deletes a failed run, which has no file', async () => {
    const t = await start();
    const { run } = await runOf(t, 'x\n1\n');
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/validations/${run.id}` })).statusCode,
    ).toBe(204);
  });

  it('still succeeds when the file is already gone', async () => {
    const t = await start();
    const { run } = await runOf(t);
    rmSync(join(t.dataDir, 'cleaned', `${run.id}.csv`));
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/validations/${run.id}` })).statusCode,
    ).toBe(204);
  });

  it('answers 404 the second time and for unknown ids, 400 for malformed ones', async () => {
    const t = await start();
    const { run } = await runOf(t);
    await t.app.inject({ method: 'DELETE', url: `/api/validations/${run.id}` });
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/validations/${run.id}` })).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/validations/${MISSING_ID}` })).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ method: 'DELETE', url: '/api/validations/nope' })).statusCode,
    ).toBe(400);
  });

  it('keeps both the run and the file when the database delete fails', async () => {
    const t = await start();
    const { run } = await runOf(t);
    t.db.exec(
      `CREATE TRIGGER fail_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'locked'); END`,
    );
    const response = await t.app.inject({ method: 'DELETE', url: `/api/validations/${run.id}` });
    expect(response.statusCode).toBe(500);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 1 });
    expect(existsSync(join(t.dataDir, 'cleaned', `${run.id}.csv`))).toBe(true);
  });

  it('rejects a delete from a foreign origin', async () => {
    const t = await start();
    const { run } = await runOf(t);
    const response = await t.app.inject({
      method: 'DELETE',
      url: `/api/validations/${run.id}`,
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 1 });
  });
});

describe('storage layout (AC-36a, FR-DB6)', () => {
  it('keeps only a relative path in the database, never CSV content', async () => {
    const t = await start();
    const secret = 'DISTINCTIVE-CELL-5521';
    const schema = { name: 'S', columns: [{ name: 'v', type: 'string' }] };
    const { run } = await runOf(t, `v\n${secret}\n`, { schema });

    const row = t.db.prepare('SELECT * FROM runs WHERE id = ?').get(run.id) as Record<
      string,
      unknown
    >;
    expect(row['cleaned_path']).toBe(`cleaned/${run.id}.csv`);
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(readFileSync(join(t.dataDir, 'cleaned', `${run.id}.csv`), 'utf8')).toContain(secret);
    expect(readdirSync(join(t.dataDir, 'cleaned'))).toEqual([`${run.id}.csv`]);
  });

  it('survives a sweep: files of existing runs are kept', async () => {
    const t = await start();
    const { run } = await runOf(t);
    writeFileSync(join(t.dataDir, 'cleaned', 'stray.csv'), 'x');
    const { sweepOrphanedFiles } = await import('../src/startup.js');
    expect(await sweepOrphanedFiles(t.db, t.dataDir)).toEqual(['stray.csv']);
    expect(readdirSync(join(t.dataDir, 'cleaned'))).toEqual([`${run.id}.csv`]);
  });
});
