import { validateSchemaDefinition, type RegexEngine } from '@csv-validator/core';
import type { FastifyInstance } from 'fastify';
import type { SchemaRecord, SchemasRepo } from '../db/schemas.repo.js';
import { ApiError } from '../errors.js';

export interface SchemaRouteDeps {
  repo: SchemasRepo;
  regex: RegexEngine;
  now: () => Date;
  newId: () => string;
}

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const params = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: UUID } },
} as const;
const body = { type: 'object' } as const;

/** Schema CRUD (FR-1 to FR-5). Definitions are validated by `core`, Ajv only guards the transport. */
export function registerSchemaRoutes(app: FastifyInstance, deps: SchemaRouteDeps): void {
  const { repo, regex } = deps;

  const validated = (input: unknown) => {
    const result = validateSchemaDefinition(input, regex);
    if (!result.ok) {
      throw new ApiError(422, 'INVALID_SCHEMA', 'The schema definition is invalid', {
        issues: result.issues,
      });
    }
    return result.schema;
  };
  const nameTaken = (name: string) =>
    new ApiError(409, 'SCHEMA_NAME_TAKEN', `A schema named "${name}" already exists`);
  const notFound = () => new ApiError(404, 'SCHEMA_NOT_FOUND', 'Schema not found');

  app.post('/api/schemas', { schema: { body } }, async (request, reply) => {
    const definition = validated(request.body);
    const timestamp = deps.now().toISOString();
    const record: SchemaRecord = {
      id: deps.newId(),
      definition,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!repo.create(record).ok) throw nameTaken(definition.name);
    return reply.code(201).header('location', `/api/schemas/${record.id}`).send(present(record));
  });

  app.get('/api/schemas', async () => repo.list().map(present));

  app.get<{ Params: { id: string } }>(
    '/api/schemas/:id',
    { schema: { params } },
    async (request) => {
      const record = repo.get(request.params.id);
      if (!record) throw notFound();
      return present(record);
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/schemas/:id',
    { schema: { params, body } },
    async (request) => {
      const definition = validated(request.body);
      const result = repo.update(request.params.id, definition, deps.now().toISOString());
      if (result === null) throw notFound();
      if (!result.ok) throw nameTaken(definition.name);
      return present(repo.get(request.params.id) as SchemaRecord);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/schemas/:id',
    { schema: { params } },
    async (request, reply) => {
      if (!repo.delete(request.params.id)) throw notFound();
      return reply.code(204).send();
    },
  );
}

function present(record: SchemaRecord) {
  return {
    id: record.id,
    name: record.definition.name,
    columns: record.definition.columns,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
