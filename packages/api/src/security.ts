import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { LOOPBACK_HOSTS, type Config } from './config.js';
import { ApiError } from './errors.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Lower-cased host name without the port; keeps IPv6 literals bracketed. */
export function hostnameOf(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0] ?? '';
}

/** Rejects non-loopback Host (DNS rebinding) and foreign Origin on writes, then applies strict CORS (NFR-13). */
export async function registerSecurity(app: FastifyInstance, config: Config): Promise<void> {
  const allowedHosts = new Set([
    ...LOOPBACK_HOSTS,
    config.host.toLowerCase(),
    ...config.allowedHosts,
  ]);
  const ownOrigins = [...allowedHosts].map((h) => `http://${h}:${config.port}`);
  const allowedOrigins = new Set([config.webOrigin, ...ownOrigins]);

  app.addHook('onRequest', async (request) => {
    const host = request.headers.host;
    if (host === undefined || !allowedHosts.has(hostnameOf(host))) {
      throw new ApiError(403, 'FORBIDDEN_HOST', 'Unexpected Host header');
    }
    const origin = request.headers.origin;
    if (origin !== undefined && STATE_CHANGING.has(request.method) && !allowedOrigins.has(origin)) {
      throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'Unexpected Origin header');
    }
  });

  app.addHook('onSend', async (_request, reply) => {
    void reply.header('x-content-type-options', 'nosniff');
  });

  await app.register(cors, { origin: [config.webOrigin], credentials: false });
}

/** Headers for a CSV download: attachment, no sniffing, no caching, and a header-safe filename (NFR-13). */
export function downloadHeaders(filename: string): Record<string, string> {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'download';
  return {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${safe}"`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  };
}
