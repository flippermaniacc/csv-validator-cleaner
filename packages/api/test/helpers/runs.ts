import { makeApp, multipartBody, type Part, type TestApp } from './app.js';

export const SCHEMA = {
  name: 'Invoices',
  columns: [
    { name: 'id', type: 'integer', required: true, unique: true },
    { name: 'issued', type: 'date', dateFormat: 'DD.MM.YYYY' },
    { name: 'name', type: 'string' },
  ],
};

export const GOOD_CSV = 'id,issued,name,memo\n 1 ,01.03.2024, Ann , keep \n2,2024-03-02,Bob,\n';

/** An app with a fixed clock and sequential run ids (`...000000000001`, `...2`), unless overridden. */
export async function startApp(options: Parameters<typeof makeApp>[0] = {}): Promise<TestApp> {
  let counter = 0;
  return makeApp({
    ...options,
    deps: {
      now: () => new Date('2026-02-03T04:05:06.000Z'),
      newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
      ...options.deps,
    },
  });
}

export async function createSchema(t: TestApp, schema: unknown = SCHEMA): Promise<string> {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/schemas',
    payload: schema as object,
  });
  return response.json().id as string;
}

export async function upload(t: TestApp, parts: Part[]) {
  const { payload, headers } = multipartBody(parts);
  return t.app.inject({ method: 'POST', url: '/api/validations', payload, headers });
}

export const filePart = (data: Buffer | string, filename = 'in.csv'): Part => ({
  name: 'file',
  filename,
  data,
});

export const schemaPart = (id: string): Part => ({ name: 'schemaId', value: id });

/** Creates a schema and uploads one CSV, returning the run summary. */
export async function runOf(
  t: TestApp,
  csv: Buffer | string = GOOD_CSV,
  options: { schema?: unknown; filename?: string } = {},
) {
  const schemaId = await createSchema(t, options.schema);
  const response = await upload(t, [schemaPart(schemaId), filePart(csv, options.filename)]);
  return { schemaId, run: response.json() };
}
