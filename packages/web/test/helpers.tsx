import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../src/App';
import type { ApiClient, SchemaResource } from '../src/api/client';
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
