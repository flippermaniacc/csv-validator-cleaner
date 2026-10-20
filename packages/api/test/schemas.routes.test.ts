import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app.js';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const invoice = {
  name: 'Invoices',
  columns: [
    { name: 'id', type: 'integer', required: true, unique: true, min: 1 },
    { name: 'issued', type: 'date', dateFormat: 'DD.MM.YYYY' },
    { name: 'currency', type: 'string', enum: ['USD', 'EUR'] },
    { name: 'code', type: 'string', pattern: '[A-Z]{3}' },
  ],
};

async function start(clock?: () => Date) {
  current = await makeApp(clock ? { deps: { now: clock } } : {});
  return current.app;
}

async function create(app: TestApp['app'], payload: unknown = invoice) {
  return app.inject({ method: 'POST', url: '/api/schemas', payload: payload as object });
}

describe('POST /api/schemas (AC-1)', () => {
  it('creates a schema and returns it with the columns in order and defaults applied', async () => {
    const app = await start();
    const response = await create(app);
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.id).toMatch(UUID);
    expect(response.headers.location).toBe(`/api/schemas/${body.id}`);
    expect(body.name).toBe('Invoices');
    expect(body.createdAt).toBe(body.updatedAt);
    expect(body.columns.map((c: { name: string }) => c.name)).toEqual([
      'id',
      'issued',
      'currency',
      'code',
    ]);
    expect(body.columns[1]).toEqual({
      name: 'issued',
      type: 'date',
      dateFormat: 'DD.MM.YYYY',
      required: false,
      unique: false,
    });
  });

  it('can be fetched again byte-for-byte equal (AC-1)', async () => {
    const app = await start();
    const created = (await create(app)).json();
    const fetched = await app.inject({ method: 'GET', url: `/api/schemas/${created.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(created);
  });

  it('trims the name and stores the validated definition with defaults', async () => {
    const app = await start();
    const created = (
      await create(app, { name: '  Spaced  ', columns: [{ name: 'a', type: 'string' }] })
    ).json();
    expect(created.name).toBe('Spaced');
    const row = current!.db
      .prepare('SELECT name, name_key, definition FROM schemas WHERE id = ?')
      .get(created.id);
    expect(row).toMatchObject({ name: 'Spaced', name_key: 'spaced' });
    expect(JSON.parse((row as { definition: string }).definition).columns[0]).toEqual({
      name: 'a',
      type: 'string',
      required: false,
      unique: false,
    });
  });

  it('rejects a second schema whose name differs only by case or surrounding spaces (AC-1)', async () => {
    const app = await start();
    await create(app);
    for (const name of ['INVOICES', 'invoices', '  Invoices ']) {
      const response = await create(app, { ...invoice, name });
      expect(response.statusCode, name).toBe(409);
      expect(response.json().error.code).toBe('SCHEMA_NAME_TAKEN');
    }
    expect((await app.inject({ method: 'GET', url: '/api/schemas' })).json()).toHaveLength(1);
  });

  it('allows a different name', async () => {
    const app = await start();
    await create(app);
    expect((await create(app, { ...invoice, name: 'Payments' })).statusCode).toBe(201);
  });
});

describe('POST /api/schemas: invalid definitions (AC-2, AC-37)', () => {
  const issuesFor = async (columns: unknown[], name = 'S') => {
    const app = await start();
    const response = await create(app, { name, columns });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
    return response.json().error.details.issues as {
      path: (string | number)[];
      column: string | null;
      property: string | null;
      message: string;
    }[];
  };

  it('names the column and property when min is greater than max', async () => {
    const issues = await issuesFor([{ name: 'c', type: 'integer', min: 10, max: 5 }]);
    expect(issues[0]).toMatchObject({ column: 'c', property: 'min', path: ['columns', 0, 'min'] });
  });

  it('rejects an invalid pattern with the real RE2 engine', async () => {
    const issues = await issuesFor([{ name: 'c', type: 'string', pattern: '(' }]);
    expect(issues[0]).toMatchObject({ column: 'c', property: 'pattern' });
  });

  it.each([
    ['^(?!0)\\d+$', 'lookahead'],
    ['(?<=x)y', 'lookbehind'],
    ['(a)\\1', 'backreference'],
  ])('names the unsupported construct in %j', async (pattern, construct) => {
    const issues = await issuesFor([{ name: 'c', type: 'string', pattern }]);
    expect(issues[0]?.message).toContain(construct);
  });

  it('rejects dateFormat on an integer column', async () => {
    const issues = await issuesFor([{ name: 'c', type: 'integer', dateFormat: 'DD.MM.YYYY' }]);
    expect(issues[0]).toMatchObject({ column: 'c', property: 'dateFormat' });
  });

  it('reports all structural problems together, in column order', async () => {
    const issues = await issuesFor([
      { name: 'a', type: 'integer', min: 2, max: 1 },
      { name: 'b', type: 'boolean', min: 0 },
      { name: 'c', type: 'string', pattern: '(?=x)' },
    ]);
    // Pattern compilation only runs once the structure is valid.
    expect(issues.map((i) => [i.column, i.property])).toEqual([
      ['a', 'min'],
      ['b', 'min'],
    ]);
  });

  it('reports every bad pattern together once the structure is valid', async () => {
    const issues = await issuesFor([
      { name: 'a', type: 'string', pattern: '(?=x)' },
      { name: 'b', type: 'string', pattern: '[ok]' },
      { name: 'c', type: 'email', pattern: '(' },
    ]);
    expect(issues.map((i) => [i.column, i.property])).toEqual([
      ['a', 'pattern'],
      ['c', 'pattern'],
    ]);
  });

  it('rejects an empty column list, duplicate columns, unknown keys and an empty name', async () => {
    expect((await issuesFor([]))[0]).toMatchObject({ property: 'columns', column: null });
    const dup = await issuesFor([
      { name: 'a', type: 'string' },
      { name: 'a', type: 'string' },
    ]);
    expect(dup[0]).toMatchObject({ path: ['columns', 1, 'name'] });
    expect(
      (await issuesFor([{ name: 'a', type: 'string', requried: true }])).length,
    ).toBeGreaterThan(0);
    expect((await issuesFor([{ name: 'a', type: 'string' }], '   '))[0]).toMatchObject({
      property: 'name',
    });
  });

  it('rejects server-owned fields in the body', async () => {
    const app = await start();
    const response = await create(app, { ...invoice, id: MISSING_ID, createdAt: 'x' });
    expect(response.statusCode).toBe(422);
  });

  it('stores nothing when validation fails', async () => {
    const app = await start();
    await create(app, { name: 'S', columns: [] });
    expect((await app.inject({ method: 'GET', url: '/api/schemas' })).json()).toEqual([]);
  });
});

describe('request bodies (AC-37)', () => {
  it.each([
    ['an array', '[]'],
    ['a string', '"x"'],
    ['a number', '5'],
    ['null', 'null'],
  ])('answers 400 for %s', async (_name, payload) => {
    const app = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/schemas',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toMatch(/VALIDATION_ERROR|BAD_REQUEST/);
  });

  it('answers 400 for a missing body and for malformed JSON', async () => {
    const app = await start();
    expect((await app.inject({ method: 'POST', url: '/api/schemas' })).statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/schemas',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('GET /api/schemas', () => {
  it('returns an empty list at first', async () => {
    const app = await start();
    expect((await app.inject({ method: 'GET', url: '/api/schemas' })).json()).toEqual([]);
  });

  it('lists schemas ordered by name, case-insensitively', async () => {
    const app = await start();
    for (const name of ['beta', 'Alpha', 'gamma', 'Delta']) {
      await create(app, { name, columns: [{ name: 'a', type: 'string' }] });
    }
    const names = (await app.inject({ method: 'GET', url: '/api/schemas' }))
      .json()
      .map((s: { name: string }) => s.name);
    expect(names).toEqual(['Alpha', 'beta', 'Delta', 'gamma']);
  });
});

describe('ids (AC-37)', () => {
  it.each(['GET', 'PUT', 'DELETE'] as const)('%s answers 404 for an unknown id', async (method) => {
    const app = await start();
    const response = await app.inject({
      method,
      url: `/api/schemas/${MISSING_ID}`,
      ...(method === 'PUT' ? { payload: invoice } : {}),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SCHEMA_NOT_FOUND');
  });

  it.each(['GET', 'PUT', 'DELETE'] as const)(
    '%s answers 400 for a malformed id',
    async (method) => {
      const app = await start();
      for (const id of ['abc', '123', 'not-a-uuid', `${MISSING_ID}x`]) {
        const response = await app.inject({
          method,
          url: `/api/schemas/${id}`,
          ...(method === 'PUT' ? { payload: invoice } : {}),
        });
        expect(response.statusCode, `${method} ${id}`).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }
    },
  );
});

describe('PUT /api/schemas/:id', () => {
  const tick = () => {
    let n = 0;
    return () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++));
  };

  it('replaces name and columns, keeps createdAt and bumps updatedAt', async () => {
    const app = await start(tick());
    const created = (await create(app)).json();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/schemas/${created.id}`,
      payload: { name: 'Invoices v2', columns: [{ name: 'amount', type: 'decimal', min: 0 }] },
    });
    expect(response.statusCode).toBe(200);
    const updated = response.json();
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Invoices v2',
      createdAt: created.createdAt,
    });
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(updated.columns).toEqual([
      { name: 'amount', type: 'decimal', min: 0, required: false, unique: false },
    ]);
    expect((await app.inject({ method: 'GET', url: `/api/schemas/${created.id}` })).json()).toEqual(
      updated,
    );
  });

  it('allows keeping or re-casing its own name', async () => {
    const app = await start();
    const created = (await create(app)).json();
    for (const name of ['Invoices', 'INVOICES']) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/schemas/${created.id}`,
        payload: { ...invoice, name },
      });
      expect(response.statusCode, name).toBe(200);
    }
  });

  it('answers 409 when renaming onto another schema and leaves both untouched', async () => {
    const app = await start();
    const first = (await create(app)).json();
    const second = (
      await create(app, { name: 'Payments', columns: [{ name: 'a', type: 'string' }] })
    ).json();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/schemas/${second.id}`,
      payload: { name: 'invoices', columns: [{ name: 'a', type: 'string' }] },
    });
    expect(response.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/api/schemas/${second.id}` })).json()).toEqual(
      second,
    );
    expect((await app.inject({ method: 'GET', url: `/api/schemas/${first.id}` })).json()).toEqual(
      first,
    );
  });

  it('answers 422 for an invalid definition and keeps the original', async () => {
    const app = await start();
    const created = (await create(app)).json();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/schemas/${created.id}`,
      payload: { name: 'X', columns: [{ name: 'a', type: 'integer', min: 3, max: 1 }] },
    });
    expect(response.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/api/schemas/${created.id}` })).json()).toEqual(
      created,
    );
  });
});

describe('DELETE /api/schemas/:id', () => {
  it('removes the schema and answers 204 with no body', async () => {
    const app = await start();
    const created = (await create(app)).json();
    const response = await app.inject({ method: 'DELETE', url: `/api/schemas/${created.id}` });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(
      (await app.inject({ method: 'GET', url: `/api/schemas/${created.id}` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/schemas/${created.id}` })).statusCode,
    ).toBe(404);
  });

  it('frees the name for reuse', async () => {
    const app = await start();
    const created = (await create(app)).json();
    await app.inject({ method: 'DELETE', url: `/api/schemas/${created.id}` });
    expect((await create(app)).statusCode).toBe(201);
  });

  it('leaves existing runs untouched (AC-3, FR-5)', async () => {
    const app = await start();
    const created = (await create(app)).json();
    current!.db
      .prepare(
        `INSERT INTO runs (id, created_at, original_filename, file_size_bytes, file_sha256, schema_id,
           schema_name, schema_snapshot, status) VALUES ('run-1', 't', 'f.csv', 1, 'x', ?, 'Invoices', '{}', 'completed')`,
      )
      .run(created.id);
    await app.inject({ method: 'DELETE', url: `/api/schemas/${created.id}` });
    expect(
      current!.db.prepare('SELECT schema_id, schema_name FROM runs WHERE id = ?').get('run-1'),
    ).toEqual({
      schema_id: created.id,
      schema_name: 'Invoices',
    });
  });
});

describe('guards', () => {
  it('rejects a write from a foreign origin before touching the database', async () => {
    const app = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/schemas',
      headers: { origin: 'https://evil.example' },
      payload: invoice,
    });
    expect(response.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/schemas' })).json()).toEqual([]);
  });
});
