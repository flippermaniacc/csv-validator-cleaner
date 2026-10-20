import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../src/api/client';
import { fakeApi, renderApp, schemaResource } from './helpers';

const invoices = schemaResource();
const payments = schemaResource({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Payments',
  columns: [{ name: 'amount', type: 'decimal', required: false, unique: false }],
});

describe('Schemas page (FR-28)', () => {
  it('lists schemas with their column counts and edit links', async () => {
    const api = fakeApi();
    api.listSchemas.mockResolvedValue([invoices, payments]);
    renderApp(api);

    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByRole('rowheader')).toHaveTextContent('Invoices');
    expect(within(rows[1]!).getByText('3')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Invoices' })).toHaveAttribute(
      'href',
      `/schemas/${invoices.id}`,
    );
    expect(screen.getByRole('link', { name: 'New schema' })).toHaveAttribute(
      'href',
      '/schemas/new',
    );
  });

  it('shows an empty state with a pointer to create the first schema', async () => {
    renderApp(fakeApi());
    expect(await screen.findByText(/No schemas yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New schema' })).toBeInTheDocument();
  });

  it('shows a loading state first', () => {
    const api = fakeApi();
    api.listSchemas.mockReturnValue(new Promise(() => {}));
    renderApp(api);
    expect(screen.getByRole('status')).toHaveTextContent('Loading schemas');
  });

  it('shows an error when the list cannot be loaded', async () => {
    const api = fakeApi();
    api.listSchemas.mockRejectedValue(
      new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server'),
    );
    renderApp(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});

describe('deleting a schema', () => {
  it('asks for confirmation, deletes, and refreshes the list', async () => {
    const api = fakeApi();
    api.listSchemas.mockResolvedValueOnce([invoices, payments]).mockResolvedValue([payments]);
    const u = userEvent.setup();
    renderApp(api);

    await u.click(await screen.findByRole('button', { name: 'Delete Invoices' }));
    expect(screen.getByText('Delete “Invoices”?')).toBeInTheDocument();
    expect(api.deleteSchema).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() => expect(api.deleteSchema).toHaveBeenCalledWith(invoices.id));
    await waitFor(() => expect(screen.queryByText('Invoices')).not.toBeInTheDocument());
    expect(screen.getByText('Payments')).toBeInTheDocument();
  });

  it('keeps the schema when the user cancels', async () => {
    const api = fakeApi();
    api.listSchemas.mockResolvedValue([invoices]);
    const u = userEvent.setup();
    renderApp(api);
    await u.click(await screen.findByRole('button', { name: 'Delete Invoices' }));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleteSchema).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete Invoices' })).toBeInTheDocument();
  });

  it('shows an error and keeps the row when deletion fails', async () => {
    const api = fakeApi();
    api.listSchemas.mockResolvedValue([invoices]);
    api.deleteSchema.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'x'));
    const u = userEvent.setup();
    renderApp(api);
    await u.click(await screen.findByRole('button', { name: 'Delete Invoices' }));
    await u.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be deleted');
    expect(screen.getByRole('rowheader', { name: 'Invoices' })).toBeInTheDocument();
  });

  it('only asks about one schema at a time', async () => {
    const api = fakeApi();
    api.listSchemas.mockResolvedValue([invoices, payments]);
    const u = userEvent.setup();
    renderApp(api);
    await u.click(await screen.findByRole('button', { name: 'Delete Invoices' }));
    await u.click(screen.getByRole('button', { name: 'Delete Payments' }));
    expect(screen.getAllByRole('button', { name: 'Yes, delete' })).toHaveLength(1);
    expect(screen.getByText('Delete “Payments”?')).toBeInTheDocument();
  });
});
