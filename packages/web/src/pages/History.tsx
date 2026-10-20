import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { StatusBadge } from '../components/StatusBadge';
import { formatCount, formatTime } from '../format';

export function History() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const runs = useInfiniteQuery({
    queryKey: ['runs'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listRuns(pageParam ? { cursor: pageParam } : {}),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteRun(id),
    onSuccess: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-labelledby="history-title">
      <h1 id="history-title">History</h1>

      {runs.isPending && <p role="status">Loading history…</p>}
      {runs.isError && (
        <p role="alert" className="notice error">
          The history could not be loaded.
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="notice error">
          The run could not be deleted.
        </p>
      )}

      {runs.isSuccess && items.length === 0 && (
        <p className="empty">
          No validations yet. <Link to="/validate">Validate a CSV</Link> to see it here.
        </p>
      )}

      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Schema</th>
              <th scope="col">Result</th>
              <th scope="col">Rows (valid / total)</th>
              <th scope="col">Errors</th>
              <th scope="col">When</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((run) => (
              <tr key={run.id}>
                <th scope="row">
                  <Link to={`/runs/${run.id}`}>{run.originalFilename}</Link>
                </th>
                <td>{run.schema.name}</td>
                <td>
                  <StatusBadge run={run} />
                  {run.fileError && <div className="hint">{run.fileError.code}</div>}
                </td>
                <td>
                  {formatCount(run.validRows)} / {formatCount(run.totalRows)}
                </td>
                <td>{formatCount(run.totalErrors)}</td>
                <td>
                  <time dateTime={run.createdAt}>{formatTime(run.createdAt)}</time>
                </td>
                <td className="row-actions">
                  {confirming === run.id ? (
                    <>
                      <span>Delete this run?</span>
                      <button
                        type="button"
                        className="danger"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(run.id)}
                      >
                        Yes, delete
                      </button>
                      <button type="button" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete run of ${run.originalFilename}`}
                      onClick={() => setConfirming(run.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {runs.hasNextPage && (
        <p>
          <button
            type="button"
            disabled={runs.isFetchingNextPage}
            onClick={() => void runs.fetchNextPage()}
          >
            {runs.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </p>
      )}
    </section>
  );
}
