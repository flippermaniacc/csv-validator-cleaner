import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiRequestError } from '../api/client';
import { useApi } from '../api/context';
import { formatBytes, MAX_UPLOAD_BYTES } from '../format';

export function Validate() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [schemaChoice, setSchemaChoice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const schemas = useQuery({ queryKey: ['schemas'], queryFn: () => api.listSchemas() });
  const schemaId = schemaChoice || schemas.data?.[0]?.id || '';
  // Only a convenience: the server enforces the limit (FR-7).
  const tooLarge = file !== null && file.size > MAX_UPLOAD_BYTES;

  const validate = useMutation({
    mutationFn: () => api.validate(schemaId, file as File),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
      navigate(`/runs/${run.id}`);
    },
  });

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      validate.reset();
    }
  };

  const failure = validate.error instanceof ApiRequestError ? validate.error : null;

  return (
    <section aria-labelledby="validate-title">
      <h1 id="validate-title">Validate a CSV</h1>

      {schemas.isPending && <p role="status">Loading schemas…</p>}
      {schemas.isError && (
        <p role="alert" className="notice error">
          The schemas could not be loaded.
        </p>
      )}
      {schemas.isSuccess && schemas.data.length === 0 && (
        <p className="empty">
          You need a schema first. <Link to="/schemas/new">Create a schema</Link> describing the
          columns and rules, then come back to validate a file.
        </p>
      )}

      {schemas.isSuccess && schemas.data.length > 0 && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            validate.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="validate-schema">Schema</label>
            <select
              id="validate-schema"
              value={schemaId}
              onChange={(e) => setSchemaChoice(e.target.value)}
            >
              {schemas.data.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.name}
                </option>
              ))}
            </select>
          </div>

          <div
            className={dragging ? 'dropzone dragging' : 'dropzone'}
            data-testid="dropzone"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <label htmlFor="validate-file">CSV file</label>
            <input
              id="validate-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                validate.reset();
              }}
            />
            <p className="hint">
              Drop a file here or choose one. Up to 10 MiB, UTF-8, UTF-16 or windows-1251.
            </p>
            {file && (
              <p>
                Selected: <strong>{file.name}</strong> ({formatBytes(file.size)})
              </p>
            )}
            {tooLarge && (
              <p className="field-error" role="alert">
                This file is larger than 10 MiB, so the server will not accept it.
              </p>
            )}
          </div>

          {failure && (
            <p className="notice error" role="alert">
              {failure.message}
            </p>
          )}

          <div className="form-actions">
            <button
              type="submit"
              className="primary"
              disabled={!file || tooLarge || !schemaId || validate.isPending}
            >
              {validate.isPending ? 'Validating…' : 'Validate'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
