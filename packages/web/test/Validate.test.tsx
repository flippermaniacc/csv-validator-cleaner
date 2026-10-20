import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../src/api/client';
import { fakeApi, renderApp, RUN_ID, runDetail, runSummary, schemaResource } from './helpers';

const invoices = schemaResource();
const payments = schemaResource({ id: '22222222-2222-4222-8222-222222222222', name: 'Payments' });
const csv = (name = 'invoices.csv', content = 'id\n1\n') =>
  new File([content], name, { type: 'text/csv' });

function setup(overrides = {}) {
  const api = fakeApi(overrides);
  api.listSchemas.mockResolvedValue([invoices, payments]);
  api.getRun.mockResolvedValue(runDetail());
  return api;
}

describe('Validate page (FR-28, AC-38)', () => {
  it('offers the schemas, preselecting the first', async () => {
    renderApp(setup(), '/validate');
    const select = await screen.findByLabelText('Schema');
    expect(select).toHaveValue(invoices.id);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Invoices',
      'Payments',
    ]);
  });

  it('keeps Validate disabled until a file is chosen', async () => {
    const u = userEvent.setup();
    renderApp(setup(), '/validate');
    const button = await screen.findByRole('button', { name: 'Validate' });
    expect(button).toBeDisabled();
    await u.upload(screen.getByLabelText('CSV file'), csv());
    expect(button).toBeEnabled();
    expect(screen.getByText('invoices.csv')).toBeInTheDocument();
  });

  it('uploads the chosen file with the chosen schema and opens the run', async () => {
    const api = setup();
    api.validate.mockResolvedValue(runSummary());
    const u = userEvent.setup();
    renderApp(api, '/validate');

    await u.selectOptions(await screen.findByLabelText('Schema'), payments.id);
    const file = csv('march.csv');
    await u.upload(screen.getByLabelText('CSV file'), file);
    await u.click(screen.getByRole('button', { name: 'Validate' }));

    await waitFor(() => expect(api.validate).toHaveBeenCalledTimes(1));
    expect(api.validate).toHaveBeenCalledWith(payments.id, file);
    expect(await screen.findByRole('heading', { name: 'invoices.csv' })).toBeInTheDocument();
    expect(api.getRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('accepts a dropped file', async () => {
    const api = setup();
    api.validate.mockResolvedValue(runSummary());
    const u = userEvent.setup();
    renderApp(api, '/validate');
    await screen.findByLabelText('Schema');

    const dropped = csv('dropped.csv');
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [dropped] } });
    expect(screen.getByText('dropped.csv')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(api.validate).toHaveBeenCalledWith(invoices.id, dropped));
  });

  it('warns about files over 10 MiB and blocks the upload (server stays authoritative)', async () => {
    const api = setup();
    const u = userEvent.setup();
    renderApp(api, '/validate');
    const big = csv('big.csv');
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    await u.upload(await screen.findByLabelText('CSV file'), big);

    expect(screen.getByRole('alert')).toHaveTextContent('larger than 10 MiB');
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled();
  });

  it('allows a file of exactly 10 MiB', async () => {
    const u = userEvent.setup();
    renderApp(setup(), '/validate');
    const exact = csv('exact.csv');
    Object.defineProperty(exact, 'size', { value: 10 * 1024 * 1024 });
    await u.upload(await screen.findByLabelText('CSV file'), exact);
    expect(screen.queryByText(/larger than 10 MiB/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled();
  });

  it('shows progress while validating', async () => {
    const api = setup();
    let finish!: () => void;
    api.validate.mockReturnValue(new Promise((resolve) => (finish = () => resolve(runSummary()))));
    const u = userEvent.setup();
    renderApp(api, '/validate');
    await u.upload(await screen.findByLabelText('CSV file'), csv());
    await u.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByRole('button', { name: 'Validating…' })).toBeDisabled();
    finish();
    expect(await screen.findByRole('heading', { name: 'invoices.csv' })).toBeInTheDocument();
  });

  it.each([
    [
      new ApiRequestError(413, 'FILE_TOO_LARGE', 'The file exceeds the 10 MiB limit'),
      'exceeds the 10 MiB limit',
    ],
    [new ApiRequestError(404, 'SCHEMA_NOT_FOUND', 'Schema not found'), 'Schema not found'],
    [
      new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server'),
      'Could not reach the server',
    ],
  ])('shows the server problem and lets the user retry (%#)', async (error, text) => {
    const api = setup();
    api.validate.mockRejectedValueOnce(error).mockResolvedValueOnce(runSummary());
    const u = userEvent.setup();
    renderApp(api, '/validate');
    await u.upload(await screen.findByLabelText('CSV file'), csv());
    await u.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled();

    await u.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByRole('heading', { name: 'invoices.csv' })).toBeInTheDocument();
  });

  it('clears an old error when another file is chosen', async () => {
    const api = setup();
    api.validate.mockRejectedValue(new ApiRequestError(413, 'FILE_TOO_LARGE', 'too big'));
    const u = userEvent.setup();
    renderApp(api, '/validate');
    await u.upload(await screen.findByLabelText('CSV file'), csv());
    await u.click(screen.getByRole('button', { name: 'Validate' }));
    await screen.findByRole('alert');
    await u.upload(screen.getByLabelText('CSV file'), csv('other.csv'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('points to schema creation when there are no schemas', async () => {
    const api = fakeApi();
    renderApp(api, '/validate');
    expect(await screen.findByText(/You need a schema first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a schema' })).toHaveAttribute(
      'href',
      '/schemas/new',
    );
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument();
  });

  it('shows an error when schemas cannot be loaded', async () => {
    const api = fakeApi();
    api.listSchemas.mockRejectedValue(new ApiRequestError(0, 'NETWORK_ERROR', 'x'));
    renderApp(api, '/validate');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
