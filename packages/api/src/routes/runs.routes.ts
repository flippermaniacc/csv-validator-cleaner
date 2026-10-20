import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ROW_ERROR_CODES, type RowErrorCode } from '@csv-validator/core';
import type { FastifyInstance } from 'fastify';
import type { RunCursor, RunsRepo } from '../db/runs.repo.js';
import { ApiError } from '../errors.js';
import { downloadHeaders } from '../security.js';
import type { CleanedFileStore } from '../storage/cleaned-files.js';
import { presentRun } from './present.js';

export interface RunRouteDeps {
  runs: RunsRepo;
  files: CleanedFileStore;
}

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: UUID } },
} as const;

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_ERROR_LIMIT = 100;
const MAX_ERROR_LIMIT = 1000;

/** History, report, download and deletion of runs (FR-24, FR-25, FR-27). */
export function registerRunRoutes(app: FastifyInstance, deps: RunRouteDeps): void {
  const { runs, files } = deps;

  const requireRun = (id: string) => {
    const run = runs.get(id);
    if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', 'Validation run not found');
    return run;
  };

  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    '/api/validations',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: MAX_HISTORY_LIMIT },
            cursor: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? DEFAULT_HISTORY_LIMIT;
      const after = request.query.cursor ? decodeCursor(request.query.cursor) : undefined;
      const { items, hasMore } = runs.list(limit, after);
      const last = items.at(-1);
      return {
        items: items.map(presentRun),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/validations/:id',
    { schema: { params: idParams } },
    async (request) => {
      const run = requireRun(request.params.id);
      const page = runs.errors(run.id, { offset: 0, limit: DEFAULT_ERROR_LIMIT });
      return {
        ...presentRun(run),
        schemaSnapshot: run.schemaSnapshot,
        errors: { ...page, offset: 0, limit: DEFAULT_ERROR_LIMIT },
      };
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { offset?: number; limit?: number; code?: RowErrorCode };
  }>(
    '/api/validations/:id/errors',
    {
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          properties: {
            offset: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_ERROR_LIMIT },
            code: { type: 'string', enum: [...ROW_ERROR_CODES] },
          },
        },
      },
    },
    async (request) => {
      const run = requireRun(request.params.id);
      const offset = request.query.offset ?? 0;
      const limit = request.query.limit ?? DEFAULT_ERROR_LIMIT;
      const page = runs.errors(run.id, {
        offset,
        limit,
        ...(request.query.code ? { code: request.query.code } : {}),
      });
      return { ...page, offset, limit };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/validations/:id/cleaned',
    { schema: { params: idParams } },
    async (request, reply) => {
      const run = requireRun(request.params.id);
      const missing = new ApiError(404, 'CLEANED_FILE_NOT_FOUND', 'This run has no cleaned file');
      if (!run.cleanedPath) throw missing;

      const path = files.resolve(run.cleanedPath);
      const size = await stat(path).then(
        (s) => s.size,
        () => {
          throw missing;
        },
      );
      return reply
        .headers({
          ...downloadHeaders(cleanedName(run.originalFilename)),
          'content-length': String(size),
        })
        .send(createReadStream(path));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/validations/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const removed = runs.delete(request.params.id);
      if (!removed) throw new ApiError(404, 'RUN_NOT_FOUND', 'Validation run not found');
      // Row first, file second: a crash in between leaves an orphan the startup sweep removes (FR-DB3).
      if (removed.cleanedPath) {
        await files.remove(removed.cleanedPath).catch((error: unknown) => {
          request.log.warn({ errorName: (error as Error).name }, 'could not remove cleaned file');
        });
      }
      return reply.code(204).send();
    },
  );
}

/** `invoices.csv` downloads as `invoices.cleaned.csv`. */
function cleanedName(originalFilename: string): string {
  return `${originalFilename.replace(/\.csv$/i, '')}.cleaned.csv`;
}

function encodeCursor(cursor: RunCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): RunCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<RunCursor>;
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // fall through to the error below
  }
  throw new ApiError(400, 'INVALID_CURSOR', 'The cursor is not valid');
}
