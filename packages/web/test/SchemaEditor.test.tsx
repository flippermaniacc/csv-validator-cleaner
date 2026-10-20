import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../src/api/client';
import { fakeApi, renderApp, schemaResource } from './helpers';

const user = () => userEvent.setup();
const column = (n: number) => screen.getByRole('group', { name: `Column ${n}` });

async function fillBasicSchema(u: ReturnType<typeof user>) {
  await u.type(screen.getByLabelText('Schema name'), 'Invoices');
  await u.type(within(column(1)).getByLabelText('Name'), 'id');
}

describe('SchemaEditor: creating (FR-28)', () => {
  it('builds the request body from the form and returns to the list', async () => {
    const api = fakeApi();
    api.createSchema.mockResolvedValue(schemaResource());
    const u = user();
    renderApp(api, '/schemas/new');

    await fillBasicSchema(u);
    const first = within(column(1));
    await u.selectOptions(first.getByLabelText('Type'), 'integer');
    await u.click(first.getByLabelText('Required'));
    await u.type(first.getByLabelText('Minimum value'), '1');
    await u.click(screen.getByRole('button', { name: 'Add column' }));
    const second = within(column(2));
    await u.type(second.getByLabelText('Name'), 'currency');
    await u.type(second.getByLabelText('Allowed values'), 'USD{Enter}EUR');
    await u.click(screen.getByRole('button', { name: 'Save schema' }));

    await waitFor(() => expect(api.createSchema).toHaveBeenCalledTimes(1));
    expect(api.createSchema).toHaveBeenCalledWith({
      name: 'Invoices',
      columns: [
        { name: 'id', type: 'integer', required: true, unique: false, min: 1 },
        { name: 'currency', type: 'string', required: false, unique: false, enum: ['USD', 'EUR'] },
      ],
    });
    expect(await screen.findByRole('heading', { name: 'Schemas' })).toBeInTheDocument();
  });

  it('starts with one empty text column', () => {
    renderApp(fakeApi(), '/schemas/new');
    expect(screen.getByRole('heading', { name: 'New schema' })).toBeInTheDocument();
    expect(within(column(1)).getByLabelText('Type')).toHaveValue('string');
    expect(screen.queryByRole('group', { name: 'Column 2' })).not.toBeInTheDocument();
  });

  it('disables saving and shows progress while the request is pending', async () => {
    const api = fakeApi();
    let finish!: () => void;
    api.createSchema.mockReturnValue(
      new Promise((resolve) => (finish = () => resolve(schemaResource()))),
    );
    const u = user();
    renderApp(api, '/schemas/new');
    await fillBasicSchema(u);
    await u.click(screen.getByRole('button', { name: 'Save schema' }));

    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    finish();
    expect(await screen.findByRole('heading', { name: 'Schemas' })).toBeInTheDocument();
  });

  it('lets the user cancel back to the list without saving', async () => {
    const api = fakeApi();
    const u = user();
    renderApp(api, '/schemas/new');
    await u.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Schemas' })).toBeInTheDocument();
    expect(api.createSchema).not.toHaveBeenCalled();
  });
});

describe('SchemaEditor: columns', () => {
  async function twoColumns(u: ReturnType<typeof user>) {
    renderApp(fakeApi(), '/schemas/new');
    await u.type(within(column(1)).getByLabelText('Name'), 'alpha');
    await u.click(screen.getByRole('button', { name: 'Add column' }));
    await u.type(within(column(2)).getByLabelText('Name'), 'beta');
  }
  const names = () =>
    [1, 2].map((n) => (within(column(n)).getByLabelText('Name') as HTMLInputElement).value);

  it('moves columns up and down, keeping their values', async () => {
    const u = user();
    await twoColumns(u);
    await u.click(within(column(2)).getByRole('button', { name: 'Move up' }));
    expect(names()).toEqual(['beta', 'alpha']);
    await u.click(within(column(1)).getByRole('button', { name: 'Move down' }));
    expect(names()).toEqual(['alpha', 'beta']);
  });

  it('disables moves at the ends', async () => {
    const u = user();
    await twoColumns(u);
    expect(within(column(1)).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(column(2)).getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('removes a column and renumbers the rest', async () => {
    const u = user();
    await twoColumns(u);
    await u.click(within(column(1)).getByRole('button', { name: 'Remove column' }));
    expect(screen.queryByRole('group', { name: 'Column 2' })).not.toBeInTheDocument();
    expect(within(column(1)).getByLabelText('Name')).toHaveValue('beta');
  });
});

describe('SchemaEditor: fields follow the column type', () => {
  const open = async (type: string) => {
    const u = user();
    renderApp(fakeApi(), '/schemas/new');
    await u.selectOptions(within(column(1)).getByLabelText('Type'), type);
    return within(column(1));
  };

  it('shows pattern, length bounds and allowed values for text, with the RE2 hint', async () => {
    const col = await open('string');
    expect(col.getByLabelText('Pattern')).toBeInTheDocument();
    expect(col.getByLabelText('Minimum length')).toBeInTheDocument();
    expect(col.getByLabelText('Allowed values')).toBeInTheDocument();
    expect(col.getByText(/RE2 syntax/)).toHaveTextContent(
      /lookahead, lookbehind and backreferences are not supported/i,
    );
    expect(col.getByLabelText('Pattern')).toHaveAccessibleDescription(/RE2 syntax/);
  });

  it('shows pattern and length bounds, but no allowed values, for email', async () => {
    const col = await open('email');
    expect(col.getByLabelText('Pattern')).toBeInTheDocument();
    expect(col.getByLabelText('Maximum length')).toBeInTheDocument();
    expect(col.queryByLabelText('Allowed values')).not.toBeInTheDocument();
  });

  it('shows numeric bounds and allowed values for integer and decimal', async () => {
    for (const type of ['integer', 'decimal']) {
      const col = await open(type);
      expect(col.getByLabelText('Minimum value')).toHaveAttribute('type', 'number');
      expect(col.getByLabelText('Allowed values')).toBeInTheDocument();
      expect(col.queryByLabelText('Pattern')).not.toBeInTheDocument();
      expect(col.queryByLabelText('Date format')).not.toBeInTheDocument();
      document.body.innerHTML = '';
    }
  });

  it('shows the date format and date bounds for dates, noting that ISO is always accepted', async () => {
    const col = await open('date');
    expect(col.getByLabelText('Date format')).toHaveValue('');
    expect(col.getByLabelText('Earliest date')).toBeInTheDocument();
    expect(col.getByText(/always accepted/)).toBeInTheDocument();
    expect(col.queryByLabelText('Allowed values')).not.toBeInTheDocument();
  });

  it('offers only the three non-default date formats next to the default', async () => {
    const col = await open('date');
    const options = within(col.getByLabelText('Date format'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['YYYY-MM-DD (default)', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']);
  });

  it('shows no rule fields for boolean', async () => {
    const col = await open('boolean');
    for (const label of [
      'Pattern',
      'Allowed values',
      'Date format',
      'Minimum value',
      'Minimum length',
    ]) {
      expect(col.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(col.getByLabelText('Required')).toBeInTheDocument();
    expect(col.getByLabelText('Unique')).toBeInTheDocument();
  });

  it('does not send rules typed for a type the column no longer has', async () => {
    const api = fakeApi();
    api.createSchema.mockResolvedValue(schemaResource());
    const u = user();
    renderApp(api, '/schemas/new');
    await fillBasicSchema(u);
    await u.type(within(column(1)).getByLabelText('Pattern'), '[[A-Z]+');
    await u.selectOptions(within(column(1)).getByLabelText('Type'), 'integer');
    await u.click(screen.getByRole('button', { name: 'Save schema' }));

    await waitFor(() => expect(api.createSchema).toHaveBeenCalled());
    expect(api.createSchema.mock.calls[0]?.[0].columns[0]).toEqual({
      name: 'id',
      type: 'integer',
      required: false,
      unique: false,
    });
  });
});

describe('SchemaEditor: server problems appear next to their fields (AC-2, FR-4)', () => {
  const unprocessable = (issues: unknown[]) =>
    new ApiRequestError(422, 'INVALID_SCHEMA', 'The schema definition is invalid', { issues });

  it('shows each issue under the named column and property, and keeps the user input', async () => {
    const api = fakeApi();
    api.createSchema.mockRejectedValue(
      unprocessable([
        {
          path: ['name'],
          column: null,
          property: 'name',
          message: 'Schema name must not be empty',
        },
        {
          path: ['columns', 1, 'min'],
          column: 'qty',
          property: 'min',
          message: 'min (10) must be less than or equal to max (5)',
        },
        {
          path: ['columns', 1, 'pattern'],
          column: 'qty',
          property: 'pattern',
          message: 'pattern is only allowed on string and email columns, not integer',
        },
        {
          path: ['columns', 0, 'enum'],
          column: 'a',
          property: 'enum',
          message: 'enum contains the duplicate entry "A"',
        },
      ]),
    );
    const u = user();
    renderApp(api, '/schemas/new');
    await u.type(within(column(1)).getByLabelText('Name'), 'a');
    await u.type(within(column(1)).getByLabelText('Allowed values'), 'A{Enter}A');
    await u.click(screen.getByRole('button', { name: 'Add column' }));
    await u.type(within(column(2)).getByLabelText('Name'), 'qty');
    await u.selectOptions(within(column(2)).getByLabelText('Type'), 'integer');
    await u.type(within(column(2)).getByLabelText('Minimum value'), '10');
    await u.click(screen.getByRole('button', { name: 'Save schema' }));

    expect(
      await within(column(1)).findByText('enum contains the duplicate entry "A"'),
    ).toBeInTheDocument();
    expect(
      within(column(2)).getByText('min (10) must be less than or equal to max (5)'),
    ).toBeInTheDocument();
    expect(within(column(2)).queryByText(/enum contains/)).not.toBeInTheDocument();
    expect(screen.getByText('Schema name must not be empty')).toBeInTheDocument();
    expect(within(column(2)).getByLabelText('Minimum value')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(column(2)).getByLabelText('Minimum value')).toHaveAccessibleDescription(
      /must be less than or equal/,
    );
    expect(within(column(2)).getByLabelText('Name')).toHaveValue('qty');
    expect(screen.getByRole('heading', { name: 'New schema' })).toBeInTheDocument();
  });

  it('shows a pattern error naming the unsupported construct', async () => {
    const api = fakeApi();
    api.createSchema.mockRejectedValue(
      unprocessable([
        {
          path: ['columns', 0, 'pattern'],
          column: 'c',
          property: 'pattern',
          message: 'Invalid pattern (lookahead is not supported): lookahead is not supported',
        },
      ]),
    );
    const u = user();
    renderApp(api, '/schemas/new');
    await fillBasicSchema(u);
    await u.type(within(column(1)).getByLabelText('Pattern'), '(?=x)');
    await u.click(screen.getByRole('button', { name: 'Save schema' }));
    expect(
      await within(column(1)).findByText(/lookahead is not supported/, {
        selector: '.field-error',
      }),
    ).toBeInTheDocument();
  });

  it('shows column-level and no-column problems', async () => {
    const api = fakeApi();
    api.createSchema.mockRejectedValue(
      unprocessable([
        {
          path: ['columns'],
          column: null,
          property: 'columns',
          message: 'A schema needs at least one column',
        },
        {
          path: ['columns', 0],
          column: null,
          property: null,
          message: 'Unrecognized key: "requried"',
        },
      ]),
    );
    const u = user();
    renderApp(api, '/schemas/new');
    await u.click(screen.getByRole('button', { name: 'Save schema' }));
    expect(await screen.findByText('A schema needs at least one column')).toBeInTheDocument();
    expect(within(column(1)).getByText('Unrecognized key: "requried"')).toBeInTheDocument();
  });

  it('shows a name conflict under the name field', async () => {
    const api = fakeApi();
    api.createSchema.mockRejectedValue(
      new ApiRequestError(409, 'SCHEMA_NAME_TAKEN', 'A schema named "Invoices" already exists'),
    );
    const u = user();
    renderApp(api, '/schemas/new');
    await fillBasicSchema(u);
    await u.click(screen.getByRole('button', { name: 'Save schema' }));
    const message = await screen.findByText('A schema named "Invoices" already exists');
    expect(message).toHaveClass('field-error');
    expect(screen.getByLabelText('Schema name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows other failures as a general alert, such as an unreachable server', async () => {
    const api = fakeApi();
    api.createSchema.mockRejectedValue(
      new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server'),
    );
    const u = user();
    renderApp(api, '/schemas/new');
    await fillBasicSchema(u);
    await u.click(screen.getByRole('button', { name: 'Save schema' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('clears the old problems when saving again', async () => {
    const api = fakeApi();
    api.createSchema
      .mockRejectedValueOnce(
        new ApiRequestError(409, 'SCHEMA_NAME_TAKEN', 'A schema named "Invoices" already exists'),
      )
      .mockResolvedValueOnce(schemaResource());
    const u = user();
    renderApp(api, '/schemas/new');
    await fillBasicSchema(u);
    await u.click(screen.getByRole('button', { name: 'Save schema' }));
    await screen.findByText(/already exists/);
    await u.click(screen.getByRole('button', { name: 'Save schema' }));
    expect(await screen.findByRole('heading', { name: 'Schemas' })).toBeInTheDocument();
  });
});

describe('SchemaEditor: editing', () => {
  const ID = '11111111-1111-4111-8111-111111111111';

  it('loads the schema into the form and saves changes with PUT', async () => {
    const api = fakeApi();
    api.getSchema.mockResolvedValue(schemaResource());
    api.updateSchema.mockResolvedValue(schemaResource({ name: 'Invoices v2' }));
    const u = user();
    renderApp(api, `/schemas/${ID}`);

    expect(await screen.findByRole('heading', { name: 'Edit schema' })).toBeInTheDocument();
    expect(screen.getByLabelText('Schema name')).toHaveValue('Invoices');
    expect(within(column(1)).getByLabelText('Name')).toHaveValue('id');
    expect(within(column(1)).getByLabelText('Type')).toHaveValue('integer');
    expect(within(column(1)).getByLabelText('Required')).toBeChecked();
    expect(within(column(1)).getByLabelText('Unique')).toBeChecked();
    expect(within(column(1)).getByLabelText('Minimum value')).toHaveValue(1);
    expect(within(column(2)).getByLabelText('Date format')).toHaveValue('DD.MM.YYYY');
    expect(within(column(3)).getByLabelText('Allowed values')).toHaveValue('USD\nEUR');

    await u.type(screen.getByLabelText('Schema name'), ' v2');
    await u.click(screen.getByRole('button', { name: 'Save schema' }));

    await waitFor(() => expect(api.updateSchema).toHaveBeenCalledTimes(1));
    const [id, draft] = api.updateSchema.mock.calls[0]!;
    expect(id).toBe(ID);
    expect(draft).toEqual({ name: 'Invoices v2', columns: schemaResource().columns });
    expect(api.createSchema).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Schemas' })).toBeInTheDocument();
  });

  it('says so when the schema no longer exists', async () => {
    const api = fakeApi();
    api.getSchema.mockRejectedValue(
      new ApiRequestError(404, 'SCHEMA_NOT_FOUND', 'Schema not found'),
    );
    renderApp(api, `/schemas/${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This schema no longer exists.');
    expect(screen.getByRole('link', { name: 'Back to schemas' })).toHaveAttribute(
      'href',
      '/schemas',
    );
  });

  it('says so when loading fails for another reason', async () => {
    const api = fakeApi();
    api.getSchema.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'x'));
    renderApp(api, `/schemas/${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });

  it('shows a loading state first', () => {
    const api = fakeApi();
    api.getSchema.mockReturnValue(new Promise(() => {}));
    renderApp(api, `/schemas/${ID}`);
    expect(screen.getByRole('status')).toHaveTextContent('Loading schema');
  });
});
