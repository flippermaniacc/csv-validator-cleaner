import { formatCount } from '../format';

/** Shown whenever a run has more errors than are stored, with the exact total (FR-29). */
export function TruncationNotice({ stored, total }: { stored: number; total: number }) {
  return (
    <p className="notice warning" role="status">
      This run found {formatCount(total)} errors in total. Only the first {formatCount(stored)} are
      listed below; the counts above are exact.
    </p>
  );
}
