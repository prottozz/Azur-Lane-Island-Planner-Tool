import { useState } from 'react';
import type { Item, ItemId } from '../../shared/types';

export interface ChipEntry { item: ItemId; qty: number; everyRuns?: number }

interface Props {
  label: string;
  entries: ChipEntry[];
  items: Record<ItemId, Item>;
  /** false for plain item lists (café sellable). */
  withQty?: boolean;
  /** bonus outputs: "+qty every N runs". */
  withEvery?: boolean;
  minEntries?: number;
  /** Returns an error message, or null when the change was accepted. */
  onChange(next: ChipEntry[]): string | null;
}

const isPositiveInt = (t: string) => /^\d+$/.test(t.trim()) && Number(t) > 0;

export function QtyChipsEditor({ label, entries, items, withQty = true, withEvery = false, minEntries = 0, onChange }: Props) {
  const options = Object.values(items).sort((a, b) => a.name.localeCompare(b.name));
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('1');
  const [every, setEvery] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: ItemId) => items[id]?.name ?? id;

  const text = (e: ChipEntry) =>
    `${nameOf(e.item)}${withQty ? ` ×${e.qty}` : ''}${withEvery ? ` every ${e.everyRuns} runs` : ''}`;

  const remove = (index: number) => {
    if (entries.length - 1 < minEntries) { setError(`Needs at least ${minEntries}`); return; }
    setError(onChange(entries.filter((_, i) => i !== index)));
  };

  const add = () => {
    const chosen = item || options[0]?.id;
    if (!chosen) { setError('No items to choose from'); return; }
    if (withQty && !isPositiveInt(qty)) { setError('Quantity must be a positive whole number'); return; }
    if (withEvery && !isPositiveInt(every)) { setError('"Every" must be a positive whole number of runs'); return; }
    const entry: ChipEntry = { item: chosen, qty: withQty ? Number(qty) : 1, ...(withEvery ? { everyRuns: Number(every) } : {}) };
    const same = entries.findIndex(e => e.item === chosen && e.everyRuns === entry.everyRuns);
    const next = same >= 0 && withQty
      ? entries.map((e, i) => (i === same ? { ...e, qty: e.qty + entry.qty } : e))
      : same >= 0 ? entries : [...entries, entry];
    const err = onChange(next);
    setError(err);
    if (!err) { setQty('1'); setEvery('1'); }
  };

  return (
    <div className="chips-editor">
      <span className="chips">
        {entries.map((e, i) => (
          <span key={`${e.item}-${e.everyRuns ?? ''}-${i}`} className="chip">
            <span>{text(e)}</span>
            <button type="button" className="chip-remove" aria-label={`Remove ${nameOf(e.item)} from ${label}`} onClick={() => remove(i)}>✕</button>
          </span>
        ))}
      </span>
      <span className="chip-add">
        <select aria-label={`${label} item`} value={item || options[0]?.id || ''} onChange={e => setItem(e.target.value)}>
          {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {withQty && <input type="text" inputMode="numeric" size={3} aria-label={`${label} qty`} value={qty} onChange={e => setQty(e.target.value)} />}
        {withEvery && <>every <input type="text" inputMode="numeric" size={3} aria-label={`${label} every runs`} value={every} onChange={e => setEvery(e.target.value)} /> runs</>}
        <button type="button" className="small" aria-label={`Add to ${label}`} onClick={add}>Add</button>
      </span>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}
