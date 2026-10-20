import type { RowError } from '@csv-validator/core';
import { ROW_ERROR_LABELS } from '../format';

export function ErrorTable({ errors }: { errors: readonly RowError[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Row</th>
          <th scope="col">Column</th>
          <th scope="col">Error</th>
          <th scope="col">Message</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {errors.map((error, i) => (
          <tr key={`${error.row}-${error.column ?? ''}-${error.code}-${i}`}>
            <td>{error.row}</td>
            <td>{error.column ?? '—'}</td>
            <td>
              <span className="mono">{error.code}</span>
              <div className="hint">{ROW_ERROR_LABELS[error.code]}</div>
            </td>
            <td>{error.message}</td>
            <td className="mono value">{error.value === '' ? '(empty)' : (error.value ?? '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
