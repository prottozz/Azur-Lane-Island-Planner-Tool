import { addStock } from '../../shared/actions';
import type { Expansion } from '../../shared/planner/expand';
import { useApp } from '../useAppState';

export function Shortfalls({ expansion }: { expansion: Expansion }) {
  const { gd, apply } = useApp();
  const name = (id: string) => gd.items[id]?.name ?? id;

  // Group steps by building, summing runs of the same recipe.
  const groups = new Map<string, Map<string, number>>();
  for (const step of expansion.steps) {
    const recipe = gd.recipes[step.recipeId];
    const building = (recipe && gd.buildings[recipe.buildingId]?.name) ?? 'Unknown building';
    const label = recipe?.outputs[0] ? name(recipe.outputs[0].item) : step.recipeId;
    const recipes = groups.get(building) ?? new Map<string, number>();
    recipes.set(label, (recipes.get(label) ?? 0) + step.runs);
    groups.set(building, recipes);
  }

  const totals = new Map<string, number>();
  for (const p of expansion.purchases) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.cost);

  const empty = groups.size === 0 && expansion.purchases.length === 0 && expansion.unobtainable.length === 0;
  if (empty) return <section className="shortfalls"><h3>Shortfalls</h3><p className="muted">Nothing missing</p></section>;

  return (
    <section className="shortfalls">
      <h3>Shortfalls</h3>
      {groups.size > 0 && (
        <ul>
          {[...groups].flatMap(([building, recipes]) =>
            [...recipes].map(([label, runs]) => (
              <li key={`${building}:${label}`}>{`${building}: ${label} × ${runs} runs`}</li>
            )))}
        </ul>
      )}
      {expansion.purchases.length > 0 && (
        <>
          <h4>To buy</h4>
          <ul>
            {expansion.purchases.map(p => (
              <li key={`${p.item}:${p.currency}`} data-testid={`purchase-${p.item}`}>
                {name(p.item)} × {p.qty} — {p.cost} {p.currency}{' '}
                <button className="small" onClick={() => apply(s => addStock(s, [{ item: p.item, qty: p.qty }]))}>Bought</button>
              </li>
            ))}
          </ul>
          {[...totals].map(([currency, total]) => (
            <p key={currency} data-testid={`total-${currency}`}><strong>Total: {total} {currency}</strong></p>
          ))}
        </>
      )}
      {expansion.unobtainable.length > 0 && (
        <div className="warning" data-testid="unobtainable">
          <h4>Unobtainable</h4>
          <ul>
            {expansion.unobtainable.map(q => <li key={q.item}>{name(q.item)} × {q.qty}: no recipe or shop entry</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
