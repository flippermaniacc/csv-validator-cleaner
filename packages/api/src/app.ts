import { randomUUID } from 'node:crypto';
import type { RegexEngine } from '@csv-validator/core';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/connection.js';
import { RunsRepo } from './db/runs.repo.js';
import { SchemasRepo } from './db/schemas.repo.js';
import { registerErrorHandling } from './errors.js';
import { re2Engine } from './regex-re2.js';
import { loadSpaIndex, registerStatic } from './static.js';
import { registerSchemaRoutes } from './routes/schemas.routes.js';
import { registerRunRoutes } from './routes/runs.routes.js';
import { registerValidationRoutes } from './routes/validations.routes.js';
import { ValidationService } from './services/validation.service.js';
import { CleanedFileStore } from './storage/cleaned-files.js';
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

  const spaIndex = loadSpaIndex(config.webDist);
  registerErrorHandling(app, { spaIndex });
  await registerSecurity(app, config);

  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  const schemas = new SchemasRepo(db);
  const regex = deps.regex ?? re2Engine;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;

  const runs = new RunsRepo(db);
  const files = new CleanedFileStore(config.dataDir);

  registerSchemaRoutes(app, { repo: schemas, regex, now, newId });
  await registerValidationRoutes(
    app,
    new ValidationService({ schemas, runs, files, regex, now, newId }),
  );
  registerRunRoutes(app, { runs, files });
  if (spaIndex) await registerStatic(app, config.webDist);

  return app;
}
