import type {
  ColumnDefinition,
  FileError,
  RowError,
  RowErrorCode,
  SchemaDefinitionInput,
  SchemaIssue,
} from '@csv-validator/core';

export interface SchemaResource {
  id: string;
  name: string;
  columns: ColumnDefinition[];
  createdAt: string;
  updatedAt: string;
}

/** A validation run as listed and summarized (the API's run summary). */
export interface RunSummary {
  id: string;
  createdAt: string;
  originalFilename: string;
  fileSizeBytes: number;
  fileSha256: string;
  /** `id` is null once the schema has been deleted; `name` is kept from the snapshot. */
  schema: { id: string | null; name: string };
  status: 'completed' | 'failed';
  fileError: FileError | null;
  detectedEncoding: string | null;
  detectedDelimiter: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRowsDropped: number;
  /** Exact, even when only the first 1000 errors are stored. */
  totalErrors: number;
  truncated: boolean;
  errorCountsByCode: Partial<Record<RowErrorCode, number>>;
  passthroughColumns: string[];
  sanitizedCells: number;
  cleanedSizeBytes: number | null;
}

export interface ErrorPage {
  items: RowError[];
  /** Stored errors matching the filter (at most 1000 per run). */
  total: number;
  offset: number;
  limit: number;
}

export interface RunDetail extends RunSummary {
  schemaSnapshot: { id: string; name: string; columns: ColumnDefinition[] };
  errors: ErrorPage;
}

export interface RunPage {
  items: RunSummary[];
  nextCursor: string | null;
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
  validate(schemaId: string, file: File): Promise<RunSummary>;
  listRuns(options?: { limit?: number; cursor?: string }): Promise<RunPage>;
  getRun(id: string): Promise<RunDetail>;
  listRunErrors(
    id: string,
    options?: { offset?: number; limit?: number; code?: RowErrorCode },
  ): Promise<ErrorPage>;
  deleteRun(id: string): Promise<void>;
  /** URL of the cleaned CSV download for a run. */
  cleanedUrl(id: string): string;
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
          : body instanceof FormData
            ? { body }
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
    validate: (schemaId, file) => {
      const form = new FormData();
      form.append('schemaId', schemaId);
      form.append('file', file, file.name);
      return request('POST', '/validations', form);
    },
    listRuns: (options) => request('GET', `/validations${query(options)}`),
    getRun: (id) => request('GET', `/validations/${encodeURIComponent(id)}`),
    listRunErrors: (id, options) =>
      request('GET', `/validations/${encodeURIComponent(id)}/errors${query(options)}`),
    deleteRun: (id) => request('DELETE', `/validations/${encodeURIComponent(id)}`),
    cleanedUrl: (id) => `${baseUrl}/validations/${encodeURIComponent(id)}/cleaned`,
  };
}

function query(options: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
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
