import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiRequestError, type SchemaResource } from '../api/client';
import { useApi } from '../api/context';
import { ColumnRuleForm } from '../components/ColumnRuleForm';
import {
  emptyColumn,
  emptyForm,
  fromResource,
  groupIssues,
  toDraft,
  type ColumnForm,
  type SchemaForm,
} from '../schemaForm';

/** Create (`/schemas/new`) or edit (`/schemas/:id`) a schema. */
export function SchemaEditor() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const existing = useQuery({
    queryKey: ['schema', id],
    queryFn: () => api.getSchema(id as string),
    enabled: id !== undefined,
  });

  if (id === undefined) return <EditorForm initial={emptyForm()} />;
  if (existing.isPending) return <p role="status">Loading schema…</p>;
  if (existing.isError) {
    const missing = existing.error instanceof ApiRequestError && existing.error.status === 404;
    return (
      <div role="alert" className="notice error">
        <p>{missing ? 'This schema no longer exists.' : 'The schema could not be loaded.'}</p>
        <Link to="/schemas">Back to schemas</Link>
      </div>
    );
  }
  return <EditorForm key={existing.data.id} schemaId={id} initial={fromResource(existing.data)} />;
}

function EditorForm({ schemaId, initial }: { schemaId?: string; initial: SchemaForm }) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [nextKey, setNextKey] = useState(
    () => Math.max(0, ...initial.columns.map((c) => c.key)) + 1,
  );
  const [error, setError] = useState<ApiRequestError | null>(null);

  const save = useMutation({
    mutationFn: (): Promise<SchemaResource> =>
      schemaId === undefined
        ? api.createSchema(toDraft(form))
        : api.updateSchema(schemaId, toDraft(form)),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['schemas'] });
      await queryClient.invalidateQueries({ queryKey: ['schema', schemaId] });
      navigate('/schemas');
    },
    onError: (e) =>
      setError(
        e instanceof ApiRequestError
          ? e
          : new ApiRequestError(0, 'UNKNOWN', 'Something went wrong'),
      ),
  });

  const issues = groupIssues(error?.status === 422 ? error.issues : []);
  const nameTaken = error?.code === 'SCHEMA_NAME_TAKEN' ? [error.message] : [];
  const nameMessages = [...(issues.schema['name'] ?? []), ...nameTaken];
  const columnMessages = issues.schema['columns'] ?? [];
  const generic =
    error && error.status !== 422 && error.code !== 'SCHEMA_NAME_TAKEN' ? error.message : null;

  const patchColumn = (key: number, patch: Partial<ColumnForm>) =>
    setForm((f) => ({
      ...f,
      columns: f.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));

  const move = (index: number, direction: -1 | 1) =>
    setForm((f) => {
      const columns = [...f.columns];
      const target = index + direction;
      if (target < 0 || target >= columns.length) return f;
      [columns[index], columns[target]] = [
        columns[target] as ColumnForm,
        columns[index] as ColumnForm,
      ];
      return { ...f, columns };
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate aria-labelledby="editor-title">
      <h1 id="editor-title">{schemaId === undefined ? 'New schema' : 'Edit schema'}</h1>

      {generic && (
        <p role="alert" className="notice error">
          {generic}
        </p>
      )}
      {issues.other.map((message) => (
        <p key={message} role="alert" className="notice error">
          {message}
        </p>
      ))}

      <div className="field">
        <label htmlFor="schema-name">Schema name</label>
        <input
          id="schema-name"
          value={form.name}
          aria-invalid={nameMessages.length > 0}
          aria-describedby={nameMessages.length > 0 ? 'schema-name-error' : undefined}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        {nameMessages.map((message) => (
          <p key={message} className="field-error" role="alert" id="schema-name-error">
            {message}
          </p>
        ))}
      </div>

      <h2>Columns</h2>
      {columnMessages.map((message) => (
        <p key={message} className="field-error" role="alert">
          {message}
        </p>
      ))}

      {form.columns.map((column, index) => (
        <ColumnRuleForm
          key={column.key}
          index={index}
          column={column}
          issues={issues.columns.get(index) ?? {}}
          isFirst={index === 0}
          isLast={index === form.columns.length - 1}
          onChange={(patch) => patchColumn(column.key, patch)}
          onRemove={() =>
            setForm((f) => ({ ...f, columns: f.columns.filter((c) => c.key !== column.key) }))
          }
          onMove={(direction) => move(index, direction)}
        />
      ))}

      <p>
        <button
          type="button"
          onClick={() => {
            setForm((f) => ({ ...f, columns: [...f.columns, emptyColumn(nextKey)] }));
            setNextKey((k) => k + 1);
          }}
        >
          Add column
        </button>
      </p>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save schema'}
        </button>
        <Link to="/schemas">Cancel</Link>
      </div>
    </form>
  );
}
