import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { isLoopbackHost, loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { RunsRepo } from './db/runs.repo.js';
import { CleanedFileStore } from './storage/cleaned-files.js';

const config = loadConfig();
mkdirSync(join(config.dataDir, 'cleaned'), { recursive: true });

const db = openDatabase(join(config.dataDir, 'app.db'));
const runs = new RunsRepo(db);
const removed = await new CleanedFileStore(config.dataDir).sweep((id) => runs.has(id));

const app = await buildApp({ config, db, logger: { level: process.env['LOG_LEVEL'] ?? 'info' } });

if (removed.length > 0) app.log.info({ count: removed.length }, 'removed orphaned cleaned files');

if (!isLoopbackHost(config.host)) {
  app.log.warn(`Listening on ${config.host}: this API has no authentication (NFR-8)`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().finally(() => {
      db.close();
      process.exit(0);
    });
  });
}

await app.listen({ host: config.host, port: config.port });
