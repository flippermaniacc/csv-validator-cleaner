import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app.js';

const INDEX =
  '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const dirs: string[] = [];
let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function webDist(withIndex = true) {
  const dir = mkdtempSync(join(tmpdir(), 'csvv-web-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  if (withIndex) writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app");');
  writeFileSync(join(dir, 'assets', 'app.css'), 'body{margin:0}');
  return dir;
}

const start = async (dir: string) => (current = await makeApp({ config: { webDist: dir } }));
const html = { accept: 'text/html,application/xhtml+xml' };

describe('serving the built SPA (design D-14)', () => {
  it('serves index.html at / with strict security headers', async () => {
    const { app } = await start(webDist());
    const response = await app.inject({ method: 'GET', url: '/', headers: html });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toBe(INDEX);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves built assets with the right types', async () => {
    const { app } = await start(webDist());
    const js = await app.inject({ method: 'GET', url: '/assets/app.js' });
    const css = await app.inject({ method: 'GET', url: '/assets/app.css' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.body).toBe('console.log("app");');
    expect(css.headers['content-type']).toMatch(/text\/css/);
  });

  it('falls back to index.html for client-side routes opened in a browser', async () => {
    const { app } = await start(webDist());
    for (const url of ['/schemas', '/schemas/abc-123', '/history']) {
      const response = await app.inject({ method: 'GET', url, headers: html });
      expect(response.statusCode, url).toBe(200);
      expect(response.body).toBe(INDEX);
      expect(response.headers['content-security-policy']).toBeDefined();
    }
  });

  it('keeps API 404s as JSON, even when the client accepts HTML', async () => {
    const { app } = await start(webDist());
    const response = await app.inject({ method: 'GET', url: '/api/nope', headers: html });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('answers a missing asset that is not a page request with a JSON 404', async () => {
    const { app } = await start(webDist());
    const response = await app.inject({
      method: 'GET',
      url: '/assets/missing.js',
      headers: { accept: '*/*' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('does not fall back for non-GET requests', async () => {
    const { app } = await start(webDist());
    const response = await app.inject({ method: 'POST', url: '/schemas', headers: html });
    expect(response.statusCode).toBe(404);
  });

  it('still routes the API normally', async () => {
    const { app } = await start(webDist());
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({
      status: 'ok',
    });
    expect((await app.inject({ method: 'GET', url: '/api/schemas' })).json()).toEqual([]);
  });

  it('applies the Host check to static files too (NFR-13)', async () => {
    const { app } = await start(webDist());
    for (const url of ['/', '/assets/app.js', '/schemas']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { ...html, host: 'evil.example' },
      });
      expect(response.statusCode, url).toBe(403);
    }
  });

  it('serves no SPA when the web package has not been built', async () => {
    const { app } = await start(webDist(false));
    const page = await app.inject({ method: 'GET', url: '/', headers: html });
    expect(page.statusCode).toBe(404);
    expect(page.json().error.code).toBe('NOT_FOUND');
    expect((await app.inject({ method: 'GET', url: '/assets/app.js' })).statusCode).toBe(404);
  });

  it('does not let path traversal escape the web directory', async () => {
    const { app } = await start(webDist());
    for (const url of ['/../package.json', '/%2e%2e/package.json', '/assets/..%2f..%2fsecret']) {
      const response = await app.inject({ method: 'GET', url, headers: { accept: '*/*' } });
      expect([403, 404], url).toContain(response.statusCode);
      expect(response.body).not.toContain('"name"');
    }
  });
});
