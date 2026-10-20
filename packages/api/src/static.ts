import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Strict policy for the SPA: same-origin scripts and styles only, no framing, no <base> (NFR-13). */
export const HTML_SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
} as const;

/** The built SPA's index.html, or null when the web package has not been built. */
export function loadSpaIndex(webDist: string): string | null {
  const index = join(webDist, 'index.html');
  return existsSync(index) ? readFileSync(index, 'utf8') : null;
}

/** Serves the built SPA from the API origin, so production needs no CORS (design D-14). */
export async function registerStatic(app: FastifyInstance, webDist: string): Promise<void> {
  await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });

  app.addHook('onSend', async (_request, reply) => {
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      void reply.headers(HTML_SECURITY_HEADERS);
    }
  });
}
