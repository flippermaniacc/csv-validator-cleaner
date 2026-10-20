import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/connection.js';
import { registerErrorHandling } from './errors.js';
import { registerSecurity } from './security.js';

export interface AppDeps {
  config: Config;
  db: Db;
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

  return app;
}
