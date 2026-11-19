import { derivePipeline } from '../../src/shared/gamedata';
import { emptyGameData } from '../../src/shared/defaults';
import { parseDuration } from '../../src/shared/time';
import type { Building, BuildingKind, GameData, Item, Qty, Recipe } from '../../src/shared/types';

export interface SiteSource { items: any; places: any; restaurants: any; shops: any }

const SEEDS_SHOP = '10109';
const FLOUR_MILL_SHOP = '10019';

function kindOf(placeId: number): BuildingKind {
  if (placeId === 101) return 'field';
  if (placeId === 102) return 'ranch';
  if (placeId === 401) return 'mine';
  if (placeId === 402) return 'woods';
  if (placeId === 501) return 'orchard';
  if (placeId === 502) return 'nursery';
  if ((placeId >= 601 && placeId <= 604) || placeId === 901) return 'kitchen';
  if (placeId >= 703 && placeId <= 706) return 'factory';
  return 'other';
}

const qtys = (list: { id: number | string; amount: number }[] | undefined): Qty[] =>
  (list ?? []).map(q => ({ item: String(q.id), qty: q.amount }));

/** Map the reference site's JSON into GameData. `season` is accepted for API symmetry; all site data is 'permanent'. */
export function mapSite(src: SiteSource, _season: number): GameData {
  const gd = emptyGameData();

  for (const place of Object.values<any>(src.places ?? {})) {
    const recipes: any[] = place.recipes ?? [];
    if (recipes.length === 0) continue;
    const buildingId = `place-${place.id}`;
    gd.buildings[buildingId] = {
      id: buildingId, name: place.name, kind: kindOf(Number(place.id)), pipeline: 'both', slots: 1, season: 'permanent', active: true,
    };
    for (const r of recipes) {
      const secs = parseDuration(String(r.base_time));
      if (!secs.ok) throw new Error(`recipe ${r.id}: bad base_time "${r.base_time}": ${secs.error}`);
      const recipe: Recipe = {
        id: `recipe-${r.id}`, buildingId, inputs: qtys(r.cost), outputs: qtys(r.produce),
        bonus: r.extra_produce ? [{ item: String(r.extra_produce.id), qty: r.extra_produce.amount, everyRuns: r.extra_produce.every }] : [],
        maxRuns: r.production_limit, secondsPerRun: secs.value, stamina: r.stamina ?? 0, season: 'permanent', active: true,
      };
      gd.recipes[recipe.id] = recipe;
    }
  }

  const goodsProduced = new Set<string>();
  for (const r of Object.values(gd.recipes)) {
    if (gd.buildings[r.buildingId]?.kind === 'factory') for (const o of r.outputs) goodsProduced.add(o.item);
  }
  const sellable = new Set<string>();
  for (const rest of Object.values<any>(src.restaurants ?? {})) for (const id of rest.sellable ?? []) sellable.add(String(id));

  for (const it of Object.values<any>(src.items ?? {})) {
    const id = String(it.id);
    const item: Item = {
      id, name: it.name, category: it.categories?.[0] ?? 'Other',
      idp: goodsProduced.has(id) ? it.convert_points : null,
      cafeValue: sellable.has(id) ? it.order_price : null,
      season: 'permanent', active: true,
    };
    gd.items[id] = item;
  }

  for (const rest of Object.values<any>(src.restaurants ?? {})) {
    const id = `cafe-${rest.id}`;
    gd.cafes[id] = {
      id, name: rest.name, kitchenBuildingId: `place-${rest.place}`, sellable: (rest.sellable ?? []).map(String),
      ranks: (rest.ranks ?? []).map((k: any) => ({ name: k.name, dishSlots: k.dish_slots, capacityPerDish: k.dish_capacity })),
      season: 'permanent', active: true,
    };
  }

  const seeds = src.shops?.[SEEDS_SHOP];
  for (const sub of seeds?.sub_shops ?? []) {
    for (const good of sub.goods ?? []) {
      const gain = good.gains?.[0];
      if (!gain || !gain.amount) continue;
      gd.shop.push({ item: String(gain.id), price: good.cost.amount / gain.amount, currency: 'money', shop: `Seeds/${sub.name}` });
    }
  }

  const mill = src.shops?.[FLOUR_MILL_SHOP];
  if (mill) {
    const building: Building = { id: 'mill', name: mill.name ?? 'Flour Mill', kind: 'mill', pipeline: 'both', slots: 1, season: 'permanent', active: true };
    gd.buildings.mill = building;
    for (const sub of mill.sub_shops ?? []) {
      for (const good of sub.goods ?? []) {
        const id = `mill-${good.id}`;
        gd.recipes[id] = {
          id, buildingId: 'mill', inputs: qtys([good.cost]), outputs: qtys(good.gains), bonus: [],
          maxRuns: 1, secondsPerRun: 1, stamina: 0, season: 'permanent', active: true,
        };
      }
    }
  }

  for (const b of Object.values(gd.buildings)) b.pipeline = derivePipeline(gd, b.id);
  return gd;
}
