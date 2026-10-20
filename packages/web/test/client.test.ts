import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient } from '../src/api/client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientWith(response: Response | Error) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { api: createApiClient(fetchImpl), fetchImpl };
}

describe('createApiClient', () => {
  it('lists schemas with GET /api/schemas', async () => {
    const { api, fetchImpl } = clientWith(json(200, [{ id: 'a' }]));
    expect(await api.listSchemas()).toEqual([{ id: 'a' }]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/schemas', { method: 'GET' });
  });

  it('sends the draft as JSON on create and update', async () => {
    const draft = { name: 'S', columns: [{ name: 'a', type: 'string' as const }] };
    const create = clientWith(json(201, { id: 'new' }));
    await create.api.createSchema(draft);
    expect(create.fetchImpl).toHaveBeenCalledWith('/api/schemas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });

    const update = clientWith(json(200, { id: 'x' }));
    await update.api.updateSchema('x', draft);
    expect(update.fetchImpl).toHaveBeenCalledWith('/api/schemas/x', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
  });

  it('gets by id with the id encoded', async () => {
    const { api, fetchImpl } = clientWith(json(200, { id: 'a/b' }));
    await api.getSchema('a/b');
    expect(fetchImpl).toHaveBeenCalledWith('/api/schemas/a%2Fb', { method: 'GET' });
  });

  it('treats 204 as success without a body', async () => {
    const { api, fetchImpl } = clientWith(new Response(null, { status: 204 }));
    await expect(api.deleteSchema('x')).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith('/api/schemas/x', { method: 'DELETE' });
  });

  it('turns an error envelope into an ApiRequestError with code, details and request id', async () => {
    const issues = [{ path: ['columns', 0, 'min'], column: 'c', property: 'min', message: 'bad' }];
    const { api } = clientWith(
      json(422, {
        error: {
          code: 'INVALID_SCHEMA',
          message: 'invalid',
          details: { issues },
          requestId: 'req-1',
        },
      }),
    );
    const error = await api.createSchema({ name: 'S', columns: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 422,
      code: 'INVALID_SCHEMA',
      message: 'invalid',
      requestId: 'req-1',
    });
    expect((error as ApiRequestError).issues).toEqual(issues);
  });

  it('exposes no issues for other errors', async () => {
    const { api } = clientWith(
      json(409, { error: { code: 'SCHEMA_NAME_TAKEN', message: 'taken' } }),
    );
    const error = (await api
      .createSchema({ name: 'S', columns: [] })
      .catch((e: unknown) => e)) as ApiRequestError;
    expect(error.status).toBe(409);
    expect(error.issues).toEqual([]);
  });

  it('reports a non-JSON error body (such as a proxy 502) with the status', async () => {
    const { api } = clientWith(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = (await api.listSchemas().catch((e: unknown) => e)) as ApiRequestError;
    expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('reports an unreachable server as status 0', async () => {
    const { api } = clientWith(new TypeError('Failed to fetch'));
    const error = (await api.listSchemas().catch((e: unknown) => e)) as ApiRequestError;
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
