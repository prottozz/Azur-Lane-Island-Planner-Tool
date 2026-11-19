import type { Building, GameData, ItemId, Priority, Qty, Recipe, State } from '../types';
import { fillJob, idpPerHour, jobInputs, jobOutputs } from '../recipes';
import { readyJobs } from '../actions';
import { sharedItems } from '../gamedata';
import { expandDemand, type Expansion, type PlanStep } from './expand';

export interface Suggestion { buildingId: string; slot: number; recipeId: string; runs: number; reason: string; missing: Qty[] }
export interface RankedGood { recipeId: string; idpPerHour: number; feasibleRuns: number }
export interface Plan { food: Expansion; goods: Expansion; suggestions: Suggestion[]; rankedGoods: RankedGood[] }

type Side = 'food' | 'goods';
type Stock = Record<ItemId, number>;

function mergeQty(list: Qty[]): Qty[] {
  const m = new Map<ItemId, number>();
  for (const q of list) m.set(q.item, (m.get(q.item) ?? 0) + q.qty);
  return [...m].map(([item, qty]) => ({ item, qty }));
}

const qtyOf = (list: Qty[], item: ItemId) => list.reduce((n, q) => (q.item === item ? n + q.qty : n), 0);
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const itemName = (gd: GameData, item: ItemId) => gd.items[item]?.name ?? item;

/** Each plan: the first dishSlots dishes × the rank's capacityPerDish, merged by item. */
export function cafeDemand(gd: GameData, s: State): Qty[] {
  const out: Qty[] = [];
  for (const plan of s.cafePlans) {
    const cafe = gd.cafes[plan.cafeId];
    const rank = cafe?.active ? cafe.ranks[plan.rankIndex] : undefined;
    if (!rank) continue;
    for (const dish of plan.dishes.slice(0, rank.dishSlots)) out.push({ item: dish, qty: rank.capacityPerDish });
  }
  return mergeQty(out);
}

export function reservedDemand(s: State): Qty[] {
  return mergeQty(s.reservations.map(r => ({ item: r.item, qty: r.qty })));
}

/** Active factory buildings with their best active recipe by IDP/h (ties by recipe id). */
function topFactoryRecipes(gd: GameData): { building: Building; recipe: Recipe }[] {
  const out: { building: Building; recipe: Recipe }[] = [];
  for (const building of Object.values(gd.buildings)) {
    if (!building.active || building.kind !== 'factory') continue;
    const best = Object.values(gd.recipes)
      .filter(r => r.active && r.buildingId === building.id && idpPerHour(r, gd) > 0)
      .sort((a, b) => idpPerHour(b, gd) - idpPerHour(a, gd) || byId(a, b))[0];
    if (best) out.push({ building, recipe: best });
  }
  return out;
}

/** Inputs to fill every slot of each active factory with its top IDP/h recipe. */
export function goodsDemand(gd: GameData, _s: State): Qty[] {
  return mergeQty(topFactoryRecipes(gd).flatMap(({ building, recipe }) =>
    fillJob(recipe).map(q => ({ item: q.item, qty: q.qty * building.slots }))));
}

/** Stock plus outputs of every unfinished job, minus reservations, floored at 0. */
export function freeStock(s: State, gd: GameData, _now: Date): Stock {
  const free: Stock = { ...s.stock };
  const add = (item: ItemId, qty: number) => { free[item] = (free[item] ?? 0) + qty; };
  for (const job of s.jobs) {
    const recipe = gd.recipes[job.recipeId];
    if (recipe) for (const q of jobOutputs(recipe, job.runs)) add(q.item, q.qty);
  }
  for (const r of s.reservations) add(r.item, -r.qty);
  for (const item of Object.keys(free)) free[item] = Math.max(0, free[item]);
  return free;
}

/**
 * Non-shared items go in full to both sides (only one pipeline consumes them). Shared items:
 * money → food demand first; idp → goods demand first; balanced → pro-rata (goods floored).
 */
export function allocate(free: Stock, food: Qty[], goods: Qty[], priority: Priority, shared: ItemId[]):
  { food: Stock; goods: Stock } {
  const out = { food: {} as Stock, goods: {} as Stock };
  const sharedSet = new Set(shared);
  for (const [item, have] of Object.entries(free)) {
    if (!sharedSet.has(item)) { out.food[item] = have; out.goods[item] = have; continue; }
    const f = qtyOf(food, item);
    const g = qtyOf(goods, item);
    let goodsShare: number;
    if (priority === 'money') goodsShare = have - Math.min(have, f);
    else if (priority === 'idp') goodsShare = Math.min(have, g);
    else goodsShare = f + g > 0 ? Math.floor((have * g) / (f + g)) : Math.floor(have / 2);
    out.goods[item] = goodsShare;
    out.food[item] = have - goodsShare;
  }
  return out;
}

/** Gross amount of each listed item a pipeline would use: top-level demand plus inputs of its steps. */
function requirement(gd: GameData, demand: Qty[], e: Expansion, items: ItemId[]): Qty[] {
  const wanted = new Set(items);
  const all = [...demand, ...e.steps.flatMap(st => (gd.recipes[st.recipeId] ? jobInputs(gd.recipes[st.recipeId], st.runs) : []))];
  return mergeQty(all.filter(q => wanted.has(q.item)));
}

/** Per-side stock budget; spending a non-shared item spends it on both sides (same physical stock). */
class Budget {
  private readonly alloc: { food: Stock; goods: Stock };
  private readonly shared: Set<ItemId>;
  constructor(alloc: { food: Stock; goods: Stock }, shared: ItemId[]) {
    this.alloc = { food: { ...alloc.food }, goods: { ...alloc.goods } };
    this.shared = new Set(shared);
  }
  have(side: Side, item: ItemId): number { return Math.max(0, this.alloc[side][item] ?? 0); }
  affordable(side: Side, r: Recipe): number {
    let runs = r.maxRuns;
    for (const q of mergeQty(r.inputs)) if (q.qty > 0) runs = Math.min(runs, Math.floor(this.have(side, q.item) / q.qty));
    return Math.max(0, runs);
  }
  missing(side: Side, r: Recipe, runs: number): Qty[] {
    return mergeQty(jobInputs(r, runs))
      .map(q => ({ item: q.item, qty: q.qty - this.have(side, q.item) }))
      .filter(q => q.qty > 0);
  }
  spend(side: Side, r: Recipe, runs: number) {
    const sides: Side[] = ['food', 'goods'];
    for (const q of mergeQty(jobInputs(r, runs))) {
      for (const sd of this.shared.has(q.item) ? [side] : sides) this.alloc[sd][q.item] = Math.max(0, this.have(sd, q.item) - q.qty);
    }
  }
}

interface Ctx {
  gd: GameData; free: Stock; foodDemand: Qty[]; goodsDemandList: Qty[];
  topRecipes: Recipe[]; expansions: Record<Side, Expansion>; remaining: Map<PlanStep, number>; budget: Budget;
}

/** Idle slot indices: no job on the slot, or every job on it is ready. */
function idleSlots(s: State, b: Building, now: Date): number[] {
  const ready = new Set(readyJobs(s, now).map(j => j.id));
  const out: number[] = [];
  for (let slot = 0; slot < b.slots; slot++) {
    if (s.jobs.every(j => j.buildingId !== b.id || j.slot !== slot || ready.has(j.id))) out.push(slot);
  }
  return out;
}

const servesSide = (b: Building, side: Side) => b.pipeline === side || b.pipeline === 'both';
type IdleSlots = Map<string, number[]>;

/** The side's step with the most remaining runs (ties by recipe id) whose building serves the side and has an idle slot. */
function nextStep(ctx: Ctx, side: Side, idle: IdleSlots): PlanStep | null {
  let best: PlanStep | null = null;
  for (const st of ctx.expansions[side].steps) {
    const left = ctx.remaining.get(st) ?? 0;
    const recipe = ctx.gd.recipes[st.recipeId];
    const b = recipe && ctx.gd.buildings[recipe.buildingId];
    if (left <= 0 || !b || recipe.maxRuns < 1 || !servesSide(b, side) || !idle.get(b.id)?.length) continue;
    const bestLeft = best ? ctx.remaining.get(best)! : 0;
    if (!best || left > bestLeft || (left === bestLeft && st.recipeId < best.recipeId)) best = st;
  }
  return best;
}

/** Name of what consumes `item` in this pipeline: first output of the consuming recipe, else its building. */
function consumerName(ctx: Ctx, side: Side, item: ItemId): string {
  const { gd } = ctx;
  const stepRecipes = ctx.expansions[side].steps.map(st => gd.recipes[st.recipeId]).filter((r): r is Recipe => !!r);
  const pool = side === 'goods' && qtyOf(ctx.goodsDemandList, item) > 0 ? [...stepRecipes, ...ctx.topRecipes] : stepRecipes;
  const consumer = pool.find(r => r.inputs.some(q => q.item === item));
  if (!consumer) return side === 'food' ? 'café' : 'factories';
  const out = consumer.outputs[0];
  return (out && gd.items[out.item]?.name) || gd.buildings[consumer.buildingId]?.name || (side === 'food' ? 'café' : 'factories');
}

function stepReason(ctx: Ctx, side: Side, st: PlanStep): string {
  const cafeQty = side === 'food' ? qtyOf(ctx.foodDemand, st.forItem) : 0;
  const name = itemName(ctx.gd, st.forItem);
  if (cafeQty > 0) return `Café needs ${cafeQty} ${name}; you have ${ctx.free[st.forItem] ?? 0}`;
  return `Feeds ${name} for ${consumerName(ctx, side, st.forItem)}`;
}

function suggestFromStep(ctx: Ctx, side: Side, b: Building, slot: number, st: PlanStep): Suggestion {
  const recipe = ctx.gd.recipes[st.recipeId];
  const needed = Math.min(ctx.remaining.get(st)!, recipe.maxRuns);
  const affordable = ctx.budget.affordable(side, recipe);
  const runs = affordable > 0 ? Math.min(needed, affordable) : needed;
  const missing = affordable > 0 ? [] : ctx.budget.missing(side, recipe, runs);
  ctx.budget.spend(side, recipe, runs);
  ctx.remaining.set(st, ctx.remaining.get(st)! - runs);
  return { buildingId: b.id, slot, recipeId: recipe.id, runs, reason: stepReason(ctx, side, st), missing };
}

function suggestBestGoods(ctx: Ctx, ranked: RankedGood[], b: Building, slot: number): Suggestion | null {
  for (const g of ranked) {
    const recipe = ctx.gd.recipes[g.recipeId];
    if (recipe.buildingId !== b.id) continue;
    const runs = ctx.budget.affordable('goods', recipe);
    if (runs <= 0) continue;
    ctx.budget.spend('goods', recipe, runs);
    const x = Math.round(g.idpPerHour * 10) / 10;
    return { buildingId: b.id, slot, recipeId: recipe.id, runs, reason: `Best IDP/h you can make now (${x}/h)`, missing: [] };
  }
  return null;
}

function rankGoods(gd: GameData, budget: Budget): RankedGood[] {
  return Object.values(gd.recipes)
    .filter(r => r.active && gd.buildings[r.buildingId]?.active && gd.buildings[r.buildingId]?.kind === 'factory')
    .map(r => ({ recipe: r, idp: idpPerHour(r, gd) }))
    .filter(x => x.idp > 0)
    .sort((a, b) => b.idp - a.idp || byId(a.recipe, b.recipe))
    .map(x => ({ recipeId: x.recipe.id, idpPerHour: x.idp, feasibleRuns: budget.affordable('goods', x.recipe) }));
}

/**
 * Global passes over needed steps, ordered by priority: money → all food steps then goods; idp → the reverse;
 * balanced → one food assignment, one goods assignment, and so on. Each assignment takes the first idle slot
 * of the step's building (removed from `idle`).
 */
function assignNeededSteps(ctx: Ctx, idle: IdleSlots, priority: Priority): Suggestion[] {
  const out: Suggestion[] = [];
  const assign = (side: Side): boolean => {
    const st = nextStep(ctx, side, idle);
    if (!st) return false;
    const b = ctx.gd.buildings[ctx.gd.recipes[st.recipeId].buildingId];
    out.push(suggestFromStep(ctx, side, b, idle.get(b.id)!.shift()!, st));
    return true;
  };
  const order: Side[] = priority === 'idp' ? ['goods', 'food'] : ['food', 'goods'];
  if (priority === 'balanced') {
    for (let progressed = true; progressed;) progressed = order.map(assign).some(Boolean);
  } else {
    for (const side of order) while (assign(side));
  }
  return out;
}

/** Idle factory slots left after the needed steps get the best feasible IDP/h recipe. */
function fillIdleFactories(ctx: Ctx, idle: IdleSlots, ranked: RankedGood[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const b of Object.values(ctx.gd.buildings)) {
    if (!b.active || b.kind !== 'factory') continue;
    for (const slot of idle.get(b.id) ?? []) {
      const best = suggestBestGoods(ctx, ranked, b, slot);
      if (best) out.push(best);
    }
  }
  return out;
}

export function buildPlan(gd: GameData, s: State, now: Date): Plan {
  const priority = s.settings.priority;
  const free = freeStock(s, gd, now);
  const foodDemand = cafeDemand(gd, s);
  const goodsDemandList = goodsDemand(gd, s);
  const shared = sharedItems(gd);

  // Requirement pass: how much of each shared item each pipeline would use, then split and expand for real.
  const foodReq = requirement(gd, foodDemand, expandDemand(gd, foodDemand, free), shared);
  const goodsReq = requirement(gd, goodsDemandList, expandDemand(gd, goodsDemandList, free), shared);
  const alloc = allocate(free, foodReq, goodsReq, priority, shared);
  const expansions = { food: expandDemand(gd, foodDemand, alloc.food), goods: expandDemand(gd, goodsDemandList, alloc.goods) };

  const budget = new Budget(alloc, shared);
  const rankedGoods = rankGoods(gd, budget);
  const remaining = new Map<PlanStep, number>([...expansions.food.steps, ...expansions.goods.steps].map(st => [st, st.runs]));
  const ctx: Ctx = {
    gd, free, foodDemand, goodsDemandList, topRecipes: topFactoryRecipes(gd).map(t => t.recipe),
    expansions, remaining, budget,
  };

  const idle: IdleSlots = new Map(Object.values(gd.buildings).filter(b => b.active).map(b => [b.id, idleSlots(s, b, now)]));
  const suggestions = [...assignNeededSteps(ctx, idle, priority), ...fillIdleFactories(ctx, idle, rankedGoods)];
  const buildingOrder = Object.keys(gd.buildings);
  suggestions.sort((a, b) => buildingOrder.indexOf(a.buildingId) - buildingOrder.indexOf(b.buildingId) || a.slot - b.slot);
  return { food: expansions.food, goods: expansions.goods, suggestions, rankedGoods };
}
