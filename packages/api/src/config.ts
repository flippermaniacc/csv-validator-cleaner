import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  host: string;
  port: number;
  /** Absolute directory holding `app.db` and `cleaned/`. */
  dataDir: string;
  /** The one browser origin allowed by CORS and the Origin check (NFR-13). */
  webOrigin: string;
  /** Built SPA to serve; skipped when `index.html` is absent. */
  webDist: string;
  /** Extra Host header names accepted besides loopback and `host`. */
  allowedHosts: string[];
}

// packages/api/{src,dist}/config.js -> <repo>/packages/web/dist and <repo>/data, whatever the cwd
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env['PORT'] ?? 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${env['PORT']}"`);
  }
  return {
    host: env['HOST'] ?? '127.0.0.1',
    port,
    dataDir: resolve(env['DATA_DIR'] ?? DEFAULT_DATA_DIR),
    webOrigin: env['WEB_ORIGIN'] ?? 'http://localhost:5173',
    webDist: resolve(env['WEB_DIST'] ?? DEFAULT_WEB_DIST),
    allowedHosts: (env['ALLOWED_HOSTS'] ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** The API is unauthenticated, so anything but loopback deserves a warning (NFR-8). */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.includes(host.toLowerCase()) || host === '::1';
}
