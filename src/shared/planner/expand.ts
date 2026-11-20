import type { GameData, ItemId, Qty, Recipe } from '../types';
import { producersOf } from '../gamedata';

export interface PlanStep { recipeId: string; runs: number; forItem: ItemId }
export interface Purchase { item: ItemId; qty: number; cost: number; currency: string }
export interface Expansion { steps: PlanStep[]; purchases: Purchase[]; unobtainable: Qty[]; shortfalls: Qty[] }

const distinctInputs = (r: Recipe) => new Set(r.inputs.map(q => q.item)).size;

/** Active recipes whose regular outputs include the item (bonus-only producers are ignored), best first. */
export function pickProducer(gd: GameData, item: ItemId): { recipe: Recipe; perRun: number } | null {
  const candidates = producersOf(gd, item)
    .map(recipe => ({ recipe, perRun: recipe.outputs.filter(o => o.item === item).reduce((n, o) => n + o.qty, 0) }))
    .filter(c => c.perRun > 0);
  candidates.sort((a, b) => distinctInputs(a.recipe) - distinctInputs(b.recipe) || (a.recipe.id < b.recipe.id ? -1 : a.recipe.id > b.recipe.id ? 1 : 0));
  return candidates[0] ?? null;
}

function mergeInto(map: Map<ItemId, number>, item: ItemId, qty: number) {
  map.set(item, (map.get(item) ?? 0) + qty);
}

/**
 * Expands demand backward through active recipes. Stock in `available` is consumed as it goes
 * (the argument itself is not modified); leftover outputs of a step return to the pool.
 * Items with no producer are bought from the shop if listed, else reported unobtainable;
 * an item already on the current path (cycle) is unobtainable.
 */
export function expandDemand(gd: GameData, demand: Qty[], available: Record<ItemId, number>): Expansion {
  const pool: Record<ItemId, number> = { ...available };
  const steps: PlanStep[] = [];
  const purchaseQty = new Map<ItemId, number>();
  const unobtainable = new Map<ItemId, number>();
  const shortfalls = new Map<ItemId, number>();

  /** Satisfies `qty` of `item`; returns the amount still missing after stock (before production). */
  const need = (item: ItemId, qty: number, path: ItemId[], top: boolean) => {
    if (qty <= 0) return;
    const have = Math.max(0, pool[item] ?? 0);
    const taken = Math.min(have, qty);
    pool[item] = have - taken;
    const remaining = qty - taken;
    if (remaining <= 0) return;
    if (top) mergeInto(shortfalls, item, remaining);

    if (path.includes(item)) {
      mergeInto(unobtainable, item, remaining);
      return;
    }

    const producer = pickProducer(gd, item);
    if (producer) {
      const { recipe, perRun } = producer;
      const totalRuns = Math.ceil(remaining / perRun);
      pool[item] = (pool[item] ?? 0) + totalRuns * perRun - remaining;

      const slots = gd.buildings[recipe.buildingId]?.slots ?? 1;
      const cap = Math.max(1, recipe.maxRuns * slots);
      const chunks: number[] = [];
      for (let left = totalRuns; left > 0; left -= cap) chunks.push(Math.min(cap, left));

      for (const i of recipe.inputs) need(i.item, i.qty * totalRuns, [...path, item], false);
      for (const runs of chunks) steps.push({ recipeId: recipe.id, runs, forItem: item });
      return;
    }

    if (gd.shop.some(e => e.item === item)) mergeInto(purchaseQty, item, remaining);
    else mergeInto(unobtainable, item, remaining);
  };

  for (const d of demand) need(d.item, d.qty, [], true);

  const purchases: Purchase[] = [...purchaseQty].map(([item, qty]) => {
    const entry = gd.shop.find(e => e.item === item)!;
    return { item, qty, cost: qty * entry.price, currency: entry.currency };
  });
  const toQty = (m: Map<ItemId, number>): Qty[] => [...m].map(([item, qty]) => ({ item, qty }));
  return { steps, purchases, unobtainable: toQty(unobtainable), shortfalls: toQty(shortfalls) };
}
