import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp, type AppDeps } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { openDatabase, type Db } from '../../src/db/connection.js';

export const SPA_ORIGIN = 'http://localhost:5173';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 3001,
    dataDir: '/unused',
    webOrigin: SPA_ORIGIN,
    webDist: '/nonexistent-web-dist',
    allowedHosts: [],
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  /** Temp data directory holding `cleaned/` (always created). */
  dataDir: string;
  close(): Promise<void>;
}

/** An app on an in-memory database, with extra probe routes registered before it starts. */
export async function makeApp(
  options: {
    config?: Partial<Config>;
    logger?: FastifyServerOptions['logger'];
    deps?: Partial<Omit<AppDeps, 'config' | 'db'>>;
    routes?: (app: FastifyInstance) => void;
  } = {},
): Promise<TestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'csvv-data-'));
  mkdirSync(join(dataDir, 'cleaned'));
  const db = openDatabase(':memory:');
  const app = await buildApp({
    config: testConfig({ dataDir, ...options.config }),
    db,
    ...options.deps,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  options.routes?.(app);
  await app.ready();
  return {
    app,
    db,
    dataDir,
    close: async () => {
      await app.close();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Part {
  name: string;
  value?: string;
  filename?: string;
  data?: Buffer | string;
}

/** Builds a multipart/form-data payload by hand so tests control sizes and part order. */
export function multipartBody(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----csvvalidatortest7f3a';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      `Content-Disposition: form-data; name="${part.name}"` +
      (part.filename === undefined ? '' : `; filename="${part.filename}"`);
    const type = part.filename === undefined ? '' : '\r\nContent-Type: text/csv';
    chunks.push(Buffer.from(`--${boundary}\r\n${disposition}${type}\r\n\r\n`));
    chunks.push(
      Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data ?? part.value ?? ''),
    );
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
