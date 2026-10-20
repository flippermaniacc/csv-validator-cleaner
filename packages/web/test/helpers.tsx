import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../src/App';
import type { ApiClient, RunDetail, RunSummary, SchemaResource } from '../src/api/client';
import { ApiProvider } from '../src/api/context';

export type FakeApi = { [K in keyof ApiClient]: ReturnType<typeof vi.fn<ApiClient[K]>> };

export function fakeApi(overrides: Partial<ApiClient> = {}): FakeApi {
  return {
    listSchemas: vi.fn<ApiClient['listSchemas']>().mockResolvedValue([]),
    getSchema: vi.fn<ApiClient['getSchema']>().mockRejectedValue(new Error('unexpected getSchema')),
    createSchema: vi
      .fn<ApiClient['createSchema']>()
      .mockRejectedValue(new Error('unexpected createSchema')),
    updateSchema: vi
      .fn<ApiClient['updateSchema']>()
      .mockRejectedValue(new Error('unexpected updateSchema')),
    deleteSchema: vi.fn<ApiClient['deleteSchema']>().mockResolvedValue(undefined),
    validate: vi.fn<ApiClient['validate']>().mockRejectedValue(new Error('unexpected validate')),
    listRuns: vi.fn<ApiClient['listRuns']>().mockResolvedValue({ items: [], nextCursor: null }),
    getRun: vi.fn<ApiClient['getRun']>().mockRejectedValue(new Error('unexpected getRun')),
    listRunErrors: vi
      .fn<ApiClient['listRunErrors']>()
      .mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 }),
    deleteRun: vi.fn<ApiClient['deleteRun']>().mockResolvedValue(undefined),
    cleanedUrl: vi.fn<ApiClient['cleanedUrl']>((id) => `/api/validations/${id}/cleaned`),
    ...overrides,
  } as FakeApi;
}

export function renderApp(api: ApiClient, route = '/schemas') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
}

export function schemaResource(overrides: Partial<SchemaResource> = {}): SchemaResource {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Invoices',
    columns: [
      { name: 'id', type: 'integer', required: true, unique: true, min: 1 },
      { name: 'issued', type: 'date', required: false, unique: false, dateFormat: 'DD.MM.YYYY' },
      { name: 'currency', type: 'string', required: false, unique: false, enum: ['USD', 'EUR'] },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

export const RUN_ID = '33333333-3333-4333-8333-333333333333';

export function runSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: RUN_ID,
    createdAt: '2026-02-03T04:05:06.000Z',
    originalFilename: 'invoices.csv',
    fileSizeBytes: 2048,
    fileSha256: 'abc',
    schema: { id: '11111111-1111-4111-8111-111111111111', name: 'Invoices' },
    status: 'completed',
    fileError: null,
    detectedEncoding: 'utf-8',
    detectedDelimiter: ';',
    totalRows: 1200,
    validRows: 1150,
    invalidRows: 50,
    duplicateRowsDropped: 3,
    totalErrors: 62,
    truncated: false,
    errorCountsByCode: { REQUIRED: 10, INVALID_DATE: 40, NOT_UNIQUE: 12 },
    passthroughColumns: ['notes'],
    sanitizedCells: 7,
    cleanedSizeBytes: 4096,
    ...overrides,
  };
}

export function runDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  const summary = runSummary(overrides);
  return {
    ...summary,
    schemaSnapshot: {
      id: summary.schema.id ?? 'gone',
      name: summary.schema.name,
      columns: [
        { name: 'id', type: 'integer', required: true, unique: true },
        { name: 'issued', type: 'date', required: false, unique: false },
      ],
    },
    errors: { items: [], total: summary.totalErrors, offset: 0, limit: 100 },
    ...overrides,
  };
}

export function errorRow(
  row: number,
  code: 'REQUIRED' | 'INVALID_DATE' | 'NOT_UNIQUE' = 'REQUIRED',
) {
  return {
    row,
    column: code === 'INVALID_DATE' ? 'issued' : 'id',
    code,
    message: `message for row ${row}`,
    value: code === 'REQUIRED' ? '' : `v${row}`,
  };
}
