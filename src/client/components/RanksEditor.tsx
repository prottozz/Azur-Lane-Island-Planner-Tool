import { useState } from 'react';
import type { CafeRank } from '../../shared/types';
import { CommitInput } from './CommitInput';

interface Props {
  label: string;
  ranks: CafeRank[];
  /** Returns an error message, or null when the change was accepted. */
  onChange(next: CafeRank[]): string | null;
}

const positiveInt = (raw: string): number | null => (/^\d+$/.test(raw.trim()) && Number(raw) > 0 ? Number(raw) : null);

export function RanksEditor({ label, ranks, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, change: Partial<CafeRank>) => onChange(ranks.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const intField = (i: number, field: 'dishSlots' | 'capacityPerDish', what: string) => (raw: string) => {
    const n = positiveInt(raw);
    return n === null ? `${what} must be a positive whole number` : update(i, { [field]: n });
  };

  const remove = (i: number) => {
    if (ranks.length <= 1) { setError('A café needs at least one rank'); return; }
    setError(onChange(ranks.filter((_, j) => j !== i)));
  };
  const add = () => setError(onChange([...ranks, { name: `Rank ${ranks.length + 1}`, dishSlots: 1, capacityPerDish: 1 }]));

  return (
    <div className="ranks-editor">
      {ranks.map((r, i) => (
        <div key={i} className="rank-row">
          <CommitInput label={`${label} rank ${i + 1} name`} value={r.name}
            onCommit={raw => (raw.trim() ? update(i, { name: raw.trim() }) : 'Rank name can’t be empty')} />
          <span> slots </span>
          <CommitInput numeric label={`${label} rank ${i + 1} dish slots`} value={String(r.dishSlots)} onCommit={intField(i, 'dishSlots', 'Dish slots')} />
          <span> per dish </span>
          <CommitInput numeric label={`${label} rank ${i + 1} capacity per dish`} value={String(r.capacityPerDish)} onCommit={intField(i, 'capacityPerDish', 'Capacity per dish')} />
          <button type="button" className="small" aria-label={`Remove rank ${i + 1} of ${label}`} onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button type="button" className="small" aria-label={`Add rank to ${label}`} onClick={add}>Add rank</button>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}
