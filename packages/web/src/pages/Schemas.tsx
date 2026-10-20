import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';

export function Schemas() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const schemas = useQuery({ queryKey: ['schemas'], queryFn: () => api.listSchemas() });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSchema(id),
    onSuccess: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ['schemas'] });
    },
  });

  return (
    <section aria-labelledby="schemas-title">
      <div className="page-head">
        <h1 id="schemas-title">Schemas</h1>
        <Link to="/schemas/new" className="button primary">
          New schema
        </Link>
      </div>

      {schemas.isPending && <p role="status">Loading schemas…</p>}
      {schemas.isError && (
        <p role="alert" className="notice error">
          The schemas could not be loaded.
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="notice error">
          The schema could not be deleted.
        </p>
      )}

      {schemas.isSuccess && schemas.data.length === 0 && (
        <p className="empty">
          No schemas yet. A schema describes the columns and rules a CSV must follow.
        </p>
      )}

      {schemas.isSuccess && schemas.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Columns</th>
              <th scope="col">Updated</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {schemas.data.map((schema) => (
              <tr key={schema.id}>
                <th scope="row">{schema.name}</th>
                <td>{schema.columns.length}</td>
                <td>
                  <time dateTime={schema.updatedAt}>
                    {new Date(schema.updatedAt).toLocaleString()}
                  </time>
                </td>
                <td className="row-actions">
                  {confirming === schema.id ? (
                    <>
                      <span>Delete “{schema.name}”?</span>
                      <button
                        type="button"
                        className="danger"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(schema.id)}
                      >
                        Yes, delete
                      </button>
                      <button type="button" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <Link to={`/schemas/${schema.id}`} aria-label={`Edit ${schema.name}`}>
                        Edit
                      </Link>
                      <button
                        type="button"
                        aria-label={`Delete ${schema.name}`}
                        onClick={() => setConfirming(schema.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
