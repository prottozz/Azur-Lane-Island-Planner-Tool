import { useState } from 'react';
import { finishCafeRun, startCafeRun } from '../../shared/actions';
import type { Cafe, CafePlan, CafeRun, Qty } from '../../shared/types';
import { runningRun, startedAtLabel, todaysRun } from '../cafeRuns';
import { useApp, useNow } from '../useAppState';

/** Keeps a typed leftover within 0..sent; other text is left for finishCafeRun to reject. */
function clampLeftover(raw: string, sent: number): string {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return raw;
  return String(Math.min(sent, Math.max(0, n)));
}

function FinishForm({ run, cafeName }: { run: CafeRun; cafeName: string }) {
  const { gd, apply } = useApp();
  const [leftovers, setLeftovers] = useState<Record<string, string>>({});
  const [income, setIncome] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => gd.items[id]?.name ?? id;

  const finish = () => {
    const left: Qty[] = run.dishes.map(d => ({ item: d.item, qty: Number(leftovers[d.item] || 0) }));
    const inc = income.trim() === '' ? null : Number(income);
    setError(apply((s, g) => finishCafeRun(s, g, { runId: run.id, leftovers: left, income: inc })));
  };

  return (
    <div className="cafe-finish">
      {error && <p className="error" role="alert">{error}</p>}
      {run.dishes.map(d => (
        <label key={d.item}>
          Leftover {name(d.item)}{' '}
          <input type="number" min={0} max={d.qty} step={1} aria-label={`Leftover ${name(d.item)}`}
            value={leftovers[d.item] ?? '0'} onChange={e => setLeftovers({ ...leftovers, [d.item]: clampLeftover(e.target.value, d.qty) })} />
        </label>
      ))}
      <label>
        Income{' '}
        <input type="number" min={0} aria-label="Income" value={income} placeholder="optional"
          onChange={e => setIncome(e.target.value)} />
      </label>
      <button className="primary" onClick={finish} aria-label="Finish" title={`Finish ${cafeName} run`}>Finish</button>
    </div>
  );
}

function CafeCard({ cafe }: { cafe: Cafe }) {
  const { gd, state, apply } = useApp();
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => gd.items[id]?.name ?? id;

  const plan: CafePlan = state.cafePlans.find(p => p.cafeId === cafe.id) ?? { cafeId: cafe.id, rankIndex: 0, dishes: [] };
  const rank = cafe.ranks[plan.rankIndex] ?? cafe.ranks[0];
  const slots = rank?.dishSlots ?? 0;
  const capacity = rank?.capacityPerDish ?? 0;
  const dishes = plan.dishes.slice(0, slots);

  const savePlan = (next: CafePlan) => apply(s => ({
    ...s,
    cafePlans: s.cafePlans.some(p => p.cafeId === cafe.id)
      ? s.cafePlans.map(p => (p.cafeId === cafe.id ? next : p))
      : [...s.cafePlans, next],
  }));

  const setRank = (rankIndex: number) => {
    const slotCount = cafe.ranks[rankIndex]?.dishSlots ?? 0;
    savePlan({ ...plan, rankIndex, dishes: plan.dishes.slice(0, slotCount) });
  };
  const setDish = (slot: number, item: string) => {
    const next = [...dishes];
    if (item === '') next.splice(slot, 1);
    else if (slot < next.length) next[slot] = item;
    else next.push(item);
    savePlan({ ...plan, dishes: next });
  };

  const rows = dishes.map(item => {
    const have = state.stock[item] ?? 0;
    const value = gd.items[item]?.cafeValue ?? null;
    return { item, have, need: Math.max(0, capacity - have), value: (value ?? 0) * capacity, noValue: value === null };
  });
  const income = rows.reduce((n, r) => n + r.value, 0);
  const missing = rows.filter(r => r.need > 0);

  const todays = todaysRun(state, cafe.id, now);
  const running = runningRun(state, cafe.id);

  const start = () => setError(apply((s, g) => startCafeRun(s, g, {
    cafeId: cafe.id, dishes: rows.map(r => ({ item: r.item, qty: capacity })), now,
  })));

  return (
    <section className="cafe-card">
      <h3>{cafe.name}</h3>
      <label>
        Rank{' '}
        <select aria-label="Rank" value={plan.rankIndex} onChange={e => setRank(Number(e.target.value))}>
          {cafe.ranks.map((r, i) => <option key={i} value={i}>{r.name}</option>)}
        </select>
      </label>
      <div className="dish-pickers">
        {Array.from({ length: slots }, (_, i) => (
          <label key={i}>
            Dish {i + 1}{' '}
            <select aria-label={`Dish ${i + 1}`} value={dishes[i] ?? ''} onChange={e => setDish(i, e.target.value)}>
              <option value="">—</option>
              {cafe.sellable
                .filter(id => id === dishes[i] || !dishes.includes(id))
                .map(id => <option key={id} value={id}>{name(id)}</option>)}
            </select>
          </label>
        ))}
      </div>
      <ul className="dish-rows">
        {rows.map(r => (
          <li key={r.item} data-testid={`dish-${r.item}`}>
            {name(r.item)}: qty {capacity}, have {r.have}, need {r.need}, value {r.value}
            {r.noValue && <span className="muted"> (no value)</span>}
          </li>
        ))}
      </ul>
      <p data-testid="est-income">Est. income: {income}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!todays && (
        <div>
          <button className="primary" disabled={rows.length === 0 || missing.length > 0} onClick={start}>Start run</button>
          {missing.length > 0 && (
            <span className="muted" data-testid="missing">
              {' '}Missing: {missing.map(r => `${name(r.item)} ×${r.need}`).join(', ')}
            </span>
          )}
        </div>
      )}
      {running && (
        <>
          <p>Running since {startedAtLabel(running)}</p>
          <FinishForm run={running} cafeName={cafe.name} />
        </>
      )}
      {todays?.status === 'done' && (
        <p>Done{todays.income !== null ? ` — income ${todays.income}` : ''}</p>
      )}
    </section>
  );
}

export function CafePanel() {
  const { gd } = useApp();
  const cafes = Object.values(gd.cafes).filter(c => c.active).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (cafes.length === 0) return <p className="muted">No active cafés.</p>;
  return <div className="cafe-panel">{cafes.map(c => <CafeCard key={c.id} cafe={c} />)}</div>;
}
