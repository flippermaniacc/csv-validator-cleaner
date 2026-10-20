import type { RowErrorCode } from '@csv-validator/core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiRequestError } from '../api/client';
import { useApi } from '../api/context';
import { ErrorTable } from '../components/ErrorTable';
import { StatusBadge } from '../components/StatusBadge';
import { SummaryCards } from '../components/SummaryCards';
import { TruncationNotice } from '../components/TruncationNotice';
import { formatBytes, formatCount, formatTime, ROW_ERROR_CODES, ROW_ERROR_LABELS } from '../format';

const PAGE_SIZE = 50;

export function RunDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState<RowErrorCode | ''>('');
  const [offset, setOffset] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run = useQuery({ queryKey: ['run', id], queryFn: () => api.getRun(id) });
  const hasErrors = run.data?.status === 'completed' && run.data.totalErrors > 0;
  const errors = useQuery({
    queryKey: ['run-errors', id, code, offset],
    queryFn: () => api.listRunErrors(id, { offset, limit: PAGE_SIZE, ...(code ? { code } : {}) }),
    enabled: hasErrors,
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteRun(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
      navigate('/history');
    },
  });

  if (run.isPending) return <p role="status">Loading run…</p>;
  if (run.isError) {
    const missing = run.error instanceof ApiRequestError && run.error.status === 404;
    return (
      <div role="alert" className="notice error">
        <p>{missing ? 'This run no longer exists.' : 'The run could not be loaded.'}</p>
        <Link to="/history">Back to history</Link>
      </div>
    );
  }

  const data = run.data;
  const page = errors.data;
  const counts = ROW_ERROR_CODES.flatMap((c) => {
    const count = data.errorCountsByCode[c];
    return count === undefined ? [] : [[c, count] as const];
  });
  const first = page && page.total > 0 ? page.offset + 1 : 0;
  const last = page ? page.offset + page.items.length : 0;

  const choose = (next: RowErrorCode | '') => {
    setCode(next);
    setOffset(0);
  };

  return (
    <article aria-labelledby="run-title">
      <div className="page-head">
        <h1 id="run-title">{data.originalFilename}</h1>
        <StatusBadge run={data} />
      </div>
      <p className="hint">
        Schema <strong>{data.schema.name}</strong> · {formatTime(data.createdAt)} ·{' '}
        {formatBytes(data.fileSizeBytes)}
        {data.detectedEncoding && ` · ${data.detectedEncoding}`}
        {data.detectedDelimiter && ` · delimiter “${data.detectedDelimiter}”`}
      </p>

      {data.fileError && (
        <p role="alert" className="notice error">
          <span className="mono">{data.fileError.code}</span>: {data.fileError.message}
        </p>
      )}

      {data.status === 'completed' && (
        <>
          <SummaryCards run={data} />
          {data.passthroughColumns.length > 0 && (
            <p className="hint">
              Columns kept as they are, without validation: {data.passthroughColumns.join(', ')}
            </p>
          )}
          <p>
            <a className="button primary" href={api.cleanedUrl(data.id)} download>
              Download cleaned CSV
            </a>{' '}
            <span className="hint">
              {data.cleanedSizeBytes !== null && formatBytes(data.cleanedSizeBytes)} · only valid
              rows
            </span>
          </p>
        </>
      )}
      {data.status === 'failed' && <p className="hint">A failed run has no cleaned file.</p>}

      {hasErrors && (
        <section aria-labelledby="errors-title">
          <h2 id="errors-title">Errors</h2>
          {data.truncated && (
            <TruncationNotice stored={data.errors.total} total={data.totalErrors} />
          )}

          <div className="filters" role="group" aria-label="Filter by error type">
            <button type="button" aria-pressed={code === ''} onClick={() => choose('')}>
              All ({formatCount(data.totalErrors)})
            </button>
            {counts.map(([c, count]) => (
              <button key={c} type="button" aria-pressed={code === c} onClick={() => choose(c)}>
                {ROW_ERROR_LABELS[c]} ({formatCount(count)})
              </button>
            ))}
          </div>

          {errors.isError && (
            <p role="alert" className="notice error">
              The errors could not be loaded.
            </p>
          )}
          {page && page.items.length > 0 && <ErrorTable errors={page.items} />}
          {page && page.total === 0 && <p className="empty">No stored errors of this type.</p>}

          {page && page.total > 0 && (
            <div className="pager">
              <span role="status">
                Showing {formatCount(first)}–{formatCount(last)} of {formatCount(page.total)}
              </span>
              <button
                type="button"
                disabled={offset === 0 || errors.isFetching}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={last >= page.total || errors.isFetching}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}

      <details className="snapshot">
        <summary>Schema used for this run</summary>
        <ul>
          {data.schemaSnapshot.columns.map((column) => (
            <li key={column.name}>
              <span className="mono">{column.name}</span> — {column.type}
              {column.required && ', required'}
              {column.unique && ', unique'}
            </li>
          ))}
        </ul>
      </details>

      <div className="form-actions danger-zone">
        {confirmingDelete ? (
          <>
            <span>Delete this run and its cleaned file?</span>
            <button
              type="button"
              className="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)}>
            Delete run
          </button>
        )}
      </div>
      {remove.isError && (
        <p role="alert" className="notice error">
          The run could not be deleted.
        </p>
      )}
    </article>
  );
}
