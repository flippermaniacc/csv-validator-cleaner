import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiEntry = join(root, 'packages/api/dist/main.js');

if (!existsSync(apiEntry)) {
  console.error('The server is not built yet. Run `npm run build` first.');
  process.exit(1);
}
if (!existsSync(join(root, 'packages/web/dist/index.html'))) {
  console.warn('The web app is not built, so only the API will be served. Run `npm run build`.');
}

process.env.PORT ??= '3001';
process.env.DATA_DIR ??= join(root, 'data');
process.env.NODE_ENV ??= 'production';

const host = process.env.HOST ?? '127.0.0.1';
console.log(`CSV Validator: http://${host}:${process.env.PORT}  (data in ${process.env.DATA_DIR})`);

await import(apiEntry);
