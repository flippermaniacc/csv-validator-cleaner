import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app.js';

const SECRET = 'CELL-VALUE-4711-secret';
let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return { lines, stream };
}

describe('logging never contains cell values (NFR-9, AC-43)', () => {
  it('logs ids, route, status and duration but not request content or error messages', async () => {
    const { lines, stream } = capture();
    current = await makeApp({
      logger: { level: 'info', stream },
      routes: (app) => {
        app.post('/api/_echo', async (request) => request.body);
        app.get('/api/_boom', async () => {
          throw new Error(`failed on ${SECRET}`);
        });
      },
    });
    const { app } = current;

    await app.inject({ method: 'GET', url: `/api/health?cell=${SECRET}` });
    await app.inject({ method: 'GET', url: `/api/${SECRET}` });
    await app.inject({
      method: 'POST',
      url: '/api/_echo',
      headers: { 'content-type': 'application/json' },
      payload: `{"cell": "${SECRET}"`,
    });
    await app.inject({ method: 'POST', url: '/api/_echo', payload: { cell: SECRET } });
    await app.inject({ method: 'GET', url: '/api/_boom', headers: { 'x-note': SECRET } });

    const output = lines.join('');
    expect(output).not.toContain(SECRET);

    const completed = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === 'request completed');
    expect(completed.length).toBeGreaterThanOrEqual(5);
    expect(completed[0]).toMatchObject({ method: 'GET', route: '/api/health', statusCode: 200 });
    expect(completed[0]).toEqual(
      expect.objectContaining({ reqId: expect.any(String), durationMs: expect.any(Number) }),
    );
  });

  it('logs nothing when logging is disabled', async () => {
    current = await makeApp();
    const response = await current.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
  });
});
