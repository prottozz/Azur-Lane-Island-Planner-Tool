import type { GameData, Qty, Recipe } from './types';

const scale = (list: Qty[], runs: number): Qty[] => list.map(q => ({ item: q.item, qty: q.qty * runs }));

/** Inputs needed to fill the job (maxRuns runs). */
export function fillJob(r: Recipe): Qty[] {
  return jobInputs(r, r.maxRuns);
}

export function jobInputs(r: Recipe, runs: number): Qty[] {
  return scale(r.inputs, runs);
}

/** Outputs x runs plus bonus qty x floor(runs / everyRuns), merged by item (first-seen order, zero bonus omitted). */
export function jobOutputs(r: Recipe, runs: number): Qty[] {
  const merged = new Map<string, number>();
  const add = (item: string, qty: number) => merged.set(item, (merged.get(item) ?? 0) + qty);
  for (const o of r.outputs) add(o.item, o.qty * runs);
  for (const b of r.bonus) {
    const qty = b.qty * Math.floor(runs / b.everyRuns);
    if (qty > 0) add(b.item, qty);
  }
  return [...merged].map(([item, qty]) => ({ item, qty }));
}

export function jobSeconds(r: Recipe, runs: number): number {
  return runs * r.secondsPerRun;
}

function valuePerHour(r: Recipe, gd: GameData, key: 'idp' | 'cafeValue'): number {
  if (r.secondsPerRun <= 0) return 0;
  let perRun = 0;
  for (const o of r.outputs) perRun += o.qty * (gd.items[o.item]?.[key] ?? 0);
  return (perRun / r.secondsPerRun) * 3600;
}

export function idpPerHour(r: Recipe, gd: GameData): number {
  return valuePerHour(r, gd, 'idp');
}

export function cafeValuePerHour(r: Recipe, gd: GameData): number {
  return valuePerHour(r, gd, 'cafeValue');
}
