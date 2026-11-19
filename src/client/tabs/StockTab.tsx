import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { setStock } from '../../shared/actions';
import { consumersOf, producersOf } from '../../shared/gamedata';
import { newId } from '../../shared/ids';
import { cafeDemand, reservedDemand } from '../../shared/planner/suggest';
import type { GameData, ItemId, Qty, Reservation } from '../../shared/types';
import { useApp } from '../useAppState';

const MAX_USED_IN = 3;

function parseQty(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

function qtyMap(list: Qty[]): Map<ItemId, number> {
  return new Map(list.map(q => [q.item, q.qty]));
}

function madeIn(gd: GameData, item: ItemId): string {
  const names = new Set<string>();
  for (const r of producersOf(gd, item)) names.add(gd.buildings[r.buildingId]?.name ?? r.buildingId);
  return [...names].join(', ');
}

function usedIn(gd: GameData, item: ItemId): string {
  const names = new Set<string>();
  for (const r of consumersOf(gd, item)) {
    const out = r.outputs[0]?.item;
    names.add(out ? gd.items[out]?.name ?? out : r.id);
  }
  const all = [...names];
  const shown = all.slice(0, MAX_USED_IN).join(', ');
  return all.length > MAX_USED_IN ? `${shown} +${all.length - MAX_USED_IN}` : shown;
}

function QtyCell({ name, qty, onCommit }: { name: string; qty: number; onCommit(n: number): string | null }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const n = parseQty(draft);
    if (n === null) {
      setError('Stock must be a whole number, zero or more');
      return;
    }
    const err = onCommit(n);
    setError(err);
    if (!err) setDraft(null);
  };
  const revert = () => { setDraft(null); setError(null); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') revert();
  };

  return (
    <>
      <input type="text" inputMode="numeric" aria-label={`Stock ${name}`} value={draft ?? String(qty)}
        onChange={e => { setDraft(e.target.value); setError(null); }}
        onBlur={commit} onKeyDown={onKeyDown} />
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}

function ReservationsEditor() {
  const { gd, state, apply } = useApp();
  const items = useMemo(
    () => Object.values(gd.items).filter(i => i.active).sort((a, b) => a.name.localeCompare(b.name)),
    [gd],
  );
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('1');
  const [source, setSource] = useState<Reservation['source']>('request');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ id: string; message: string } | null>(null);

  const nameOf = (id: ItemId) => gd.items[id]?.name ?? id;

  const add = () => {
    const chosen = item || items[0]?.id;
    const n = parseQty(qty);
    if (!chosen) { setError('Pick an item'); return; }
    if (n === null || n < 1) { setError('Quantity must be a positive whole number'); return; }
    const res: Reservation = { id: newId(), item: chosen, qty: n, source, ...(note.trim() ? { note: note.trim() } : {}) };
    const err = apply(s => ({ ...s, reservations: [...s.reservations, res] }));
    setError(err);
    if (!err) { setQty('1'); setNote(''); }
  };

  const remove = (id: string) => {
    const err = apply(s => ({ ...s, reservations: s.reservations.filter(r => r.id !== id) }));
    setRemoveError(err ? { id, message: err } : null);
  };

  return (
    <section className="reservations">
      <h3>Reservations</h3>
      {state.reservations.length === 0 ? <p className="muted">Nothing reserved.</p> : (
        <ul data-testid="reservations">
          {state.reservations.map(r => (
            <li key={r.id}>
              {nameOf(r.item)} × {r.qty} ({r.source}){r.note ? ` — ${r.note}` : ''}{' '}
              <button type="button" aria-label={`Remove reservation ${nameOf(r.item)}`} onClick={() => remove(r.id)}>Remove</button>
              {removeError?.id === r.id && <span className="error" role="alert">{removeError.message}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="reservation-form">
        <select aria-label="Reservation item" value={item || items[0]?.id || ''} onChange={e => setItem(e.target.value)}>
          {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input type="text" inputMode="numeric" aria-label="Reservation quantity" value={qty} onChange={e => setQty(e.target.value)} />
        <select aria-label="Reservation source" value={source} onChange={e => setSource(e.target.value as Reservation['source'])}>
          <option value="request">request</option>
          <option value="quest">quest</option>
        </select>
        <input type="text" aria-label="Reservation note" placeholder="note" value={note} onChange={e => setNote(e.target.value)} />
        <button type="button" onClick={add}>Add reservation</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function StockTab() {
  const { gd, state, apply } = useApp();
  const [search, setSearch] = useState('');
  const [showZero, setShowZero] = useState(false);

  const rows = useMemo(() => {
    const reserved = new Map<ItemId, number>();
    for (const list of [cafeDemand(gd, state), reservedDemand(state)]) {
      for (const [item, q] of qtyMap(list)) reserved.set(item, (reserved.get(item) ?? 0) + q);
    }
    const known = Object.values(gd.items).filter(i => i.active).map(i => ({ id: i.id, name: i.name }));
    const unknown = Object.keys(state.stock).filter(id => !gd.items[id]).map(id => ({ id, name: id }));
    const q = search.trim().toLowerCase();
    return [...known, ...unknown]
      .filter(r => (showZero || (state.stock[r.id] ?? 0) > 0) && r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(r => {
        const qty = state.stock[r.id] ?? 0;
        const res = reserved.get(r.id) ?? 0;
        return { ...r, qty, reserved: res, free: Math.max(0, qty - res) };
      });
  }, [gd, state, search, showZero]);

  return (
    <div className="stock-tab">
      <p>
        <label>Search{' '}
          <input type="search" aria-label="Search stock" value={search} onChange={e => setSearch(e.target.value)} />
        </label>{' '}
        <label>
          <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} /> Show zero stock
        </label>
      </p>
      <table data-testid="stock-table">
        <thead>
          <tr><th>Item</th><th>Qty</th><th>Reserved</th><th>Free</th><th>Made in</th><th>Used in</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} data-testid={`stock-${r.id}`}>
              <td>{r.name}</td>
              <td><QtyCell name={r.name} qty={r.qty} onCommit={n => apply(s => setStock(s, r.id, n))} /></td>
              <td>{r.reserved}</td>
              <td>{r.free}</td>
              <td>{madeIn(gd, r.id)}</td>
              <td>{usedIn(gd, r.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted">No matching items.</p>}
      <ReservationsEditor />
    </div>
  );
}
