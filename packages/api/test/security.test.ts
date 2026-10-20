import { afterEach, describe, expect, it } from 'vitest';
import { downloadHeaders, hostnameOf } from '../src/security.js';
import { makeApp, SPA_ORIGIN, type TestApp } from './helpers/app.js';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const start = (config = {}) =>
  makeApp({
    config,
    routes: (app) => {
      app.post('/api/_probe', async () => ({ ok: true }));
      app.delete('/api/_probe', async () => ({ ok: true }));
    },
  }).then((t) => (current = t));

describe('Host check against DNS rebinding (NFR-13, AC-44)', () => {
  it.each(['127.0.0.1:3001', 'localhost:3001', 'LOCALHOST:3001', '[::1]:3001', 'localhost'])(
    'accepts Host %s',
    async (host) => {
      const { app } = await start();
      const response = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(response.statusCode).toBe(200);
    },
  );

  it.each(['evil.example', 'evil.example:3001', '127.0.0.1.evil.example', '192.168.1.5:3001'])(
    'rejects Host %s with 403',
    async (host) => {
      const { app } = await start();
      const response = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'FORBIDDEN_HOST' });
    },
  );

  it('accepts a configured extra host', async () => {
    const { app } = await start({ allowedHosts: ['csv.internal'] });
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'csv.internal:3001' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('parses host headers', () => {
    expect(hostnameOf('Localhost:3001')).toBe('localhost');
    expect(hostnameOf('[::1]:3001')).toBe('[::1]');
    expect(hostnameOf(' 127.0.0.1 ')).toBe('127.0.0.1');
  });
});

describe('Origin check on writes (NFR-13, AC-44)', () => {
  const post = (origin?: string, method: 'POST' | 'DELETE' = 'POST') =>
    current!.app.inject({
      method,
      url: '/api/_probe',
      headers: origin === undefined ? {} : { origin },
    });

  it('rejects a write from a foreign origin with 403', async () => {
    await start();
    for (const method of ['POST', 'DELETE'] as const) {
      const response = await post('https://evil.example', method);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_ORIGIN');
    }
  });

  it('accepts writes from the SPA origin and from the API itself', async () => {
    await start();
    expect((await post(SPA_ORIGIN)).statusCode).toBe(200);
    expect((await post('http://127.0.0.1:3001')).statusCode).toBe(200);
    expect((await post('http://localhost:3001')).statusCode).toBe(200);
  });

  it('accepts writes without an Origin header (curl, tests)', async () => {
    await start();
    expect((await post()).statusCode).toBe(200);
  });

  it('does not block reads that carry a foreign Origin (CORS governs reading)', async () => {
    await start();
    const response = await current!.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS (NFR-13)', () => {
  const preflight = (origin: string) =>
    current!.app.inject({
      method: 'OPTIONS',
      url: '/api/_probe',
      headers: { origin, 'access-control-request-method': 'POST' },
    });

  it('allows the SPA origin and no wildcard', async () => {
    await start();
    const response = await preflight(SPA_ORIGIN);
    expect(response.headers['access-control-allow-origin']).toBe(SPA_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('gives no allow headers to any other origin', async () => {
    await start();
    for (const origin of ['https://evil.example', 'http://localhost:5174', 'null']) {
      const response = await preflight(origin);
      expect(response.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('adds the SPA origin to simple responses too', async () => {
    await start();
    const response = await current!.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: SPA_ORIGIN },
    });
    expect(response.headers['access-control-allow-origin']).toBe(SPA_ORIGIN);
  });
});

describe('response headers', () => {
  it('sends nosniff on every response, including errors', async () => {
    await start();
    const ok = await current!.app.inject({ method: 'GET', url: '/api/health' });
    const missing = await current!.app.inject({ method: 'GET', url: '/api/nope' });
    const rejected = await current!.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'evil.example' },
    });
    for (const response of [ok, missing, rejected]) {
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('builds download headers with attachment, nosniff and no-store (AC-44)', () => {
    expect(downloadHeaders('invoices.cleaned.csv')).toEqual({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="invoices.cleaned.csv"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
  });

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\temp\\data.csv', 'data.csv'],
    ['a"b\r\nSet-Cookie: x=1.csv', 'a_b_Set-Cookie_x_1.csv'],
    ['отчёт.csv', '_.csv'],
    ['...', 'download'],
    ['', 'download'],
  ])('sanitizes the filename %j', (input, expected) => {
    const disposition = downloadHeaders(input)['content-disposition'];
    expect(disposition).toBe(`attachment; filename="${expected}"`);
    expect(disposition).not.toMatch(/[\r\n]/);
  });
});
