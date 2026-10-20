import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { openDatabase, type Db } from '../../src/db/connection.js';

export const SPA_ORIGIN = 'http://localhost:5173';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 3001,
    dataDir: '/unused',
    webOrigin: SPA_ORIGIN,
    allowedHosts: [],
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  close(): Promise<void>;
}

/** An app on an in-memory database, with extra probe routes registered before it starts. */
export async function makeApp(
  options: {
    config?: Partial<Config>;
    logger?: FastifyServerOptions['logger'];
    routes?: (app: FastifyInstance) => void;
  } = {},
): Promise<TestApp> {
  const db = openDatabase(':memory:');
  const app = await buildApp({
    config: testConfig(options.config),
    db,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  options.routes?.(app);
  await app.ready();
  return {
    app,
    db,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
