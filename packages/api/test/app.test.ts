import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { makeApp, type TestApp } from './helpers/app.js';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const start = () =>
  makeApp({
    routes: (app) => {
      app.post(
        '/api/_validated',
        {
          schema: {
            body: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } },
          },
        },
        async () => ({ ok: true }),
      );
      app.get('/api/_teapot', async () => {
        throw new ApiError(418, 'TEAPOT', 'short and stout', { handle: true });
      });
      app.get('/api/_boom', async () => {
        throw new Error('database exploded: secret detail');
      });
    },
  }).then((t) => (current = t));

describe('GET /api/health', () => {
  it('reports ok after touching the database', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('error envelope', () => {
  it('renders an unknown route as 404 with a request id', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: 'NOT_FOUND',
      requestId: response.headers['x-request-id'],
    });
  });

  it('renders an ApiError with its status, code and details', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/_teapot' });
    expect(response.statusCode).toBe(418);
    expect(response.json().error).toMatchObject({
      code: 'TEAPOT',
      message: 'short and stout',
      details: { handle: true },
    });
  });

  it('renders transport validation failures as 400 VALIDATION_ERROR', async () => {
    const { app } = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/_validated',
      payload: { n: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('renders malformed JSON as 400 BAD_REQUEST', async () => {
    const { app } = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/_validated',
      headers: { 'content-type': 'application/json' },
      payload: '{"n": ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('hides internal error detail behind a generic 500', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/_boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(response.body).not.toContain('secret detail');
  });

  it('gives each request its own id (NFR-12)', async () => {
    const { app } = await start();
    const ids = new Set<unknown>();
    for (let i = 0; i < 5; i++) {
      ids.add((await app.inject({ method: 'GET', url: '/api/health' })).headers['x-request-id']);
    }
    expect(ids.size).toBe(5);
  });

  it('ignores a client-supplied request id', async () => {
    const { app } = await start();
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'attacker' },
    });
    expect(response.headers['x-request-id']).not.toBe('attacker');
  });
});
