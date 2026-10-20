import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ApiClient, RunDetail, RunSummary, SchemaResource } from '../src/api/client';
import { fakeApi, renderApp } from './helpers';

/** A small in-memory stand-in for the API, so the pages are exercised together. */
function statefulApi() {
  const schemas: SchemaResource[] = [];
  const runs = new Map<string, RunDetail>();
  const api = fakeApi({
    createSchema: async (draft) => {
      const schema: SchemaResource = {
        id: '11111111-1111-4111-8111-111111111111',
        name: draft.name,
        columns: draft.columns.map((c) => ({
          required: false,
          unique: false,
          ...c,
        })) as SchemaResource['columns'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      schemas.push(schema);
      return schema;
    },
    listSchemas: async () => [...schemas],
    validate: async (schemaId, file) => {
      const schema = schemas.find((s) => s.id === schemaId) as SchemaResource;
      const summary: RunSummary = {
        id: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-02-03T04:05:06.000Z',
        originalFilename: file.name,
        fileSizeBytes: file.size,
        fileSha256: 'abc',
        schema: { id: schema.id, name: schema.name },
        status: 'completed',
        fileError: null,
        detectedEncoding: 'utf-8',
        detectedDelimiter: ',',
        totalRows: 2000,
        validRows: 500,
        invalidRows: 1500,
        duplicateRowsDropped: 0,
        totalErrors: 1500,
        truncated: true,
        errorCountsByCode: { INVALID_TYPE: 1500 },
        passthroughColumns: [],
        sanitizedCells: 0,
        cleanedSizeBytes: 1024,
      };
      runs.set(summary.id, {
        ...summary,
        schemaSnapshot: { id: schema.id, name: schema.name, columns: schema.columns },
        errors: { items: [], total: 1000, offset: 0, limit: 100 },
      });
      return summary;
    },
    getRun: async (id) => runs.get(id) as RunDetail,
    listRunErrors: async () => ({
      items: [
        {
          row: 1,
          column: 'n',
          code: 'INVALID_TYPE',
          message: 'Expected an integer, got "x"',
          value: 'x',
        },
      ],
      total: 1000,
      offset: 0,
      limit: 50,
    }),
  } satisfies Partial<ApiClient>);
  return api;
}

describe('the main flow through the pages (AC-38)', () => {
  it('creates a schema, uploads a CSV, shows the summary and errors, and offers the download', async () => {
    const api = statefulApi();
    const u = userEvent.setup();
    renderApp(api, '/schemas');

    // Create a schema.
    await u.click(await screen.findByRole('link', { name: 'New schema' }));
    await u.type(screen.getByLabelText('Schema name'), 'Numbers');
    const column = within(screen.getByRole('group', { name: 'Column 1' }));
    await u.type(column.getByLabelText('Name'), 'n');
    await u.selectOptions(column.getByLabelText('Type'), 'integer');
    await u.click(screen.getByRole('button', { name: 'Save schema' }));
    expect(await screen.findByRole('rowheader', { name: 'Numbers' })).toBeInTheDocument();

    // Upload a CSV with that schema.
    await u.click(screen.getByRole('link', { name: 'Validate' }));
    const file = new File(['n\nx\n'], 'numbers.csv', { type: 'text/csv' });
    await u.upload(await screen.findByLabelText('CSV file'), file);
    await u.click(screen.getByRole('button', { name: 'Validate' }));

    // See the summary, the error table, the exact-total notice and the download.
    expect(await screen.findByRole('heading', { name: 'numbers.csv' })).toBeInTheDocument();
    expect(screen.getByText('Errors found')).toBeInTheDocument();
    expect(screen.getByText('2,000')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(
      within(screen.getByRole('table')).getByText('Expected an integer, got "x"'),
    ).toBeInTheDocument();
    expect(screen.getByText(/found 1,500 errors in total/)).toHaveTextContent(
      'Only the first 1,000 are listed',
    );
    expect(screen.getByRole('link', { name: 'Download cleaned CSV' })).toHaveAttribute(
      'href',
      '/api/validations/33333333-3333-4333-8333-333333333333/cleaned',
    );
  });
});
