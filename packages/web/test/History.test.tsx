import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../src/api/client';
import { fakeApi, renderApp, runSummary } from './helpers';

const ok = runSummary({
  id: 'a-1',
  originalFilename: 'march.csv',
  invalidRows: 0,
  validRows: 1200,
  totalErrors: 0,
});
const bad = runSummary({ id: 'b-2', originalFilename: 'april.csv' });
const failed = runSummary({
  id: 'c-3',
  originalFilename: 'broken.csv',
  status: 'failed',
  fileError: { code: 'PARSE_ERROR', message: 'Unterminated quoted field (line 2)' },
  totalRows: 0,
  validRows: 0,
  invalidRows: 0,
  totalErrors: 0,
  schema: { id: null, name: 'Old schema' },
});

describe('History page (AC-34, FR-24)', () => {
  it('lists runs with file, schema, result, rows, errors and time', async () => {
    const api = fakeApi();
    api.listRuns.mockResolvedValue({ items: [ok, bad, failed], nextCursor: null });
    renderApp(api, '/history');

    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(4);
    const [, r1, r2, r3] = rows as HTMLElement[];

    expect(within(r1!).getByRole('link', { name: 'march.csv' })).toHaveAttribute(
      'href',
      '/runs/a-1',
    );
    expect(within(r1!).getByText('Invoices')).toBeInTheDocument();
    expect(within(r1!).getByText('All rows valid')).toBeInTheDocument();
    expect(within(r1!).getByText('1,200 / 1,200')).toBeInTheDocument();

    expect(within(r2!).getByText('Errors found')).toBeInTheDocument();
    expect(within(r2!).getByText('1,150 / 1,200')).toBeInTheDocument();
    expect(within(r2!).getByText('62')).toBeInTheDocument();

    expect(within(r3!).getByText('Failed')).toBeInTheDocument();
    expect(within(r3!).getByText('PARSE_ERROR')).toBeInTheDocument();
    expect(within(r3!).getByText('Old schema')).toBeInTheDocument();
  });

  it('shows an empty state pointing to Validate', async () => {
    renderApp(fakeApi(), '/history');
    expect(await screen.findByText(/No validations yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Validate a CSV' })).toHaveAttribute(
      'href',
      '/validate',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('loads further pages with the cursor and appends them', async () => {
    const api = fakeApi();
    api.listRuns
      .mockResolvedValueOnce({ items: [ok], nextCursor: 'CURSOR-1' })
      .mockResolvedValueOnce({ items: [bad], nextCursor: null });
    const u = userEvent.setup();
    renderApp(api, '/history');

    await screen.findByText('march.csv');
    expect(api.listRuns).toHaveBeenLastCalledWith({});
    await u.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('april.csv')).toBeInTheDocument();
    expect(api.listRuns).toHaveBeenLastCalledWith({ cursor: 'CURSOR-1' });
    expect(screen.getByText('march.csv')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows no Load more button on the last page', async () => {
    const api = fakeApi();
    api.listRuns.mockResolvedValue({ items: [ok], nextCursor: null });
    renderApp(api, '/history');
    await screen.findByText('march.csv');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows loading and error states', async () => {
    const pending = fakeApi();
    pending.listRuns.mockReturnValue(new Promise(() => {}));
    renderApp(pending, '/history');
    expect(screen.getByRole('status')).toHaveTextContent('Loading history');
  });

  it('shows an error when the history cannot be loaded', async () => {
    const api = fakeApi();
    api.listRuns.mockRejectedValue(new ApiRequestError(0, 'NETWORK_ERROR', 'x'));
    renderApp(api, '/history');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});

describe('History: deleting a run (FR-27)', () => {
  it('confirms, deletes and refreshes the list', async () => {
    const api = fakeApi();
    api.listRuns
      .mockResolvedValueOnce({ items: [ok, bad], nextCursor: null })
      .mockResolvedValue({ items: [bad], nextCursor: null });
    const u = userEvent.setup();
    renderApp(api, '/history');

    await u.click(await screen.findByRole('button', { name: 'Delete run of march.csv' }));
    expect(screen.getByText('Delete this run?')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() => expect(api.deleteRun).toHaveBeenCalledWith('a-1'));
    await waitFor(() => expect(screen.queryByText('march.csv')).not.toBeInTheDocument());
    expect(screen.getByText('april.csv')).toBeInTheDocument();
  });

  it('keeps the run when the user cancels', async () => {
    const api = fakeApi();
    api.listRuns.mockResolvedValue({ items: [ok], nextCursor: null });
    const u = userEvent.setup();
    renderApp(api, '/history');
    await u.click(await screen.findByRole('button', { name: 'Delete run of march.csv' }));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleteRun).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete run of march.csv' })).toBeInTheDocument();
  });

  it('shows an error when deletion fails', async () => {
    const api = fakeApi();
    api.listRuns.mockResolvedValue({ items: [ok], nextCursor: null });
    api.deleteRun.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'x'));
    const u = userEvent.setup();
    renderApp(api, '/history');
    await u.click(await screen.findByRole('button', { name: 'Delete run of march.csv' }));
    await u.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('The run could not be deleted.')).toBeInTheDocument();
    expect(screen.getByText('march.csv')).toBeInTheDocument();
  });
});
