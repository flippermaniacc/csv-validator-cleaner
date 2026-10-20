import type { RunSummary } from '../api/client';

/** Failed (file-level), errors found, or fully valid. */
export function StatusBadge({ run }: { run: Pick<RunSummary, 'status' | 'invalidRows'> }) {
  if (run.status === 'failed') return <span className="badge failed">Failed</span>;
  return run.invalidRows > 0 ? (
    <span className="badge errors">Errors found</span>
  ) : (
    <span className="badge valid">All rows valid</span>
  );
}
