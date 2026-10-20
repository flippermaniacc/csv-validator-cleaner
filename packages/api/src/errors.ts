import type { FastifyError, FastifyInstance } from 'fastify';

/** Request-level failure rendered as the error envelope (design 4.1). */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

function envelope(requestId: string, code: string, message: string, details?: unknown): Envelope {
  return { error: { code, message, ...(details === undefined ? {} : { details }), requestId } };
}

/**
 * Registers the envelope-producing handlers. Logs only ids and codes, never messages,
 * because parser errors can quote request content (NFR-9).
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send(
        envelope(
          request.id,
          'NOT_FOUND',
          `Route ${request.method} ${request.routeOptions.url ?? 'unknown'} not found`,
        ),
      );
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      void reply
        .code(error.statusCode)
        .send(envelope(request.id, error.code, error.message, error.details));
      return;
    }

    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      request.log.info({ statusCode: status, code: error.code }, 'client error');
      const code =
        status === 413
          ? 'PAYLOAD_TOO_LARGE'
          : error.validation
            ? 'VALIDATION_ERROR'
            : 'BAD_REQUEST';
      void reply.code(status).send(envelope(request.id, code, clientMessage(status, error)));
      return;
    }

    request.log.error({ errorName: error.name, code: error.code }, 'unhandled error');
    void reply.code(500).send(envelope(request.id, 'INTERNAL_ERROR', 'Internal server error'));
  });
}

function clientMessage(status: number, error: FastifyError): string {
  if (error.validation) return 'The request did not match the expected shape';
  if (status === 413) return 'The request body is too large';
  return 'The request could not be processed';
}
