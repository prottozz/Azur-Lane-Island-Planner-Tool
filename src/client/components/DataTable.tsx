import { useState } from 'react';
import type { ReactNode } from 'react';
import type { GameData, Result } from '../../shared/types';
import { useApp } from '../useAppState';
import { CommitInput } from './CommitInput';

export interface EditSpec<T> {
  kind: 'text' | 'number' | 'int' | 'duration' | 'select' | 'bool';
  options?: { value: string; label: string }[];
  /** Current value as shown: text for typed kinds, the option value for select, boolean for bool. */
  value(row: T): string | boolean;
  /** Validates typed text; an error keeps the old value. Not used for select/bool. */
  parse?(raw: string, row: T): Result<unknown>;
  commit(row: T, value: unknown, gd: GameData): Result<GameData> | GameData;
}

export interface Column<T> {
  key: string;
  label: string;
  render?(row: T): ReactNode;
  edit?: EditSpec<T>;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey(row: T): string;
  rowLabel(row: T): string;
  addLabel: string;
  /** Each action returns an error message, or null on success. */
  onAdd?(): string | null;
  onDuplicate?(row: T): string | null;
  onDelete?(row: T): string | null;
  addDisabledReason?: string;
  /** Key of a just-added row: rendered first and highlighted. */
  freshKey?: string | null;
}

function EditCell<T>({ col, row, label }: { col: Column<T>; row: T; label: string }) {
  const { applyGameData } = useApp();
  const edit = col.edit!;
  const [error, setError] = useState<string | null>(null);
  const aria = `${col.label} ${label}`;

  const save = (v: unknown): string | null => {
    const err = applyGameData(gd => edit.commit(row, v, gd));
    setError(err);
    return err;
  };
  const current = edit.value(row);

  if (edit.kind === 'bool') {
    return <input type="checkbox" aria-label={aria} checked={current === true} onChange={e => save(e.target.checked)} />;
  }
  if (edit.kind === 'select') {
    return (
      <>
        <select aria-label={aria} value={String(current)} onChange={e => save(e.target.value)}>
          {(edit.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {error && <span className="error" role="alert">{error}</span>}
      </>
    );
  }
  return (
    <CommitInput label={aria} value={String(current)} numeric={edit.kind === 'number' || edit.kind === 'int'}
      onCommit={raw => {
        const p = edit.parse ? edit.parse(raw, row) : ({ ok: true, value: raw } as Result<unknown>);
        return p.ok ? save(p.value) : p.error;
      }} />
  );
}

function freshFirst<T>(rows: T[], rowKey: (row: T) => string, freshKey: string | null | undefined): T[] {
  if (!freshKey) return rows;
  const i = rows.findIndex(r => rowKey(r) === freshKey);
  return i <= 0 ? rows : [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)];
}

export function DataTable<T>({ columns, rows, rowKey, rowLabel, addLabel, onAdd, onDuplicate, onDelete, addDisabledReason, freshKey }: Props<T>) {
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | null>(null);

  const run = (key: string, fn: (() => string | null) | undefined) => {
    const err = fn ? fn() : null;
    setRowErrors(prev => {
      const { [key]: _old, ...rest } = prev;
      return err ? { ...rest, [key]: err } : rest;
    });
  };

  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {columns.map(c => <th key={c.key}>{c.label}</th>)}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {freshFirst(rows, rowKey, freshKey).map(row => {
            const key = rowKey(row);
            const label = rowLabel(row);
            return (
              <tr key={key} data-testid={`row-${key}`} className={key === freshKey ? 'fresh' : undefined}>
                {columns.map(c => (
                  <td key={c.key}>{c.edit ? <EditCell col={c} row={row} label={label} /> : c.render?.(row)}</td>
                ))}
                <td className="row-actions">
                  {onDuplicate && <button type="button" className="small" aria-label={`Duplicate ${label}`} onClick={() => run(key, () => onDuplicate(row))}>Duplicate</button>}{' '}
                  {onDelete && <button type="button" className="small" aria-label={`Delete ${label}`} onClick={() => run(key, () => onDelete(row))}>Delete</button>}
                  {rowErrors[key] && <span className="error" role="alert">{rowErrors[key]}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted">Nothing to show with the current filters.</p>}
      {onAdd && (
        <p>
          <button type="button" disabled={!!addDisabledReason} title={addDisabledReason} onClick={() => setAddError(onAdd())}>{addLabel}</button>
          {addDisabledReason && <span className="muted"> {addDisabledReason}</span>}
          {addError && <span className="error" role="alert"> {addError}</span>}
        </p>
      )}
    </div>
  );
}
