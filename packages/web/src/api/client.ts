import type { ColumnDefinition, SchemaDefinitionInput, SchemaIssue } from '@csv-validator/core';

export interface SchemaResource {
  id: string;
  name: string;
  columns: ColumnDefinition[];
  createdAt: string;
  updatedAt: string;
}

/** A failed API call; `status` 0 means the server could not be reached. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** Per-column problems from a 422 `INVALID_SCHEMA` response. */
  get issues(): SchemaIssue[] {
    const issues = (this.details as { issues?: unknown } | undefined)?.issues;
    return Array.isArray(issues) ? (issues as SchemaIssue[]) : [];
  }
}

export interface ApiClient {
  listSchemas(): Promise<SchemaResource[]>;
  getSchema(id: string): Promise<SchemaResource>;
  createSchema(draft: SchemaDefinitionInput): Promise<SchemaResource>;
  updateSchema(id: string, draft: SchemaDefinitionInput): Promise<SchemaResource>;
  deleteSchema(id: string): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Thin typed wrapper over the JSON API; it validates nothing, the server is authoritative (FR-30). */
export function createApiClient(
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
  baseUrl = '/api',
): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server');
    }

    if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;
    throw await toError(response);
  }

  return {
    listSchemas: () => request('GET', '/schemas'),
    getSchema: (id) => request('GET', `/schemas/${encodeURIComponent(id)}`),
    createSchema: (draft) => request('POST', '/schemas', draft),
    updateSchema: (id, draft) => request('PUT', `/schemas/${encodeURIComponent(id)}`, draft),
    deleteSchema: (id) => request('DELETE', `/schemas/${encodeURIComponent(id)}`),
  };
}

async function toError(response: Response): Promise<ApiRequestError> {
  try {
    const { error } = (await response.json()) as {
      error: { code: string; message: string; details?: unknown; requestId?: string };
    };
    return new ApiRequestError(
      response.status,
      error.code,
      error.message,
      error.details,
      error.requestId,
    );
  } catch {
    return new ApiRequestError(
      response.status,
      'HTTP_ERROR',
      `Request failed with status ${response.status}`,
    );
  }
}
