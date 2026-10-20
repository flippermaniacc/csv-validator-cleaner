import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import type { ValidationService } from '../services/validation.service.js';
import { presentRun } from './present.js';

/** Upload limit (FR-7): exactly 10 MiB is accepted, one byte more is rejected. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function registerValidationRoutes(
  app: FastifyInstance,
  service: ValidationService,
): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 6 },
  });

  app.post('/api/validations', async (request, reply) => {
    if (!request.isMultipart()) {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected multipart/form-data');
    }

    let schemaId: string | undefined;
    let upload: { bytes: Buffer; filename: string } | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'schemaId' && typeof part.value === 'string')
            schemaId = part.value;
        } else if (part.fieldname === 'file' && !upload) {
          upload = { bytes: await part.toBuffer(), filename: safeFilename(part.filename) };
        } else {
          part.file.resume();
        }
      }
    } catch (error) {
      throw translateUploadError(error);
    }

    if (!upload) throw new ApiError(400, 'VALIDATION_ERROR', 'A "file" part is required');
    if (!schemaId || !UUID.test(schemaId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'A valid "schemaId" field is required');
    }

    const run = await service.validate({
      bytes: upload.bytes,
      filename: upload.filename,
      schemaId,
    });
    return reply.code(201).send(presentRun(run));
  });
}

/** Strips path parts and control characters; the name is metadata only, never a path (design 4.2). */
export function safeFilename(raw: string | undefined): string {
  const base = (raw ?? '').split(/[/\\]/).pop() ?? '';
  const printable = Array.from(base).filter((ch) => {
    const code = ch.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
  return printable.join('').trim().slice(0, 255) || 'upload.csv';
}

function translateUploadError(error: unknown): unknown {
  const code = (error as { code?: string }).code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new ApiError(413, 'FILE_TOO_LARGE', 'The file exceeds the 10 MiB limit');
  }
  if (code === 'FST_FILES_LIMIT') {
    return new ApiError(400, 'VALIDATION_ERROR', 'Upload exactly one file');
  }
  return error;
}
