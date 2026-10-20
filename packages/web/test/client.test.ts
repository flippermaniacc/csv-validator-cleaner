import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient } from '../src/api/client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientWith(response: Response | Error) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
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

  describe('runs', () => {
    it('uploads a file and schema id as multipart form data, leaving the content type to the browser', async () => {
      const { api, fetchImpl } = clientWith(json(201, { id: 'run-1' }));
      const file = new File(['id\n1\n'], 'in.csv', { type: 'text/csv' });
      await api.validate('schema-1', file);

      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/validations');
      expect(init.method).toBe('POST');
      expect(init.headers).toBeUndefined();
      const form = init.body as FormData;
      expect(form.get('schemaId')).toBe('schema-1');
      expect((form.get('file') as File).name).toBe('in.csv');
    });

    it('lists runs with only the options that were given', async () => {
      const { api, fetchImpl } = clientWith(json(200, { items: [], nextCursor: null }));
      await api.listRuns();
      await api.listRuns({ limit: 5 });
      await api.listRuns({ cursor: 'a b+c', limit: 2 });
      expect(fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
        '/api/validations',
        '/api/validations?limit=5',
        '/api/validations?cursor=a+b%2Bc&limit=2',
      ]);
    });

    it('gets a run and its errors with paging and filter options', async () => {
      const { api, fetchImpl } = clientWith(json(200, {}));
      await api.getRun('r/1');
      await api.listRunErrors('r1', { offset: 50, limit: 50, code: 'NOT_UNIQUE' });
      await api.listRunErrors('r1');
      expect(fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
        '/api/validations/r%2F1',
        '/api/validations/r1/errors?offset=50&limit=50&code=NOT_UNIQUE',
        '/api/validations/r1/errors',
      ]);
    });

    it('deletes a run and builds the download URL', async () => {
      const { api, fetchImpl } = clientWith(new Response(null, { status: 204 }));
      await expect(api.deleteRun('r1')).resolves.toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledWith('/api/validations/r1', { method: 'DELETE' });
      expect(api.cleanedUrl('r 1')).toBe('/api/validations/r%201/cleaned');
    });

    it('reports a server rejection of an upload with its code', async () => {
      const { api } = clientWith(
        json(413, { error: { code: 'FILE_TOO_LARGE', message: 'too big', requestId: 'q' } }),
      );
      const error = (await api
        .validate('s', new File(['x'], 'x.csv'))
        .catch((e: unknown) => e)) as ApiRequestError;
      expect(error).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    });
  });
});
