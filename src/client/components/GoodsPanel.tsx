import { useState } from 'react';
import { convertToIdp } from '../../shared/actions';
import type { Qty } from '../../shared/types';
import { useApp } from '../useAppState';

export function GoodsPanel() {
  const { gd, state, plan, apply } = useApp();
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const convertible = Object.values(gd.items)
    .filter(i => i.idp !== null && (state.stock[i.id] ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const qtyOf = (id: string, have: number) => {
    const n = Math.floor(Number(qtys[id] || 0));
    return Number.isFinite(n) ? Math.max(0, Math.min(have, n)) : 0;
  };
  const selected: Qty[] = convertible
    .map(i => ({ item: i.id, qty: qtyOf(i.id, state.stock[i.id] ?? 0) }))
    .filter(q => q.qty > 0);

  const convert = () => {
    const err = apply((s, g) => convertToIdp(s, g, selected));
    setError(err);
    if (err === null) setQtys({});
  };

  return (
    <section className="goods-panel">
      <h3>Ranked goods</h3>
      {plan.rankedGoods.length === 0 ? <p className="muted">No factory recipes with IDP value</p> : (
        <table data-testid="ranked-goods">
          <thead>
            <tr><th>Product</th><th>Building</th><th>IDP/h</th><th>Can make now</th></tr>
          </thead>
          <tbody>
            {plan.rankedGoods.map(g => {
              const recipe = gd.recipes[g.recipeId];
              const out = recipe?.outputs[0];
              return (
                <tr key={g.recipeId}>
                  <td>{out ? gd.items[out.item]?.name ?? out.item : g.recipeId}</td>
                  <td>{(recipe && gd.buildings[recipe.buildingId]?.name) ?? '—'}</td>
                  <td>{g.idpPerHour.toFixed(1)}</td>
                  <td>{g.feasibleRuns} runs</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3>Convert to IDP</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {convertible.length === 0 ? <p className="muted">Nothing in stock can be converted</p> : (
        <table data-testid="convert-table">
          <thead>
            <tr><th>Item</th><th>Have</th><th>IDP each</th><th>Convert</th><th>IDP</th></tr>
          </thead>
          <tbody>
            {convertible.map(i => {
              const have = state.stock[i.id] ?? 0;
              const q = qtyOf(i.id, have);
              return (
                <tr key={i.id} data-testid={`convert-${i.id}`}>
                  <td>{i.name}</td>
                  <td>{have}</td>
                  <td>{i.idp}</td>
                  <td>
                    <input type="number" min={0} max={have} step={1} aria-label={`Convert ${i.name}`}
                      value={qtys[i.id] ?? '0'} onChange={e => setQtys({ ...qtys, [i.id]: e.target.value })} />
                  </td>
                  <td>{q * (i.idp ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <button className="primary" disabled={selected.length === 0} onClick={convert}>Convert</button>
    </section>
  );
}
