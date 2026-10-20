import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../src/api/client';
import { errorRow, fakeApi, renderApp, RUN_ID, runDetail } from './helpers';

const open = (api: ReturnType<typeof fakeApi>) => renderApp(api, `/runs/${RUN_ID}`);

function withErrors(overrides = {}) {
  const api = fakeApi();
  api.getRun.mockResolvedValue(runDetail(overrides));
  api.listRunErrors.mockResolvedValue({
    items: [errorRow(2), errorRow(5, 'INVALID_DATE')],
    total: 62,
    offset: 0,
    limit: 50,
  });
  return api;
}

describe('RunDetail: summary (FR-25)', () => {
  it('shows the file, schema, result and the exact counts', async () => {
    open(withErrors());
    expect(await screen.findByRole('heading', { name: 'invoices.csv' })).toBeInTheDocument();
    expect(screen.getByText('Errors found')).toBeInTheDocument();
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText(/utf-8/)).toBeInTheDocument();
    expect(screen.getByText(/delimiter “;”/)).toBeInTheDocument();

    const card = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).closest('div') as HTMLElement;
    expect(within(card('Total rows')).getByText('1,200')).toBeInTheDocument();
    expect(within(card('Valid rows')).getByText('1,150')).toBeInTheDocument();
    expect(within(card('Invalid rows')).getByText('50')).toBeInTheDocument();
    expect(within(card('Duplicates dropped')).getByText('3')).toBeInTheDocument();
    expect(within(card('Errors')).getByText('62')).toBeInTheDocument();
    expect(within(card('Sanitized cells')).getByText('7')).toBeInTheDocument();
  });

  it('mentions pass-through columns', async () => {
    open(withErrors());
    expect(
      await screen.findByText(/kept as they are, without validation: notes/),
    ).toBeInTheDocument();
  });

  it('shows a clean run as all rows valid, with no errors section', async () => {
    const api = fakeApi();
    api.getRun.mockResolvedValue(
      runDetail({
        invalidRows: 0,
        validRows: 1200,
        totalErrors: 0,
        errorCountsByCode: {},
        duplicateRowsDropped: 0,
      }),
    );
    open(api);
    expect(await screen.findByText('All rows valid')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Errors' })).not.toBeInTheDocument();
    expect(api.listRunErrors).not.toHaveBeenCalled();
  });

  it('lists the columns of the schema snapshot', async () => {
    open(withErrors());
    await screen.findByRole('heading', { name: 'invoices.csv' });
    const details = screen.getByText('Schema used for this run').closest('details') as HTMLElement;
    expect(within(details).getByText(/integer, required, unique/)).toBeInTheDocument();
    expect(within(details).getByText(/date$/)).toBeInTheDocument();
  });
});

describe('RunDetail: download', () => {
  it('links to the cleaned CSV as a download', async () => {
    open(withErrors());
    const link = await screen.findByRole('link', { name: 'Download cleaned CSV' });
    expect(link).toHaveAttribute('href', `/api/validations/${RUN_ID}/cleaned`);
    expect(link).toHaveAttribute('download');
  });

  it('offers no download for a failed run and shows its file error', async () => {
    const api = fakeApi();
    api.getRun.mockResolvedValue(
      runDetail({
        status: 'failed',
        fileError: { code: 'MISSING_COLUMN', message: 'Header is missing schema columns: "email"' },
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        totalErrors: 0,
        errorCountsByCode: {},
        cleanedSizeBytes: null,
        passthroughColumns: [],
        sanitizedCells: 0,
      }),
    );
    open(api);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'MISSING_COLUMN: Header is missing schema columns: "email"',
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download cleaned CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/failed run has no cleaned file/)).toBeInTheDocument();
  });
});

describe('RunDetail: errors (FR-25, FR-29)', () => {
  it('shows the error table with row, column, code, message and value', async () => {
    open(withErrors());
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = within(rows[1]!).getAllByRole('cell');
    expect(first.map((c) => c.textContent)).toEqual([
      '2',
      'id',
      'REQUIREDRequired value missing',
      'message for row 2',
      '(empty)',
    ]);
    expect(within(rows[2]!).getByText('INVALID_DATE')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('v5')).toBeInTheDocument();
  });

  it('shows a dash when an error has no value, such as a wrong field count', async () => {
    const api = fakeApi();
    api.getRun.mockResolvedValue(
      runDetail({ totalErrors: 1, errorCountsByCode: { COLUMN_COUNT_MISMATCH: 1 } }),
    );
    api.listRunErrors.mockResolvedValue({
      items: [
        {
          row: 4,
          column: null,
          code: 'COLUMN_COUNT_MISMATCH',
          message: 'Expected 3 fields, got 2',
          value: null,
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
    });
    open(api);
    const row = (await screen.findAllByRole('row'))[1]!;
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(within(row).getByText('Wrong number of fields')).toBeInTheDocument();
  });

  it('lists exact counts per error type as filters, in catalog order', async () => {
    open(withErrors());
    const group = await screen.findByRole('group', { name: 'Filter by error type' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'All (62)',
      'Required value missing (10)',
      'Invalid date (40)',
      'Duplicate value (12)',
    ]);
    expect(within(group).getByRole('button', { name: 'All (62)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('filters by error type and starts again from the first page', async () => {
    const api = withErrors();
    const u = userEvent.setup();
    open(api);
    await screen.findByRole('table');
    api.listRunErrors.mockResolvedValue({
      items: [errorRow(9, 'NOT_UNIQUE')],
      total: 12,
      offset: 0,
      limit: 50,
    });

    await u.click(screen.getByRole('button', { name: 'Duplicate value (12)' }));
    await waitFor(() =>
      expect(api.listRunErrors).toHaveBeenLastCalledWith(RUN_ID, {
        offset: 0,
        limit: 50,
        code: 'NOT_UNIQUE',
      }),
    );
    expect(await screen.findByText('message for row 9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate value (12)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByText('Showing 1–1 of 12')).toBeInTheDocument();
  });

  it('pages forwards and back through the stored errors', async () => {
    const api = fakeApi();
    api.getRun.mockResolvedValue(
      runDetail({ totalErrors: 120, errorCountsByCode: { REQUIRED: 120 } }),
    );
    api.listRunErrors.mockImplementation(async (_id, options) => ({
      items: Array.from({ length: Math.min(50, 120 - (options?.offset ?? 0)) }, (_, i) =>
        errorRow((options?.offset ?? 0) + i + 1),
      ),
      total: 120,
      offset: options?.offset ?? 0,
      limit: 50,
    }));
    const u = userEvent.setup();
    open(api);

    expect(await screen.findByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 51–100 of 120')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 101–120 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Showing 51–100 of 120')).toBeInTheDocument();
    expect(api.listRunErrors).toHaveBeenCalledWith(RUN_ID, { offset: 50, limit: 50 });
  });

  it('says so when a filter has no stored errors', async () => {
    const api = withErrors();
    const u = userEvent.setup();
    open(api);
    await screen.findByRole('table');
    api.listRunErrors.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });
    await u.click(screen.getByRole('button', { name: 'Required value missing (10)' }));
    expect(await screen.findByText('No stored errors of this type.')).toBeInTheDocument();
  });

  it('shows an error when the errors cannot be loaded', async () => {
    const api = fakeApi();
    api.getRun.mockResolvedValue(runDetail());
    api.listRunErrors.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'x'));
    open(api);
    expect(await screen.findByText('The errors could not be loaded.')).toBeInTheDocument();
  });
});

describe('RunDetail: truncation notice (FR-29, AC-29)', () => {
  it('shows the exact total and how many are listed when a run is truncated', async () => {
    const api = withErrors({
      totalErrors: 1500,
      truncated: true,
      errorCountsByCode: { INVALID_TYPE: 1500 },
    });
    api.getRun.mockResolvedValue(
      runDetail({
        totalErrors: 1500,
        truncated: true,
        errorCountsByCode: { INVALID_TYPE: 1500 },
        errors: { items: [], total: 1000, offset: 0, limit: 100 },
      }),
    );
    open(api);
    const notice = await screen.findByText(/found 1,500 errors in total/);
    expect(notice).toHaveTextContent(
      'Only the first 1,000 are listed below; the counts above are exact.',
    );
    expect(screen.getByRole('button', { name: 'All (1,500)' })).toBeInTheDocument();
  });

  it('shows no notice when nothing was cut off', async () => {
    open(withErrors());
    await screen.findByRole('table');
    expect(screen.queryByText(/errors in total/)).not.toBeInTheDocument();
  });
});

describe('RunDetail: deleting and missing runs', () => {
  it('confirms, deletes and returns to the history', async () => {
    const api = withErrors();
    const u = userEvent.setup();
    open(api);
    await u.click(await screen.findByRole('button', { name: 'Delete run' }));
    expect(api.deleteRun).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(api.deleteRun).toHaveBeenCalledWith(RUN_ID));
    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
  });

  it('keeps the run when the user cancels', async () => {
    const api = withErrors();
    const u = userEvent.setup();
    open(api);
    await u.click(await screen.findByRole('button', { name: 'Delete run' }));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete run' })).toBeInTheDocument();
    expect(api.deleteRun).not.toHaveBeenCalled();
  });

  it('shows an error when deletion fails', async () => {
    const api = withErrors();
    api.deleteRun.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'x'));
    const u = userEvent.setup();
    open(api);
    await u.click(await screen.findByRole('button', { name: 'Delete run' }));
    await u.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('The run could not be deleted.')).toBeInTheDocument();
  });

  it('says so when the run no longer exists', async () => {
    const api = fakeApi();
    api.getRun.mockRejectedValue(
      new ApiRequestError(404, 'RUN_NOT_FOUND', 'Validation run not found'),
    );
    open(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('This run no longer exists.');
    expect(screen.getByRole('link', { name: 'Back to history' })).toHaveAttribute(
      'href',
      '/history',
    );
  });

  it('shows loading and general failure states', async () => {
    const pending = fakeApi();
    pending.getRun.mockReturnValue(new Promise(() => {}));
    open(pending);
    expect(screen.getByRole('status')).toHaveTextContent('Loading run');
  });
});
