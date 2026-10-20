import type { RunSummary } from '../api/client';
import { formatCount } from '../format';

export function SummaryCards({ run }: { run: RunSummary }) {
  const cards: [string, number][] = [
    ['Total rows', run.totalRows],
    ['Valid rows', run.validRows],
    ['Invalid rows', run.invalidRows],
    ['Duplicates dropped', run.duplicateRowsDropped],
    ['Errors', run.totalErrors],
    ['Sanitized cells', run.sanitizedCells],
  ];
  return (
    <dl className="cards">
      {cards.map(([label, value]) => (
        <div key={label} className="card">
          <dt>{label}</dt>
          <dd>{formatCount(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
