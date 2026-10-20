import { randomUUID } from 'node:crypto';
import type { RegexEngine } from '@csv-validator/core';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/connection.js';
import { SchemasRepo } from './db/schemas.repo.js';
import { registerErrorHandling } from './errors.js';
import { re2Engine } from './regex-re2.js';
import { registerSchemaRoutes } from './routes/schemas.routes.js';
import { registerSecurity } from './security.js';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Defaults to RE2; tests may inject a lighter engine. */
  regex?: RegexEngine;
  now?: () => Date;
  newId?: () => string;
  logger?: FastifyServerOptions['logger'];
}

/** Builds the Fastify app; routes receive their dependencies explicitly (design 4.1). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    trustProxy: false,
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);
  await registerSecurity(app, config);

  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  registerSchemaRoutes(app, {
    repo: new SchemasRepo(db),
    regex: deps.regex ?? re2Engine,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? randomUUID,
  });

  return app;
}
