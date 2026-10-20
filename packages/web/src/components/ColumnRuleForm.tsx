import type { ColumnType, DateFormat } from '@csv-validator/core';
import {
  COLUMN_TYPES,
  DATE_FORMATS,
  DATE_FORMAT_LABELS,
  TYPE_INFO,
  type ColumnForm,
} from '../schemaForm';

export interface ColumnRuleFormProps {
  index: number;
  column: ColumnForm;
  /** Server messages for this column, keyed by property (`''` for column-level). */
  issues: Record<string, string[]>;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<ColumnForm>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

const BOUND_LABELS = {
  number: { min: 'Minimum value', max: 'Maximum value', input: 'number' },
  length: { min: 'Minimum length', max: 'Maximum length', input: 'number' },
  date: { min: 'Earliest date', max: 'Latest date', input: 'text' },
} as const;

/** One column's rules. The fields shown follow the chosen type; the server judges the values (FR-30). */
export function ColumnRuleForm(props: ColumnRuleFormProps) {
  const { index, column, issues, onChange } = props;
  const info = TYPE_INFO[column.type];
  const id = (field: string) => `column-${column.key}-${field}`;
  const errors = (field: string) =>
    issues[field]?.map((message) => (
      <p key={message} className="field-error" role="alert" id={`${id(field)}-error`}>
        {message}
      </p>
    ));
  const describedBy = (field: string) => (issues[field] ? `${id(field)}-error` : undefined);

  return (
    <fieldset className="column-card">
      <legend>{`Column ${index + 1}`}</legend>
      {errors('')}

      <div className="column-grid">
        <div className="field">
          <label htmlFor={id('name')}>Name</label>
          <input
            id={id('name')}
            value={column.name}
            aria-invalid={Boolean(issues['name'])}
            aria-describedby={describedBy('name')}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          {errors('name')}
        </div>

        <div className="field">
          <label htmlFor={id('type')}>Type</label>
          <select
            id={id('type')}
            value={column.type}
            aria-invalid={Boolean(issues['type'])}
            onChange={(e) => onChange({ type: e.target.value as ColumnType })}
          >
            {COLUMN_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_INFO[type].label}
              </option>
            ))}
          </select>
          {errors('type')}
        </div>

        <div className="field checks">
          <label>
            <input
              type="checkbox"
              checked={column.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            Required
          </label>
          <label>
            <input
              type="checkbox"
              checked={column.unique}
              onChange={(e) => onChange({ unique: e.target.checked })}
            />
            Unique
          </label>
        </div>
      </div>

      {info.dateFormat && (
        <div className="field">
          <label htmlFor={id('dateFormat')}>Date format</label>
          <select
            id={id('dateFormat')}
            value={column.dateFormat}
            aria-invalid={Boolean(issues['dateFormat'])}
            onChange={(e) => onChange({ dateFormat: e.target.value as DateFormat | '' })}
          >
            <option value="">YYYY-MM-DD (default)</option>
            {DATE_FORMATS.filter((f) => f !== 'YYYY-MM-DD').map((format) => (
              <option key={format} value={format}>
                {DATE_FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
          <p className="hint">YYYY-MM-DD is always accepted, so cleaned files re-validate.</p>
          {errors('dateFormat')}
        </div>
      )}

      {info.pattern && (
        <div className="field">
          <label htmlFor={id('pattern')}>Pattern</label>
          <input
            id={id('pattern')}
            className="mono"
            value={column.pattern}
            aria-invalid={Boolean(issues['pattern'])}
            aria-describedby={`${id('pattern')}-hint ${describedBy('pattern') ?? ''}`.trim()}
            onChange={(e) => onChange({ pattern: e.target.value })}
          />
          <p className="hint" id={`${id('pattern')}-hint`}>
            RE2 syntax, matched against the whole value. Lookahead, lookbehind and backreferences
            are not supported.
          </p>
          {errors('pattern')}
        </div>
      )}

      {info.bounds && (
        <div className="column-grid two">
          {(['min', 'max'] as const).map((side) => (
            <div className="field" key={side}>
              <label htmlFor={id(side)}>{BOUND_LABELS[info.bounds!][side]}</label>
              <input
                id={id(side)}
                type={BOUND_LABELS[info.bounds!].input}
                step={column.type === 'decimal' ? 'any' : undefined}
                placeholder={info.bounds === 'date' ? 'YYYY-MM-DD' : undefined}
                value={column[side]}
                aria-invalid={Boolean(issues[side])}
                aria-describedby={describedBy(side)}
                onChange={(e) => onChange({ [side]: e.target.value })}
              />
              {errors(side)}
            </div>
          ))}
        </div>
      )}

      {info.enum && (
        <div className="field">
          <label htmlFor={id('enum')}>Allowed values</label>
          <textarea
            id={id('enum')}
            rows={3}
            value={column.enumText}
            aria-invalid={Boolean(issues['enum'])}
            aria-describedby={`${id('enum')}-hint ${describedBy('enum') ?? ''}`.trim()}
            onChange={(e) => onChange({ enumText: e.target.value })}
          />
          <p className="hint" id={`${id('enum')}-hint`}>
            One value per line. Leave empty to allow any value.
          </p>
          {errors('enum')}
        </div>
      )}

      <div className="column-actions">
        <button type="button" onClick={() => props.onMove(-1)} disabled={props.isFirst}>
          Move up
        </button>
        <button type="button" onClick={() => props.onMove(1)} disabled={props.isLast}>
          Move down
        </button>
        <button type="button" className="danger" onClick={props.onRemove}>
          Remove column
        </button>
      </div>
    </fieldset>
  );
}
