import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { isLoopbackHost, loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';

const config = loadConfig();
mkdirSync(join(config.dataDir, 'cleaned'), { recursive: true });

const db = openDatabase(join(config.dataDir, 'app.db'));
const app = await buildApp({ config, db, logger: { level: process.env['LOG_LEVEL'] ?? 'info' } });

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
