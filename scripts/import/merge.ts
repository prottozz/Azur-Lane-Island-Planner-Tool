import type { GameData } from '../../src/shared/types';

const MAPS = ['items', 'buildings', 'recipes', 'cafes', 'spawns'] as const;

/** Add entries whose ids are absent from `existing`; existing entries are never modified. */
export function mergeGameData(existing: GameData, imported: GameData): { merged: GameData; added: Record<keyof GameData, number>; skipped: number } {
  const merged: GameData = {
    version: 1,
    items: { ...existing.items }, buildings: { ...existing.buildings }, recipes: { ...existing.recipes },
    cafes: { ...existing.cafes }, shop: [...existing.shop], spawns: { ...existing.spawns },
  };
  const added: Record<keyof GameData, number> = { version: 0, items: 0, buildings: 0, recipes: 0, cafes: 0, shop: 0, spawns: 0 };
  let skipped = 0;

  for (const key of MAPS) {
    const target = merged[key] as Record<string, unknown>;
    for (const [id, value] of Object.entries(imported[key] as Record<string, unknown>)) {
      if (id in target) skipped++;
      else { target[id] = value; added[key]++; }
    }
  }
  const shopKey = (e: { item: string; shop: string }) => `${e.item}|${e.shop}`;
  const have = new Set(merged.shop.map(shopKey));
  for (const e of imported.shop) {
    if (have.has(shopKey(e))) skipped++;
    else { have.add(shopKey(e)); merged.shop.push(e); added.shop++; }
  }
  return { merged, added, skipped };
}

/** Recipes that reference item ids missing from `items`. */
export function unknownItemRefs(gd: GameData): { recipeId: string; items: string[] }[] {
  const out: { recipeId: string; items: string[] }[] = [];
  for (const r of Object.values(gd.recipes)) {
    const missing = [...new Set([...r.inputs, ...r.outputs, ...r.bonus].map(q => q.item).filter(id => !(id in gd.items)))];
    if (missing.length) out.push({ recipeId: r.id, items: missing });
  }
  return out;
}
