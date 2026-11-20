import type { Building, GameData, ItemId, Priority, Qty, Recipe, State } from '../types';
import { fillJob, idpPerHour, jobInputs, jobOutputs } from '../recipes';
import { readyJobs } from '../actions';
import { sharedItems } from '../gamedata';
import { expandDemand, pickProducer, type Expansion, type PlanStep } from './expand';

/** Inputs that running jobs will deliver; `readyAt` is the latest end time among the jobs that cover `qty`. */
export interface WaitingFor { item: ItemId; qty: number; readyAt: string }
/**
 * `missing` and `waitingFor` are measured against on-hand stock (minus reservations): Start works only when both are empty.
 * `missing` is what neither stock nor running jobs cover; `waitingFor` (omitted when empty) is what running jobs will cover.
 */
export interface Suggestion {
  buildingId: string; slot: number; recipeId: string; runs: number; reason: string; missing: Qty[]; waitingFor?: WaitingFor[];
}
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

/**
 * Each plan: the first dishSlots dishes × the rank's capacityPerDish, merged by item.
 * An out-of-range rankIndex falls back to the first rank (as the café panel shows it); a café with no ranks is skipped.
 */
export function cafeDemand(gd: GameData, s: State): Qty[] {
  const out: Qty[] = [];
  for (const plan of s.cafePlans) {
    const cafe = gd.cafes[plan.cafeId];
    const rank = cafe?.active ? (cafe.ranks[plan.rankIndex] ?? cafe.ranks[0]) : undefined;
    if (!rank) continue;
    for (const dish of plan.dishes.slice(0, rank.dishSlots)) out.push({ item: dish, qty: rank.capacityPerDish });
  }
  return mergeQty(out);
}

export function reservedDemand(s: State): Qty[] {
  return mergeQty(s.reservations.map(r => ({ item: r.item, qty: r.qty })));
}

/**
 * Pipeline that plans a reserved item: the stored pipeline of its producer's building (food → food, goods → goods,
 * both → food unless priority is idp). Items with no producer go to food (they surface as purchases or unobtainable).
 */
function reservationSide(gd: GameData, item: ItemId, priority: Priority): Side {
  const producer = pickProducer(gd, item);
  const pipeline = producer ? gd.buildings[producer.recipe.buildingId]?.pipeline : undefined;
  if (pipeline === 'goods' || (pipeline === 'both' && priority === 'idp')) return 'goods';
  return 'food';
}

/** Supply of each item: stock plus outputs of every unfinished job. */
function supply(s: State, gd: GameData): Stock {
  const out: Stock = { ...s.stock };
  for (const job of s.jobs) {
    const recipe = gd.recipes[job.recipeId];
    if (recipe) for (const q of jobOutputs(recipe, job.runs)) out[q.item] = (out[q.item] ?? 0) + q.qty;
  }
  return out;
}

/** Reserved quantities that stock plus running jobs do not cover, split by the pipeline that should produce them. */
export function reservationDemand(gd: GameData, s: State): Record<Side, Qty[]> {
  const have = supply(s, gd);
  const out: Record<Side, Qty[]> = { food: [], goods: [] };
  for (const q of reservedDemand(s)) {
    const short = q.qty - Math.max(0, have[q.item] ?? 0);
    if (short > 0) out[reservationSide(gd, q.item, s.settings.priority)].push({ item: q.item, qty: short });
  }
  return out;
}

/** "Reserved for quest: 5 Linen" per reserved item (sources joined with "/" when mixed). */
function reservationReasons(gd: GameData, s: State): Map<ItemId, string> {
  const by = new Map<ItemId, { qty: number; sources: Set<string> }>();
  for (const r of s.reservations) {
    const cur = by.get(r.item) ?? { qty: 0, sources: new Set<string>() };
    cur.qty += r.qty;
    cur.sources.add(r.source);
    by.set(r.item, cur);
  }
  return new Map([...by].map(([item, v]) => [item, `Reserved for ${[...v.sources].sort().join('/')}: ${v.qty} ${itemName(gd, item)}`]));
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

function minusReservations(s: State, base: Stock): Stock {
  const free: Stock = { ...base };
  for (const r of s.reservations) free[r.item] = (free[r.item] ?? 0) - r.qty;
  for (const item of Object.keys(free)) free[item] = Math.max(0, free[item]);
  return free;
}

/** Stock plus outputs of every unfinished job, minus reservations, floored at 0. */
export function freeStock(s: State, gd: GameData, _now: Date): Stock {
  return minusReservations(s, supply(s, gd));
}

/** On-hand stock minus reservations, floored at 0: what a job could actually be started with right now. */
export function onHandStock(s: State): Stock {
  return minusReservations(s, s.stock);
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
  spend(side: Side, r: Recipe, runs: number) {
    const sides: Side[] = ['food', 'goods'];
    for (const q of mergeQty(jobInputs(r, runs))) {
      for (const sd of this.shared.has(q.item) ? [side] : sides) this.alloc[sd][q.item] = Math.max(0, this.have(sd, q.item) - q.qty);
    }
  }
}

interface Ctx {
  gd: GameData; free: Stock; cafeDemandList: Qty[]; goodsDemandList: Qty[];
  reserved: Record<Side, Qty[]>; reservedReasons: Map<ItemId, string>;
  topRecipes: Recipe[]; expansions: Record<Side, Expansion>; remaining: Map<PlanStep, number>;
  /** Planning budget: stock + running-job outputs. */
  budget: Budget;
  /** On-hand budget: stock only; decides `missing` / `waitingFor`. */
  onHand: Budget;
  /** Running-job outputs per item, earliest end first, and how much of them suggestions already counted on. */
  pending: Map<ItemId, { qty: number; endsAt: string }[]>;
  pendingUsed: Map<ItemId, number>;
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
  const cafeQty = side === 'food' ? qtyOf(ctx.cafeDemandList, st.forItem) : 0;
  const name = itemName(ctx.gd, st.forItem);
  if (cafeQty > 0) return `Café needs ${cafeQty} ${name}; you have ${ctx.free[st.forItem] ?? 0}`;
  if (qtyOf(ctx.reserved[side], st.forItem) > 0) return ctx.reservedReasons.get(st.forItem) ?? `Reserved: ${name}`;
  return `Feeds ${name} for ${consumerName(ctx, side, st.forItem)}`;
}

/** End time of the running job that brings the item's counted-on pending output up to `qty` more. */
function pendingReadyAt(ctx: Ctx, item: ItemId, qty: number): string {
  const jobs = ctx.pending.get(item) ?? [];
  const target = (ctx.pendingUsed.get(item) ?? 0) + qty;
  ctx.pendingUsed.set(item, target);
  let cum = 0;
  for (const j of jobs) {
    cum += j.qty;
    if (cum >= target) return j.endsAt;
  }
  return jobs[jobs.length - 1].endsAt;
}

/**
 * Splits the job's input shortfall against on-hand stock into what running jobs will deliver (`waitingFor`)
 * and what nothing covers (`missing`). Call before spending.
 */
function shortfallNow(ctx: Ctx, side: Side, r: Recipe, runs: number): Pick<Suggestion, 'missing' | 'waitingFor'> {
  const missing: Qty[] = [];
  const waitingFor: WaitingFor[] = [];
  for (const q of mergeQty(jobInputs(r, runs))) {
    const onHand = ctx.onHand.have(side, q.item);
    const short = q.qty - onHand;
    if (short <= 0) continue;
    const pending = ctx.pending.has(q.item) ? Math.max(0, ctx.budget.have(side, q.item) - onHand) : 0;
    const wait = Math.min(short, pending);
    if (wait > 0) waitingFor.push({ item: q.item, qty: wait, readyAt: pendingReadyAt(ctx, q.item, wait) });
    if (short > wait) missing.push({ item: q.item, qty: short - wait });
  }
  return waitingFor.length > 0 ? { missing, waitingFor } : { missing };
}

function spendBoth(ctx: Ctx, side: Side, r: Recipe, runs: number) {
  ctx.budget.spend(side, r, runs);
  ctx.onHand.spend(side, r, runs);
}

function suggestFromStep(ctx: Ctx, side: Side, b: Building, slot: number, st: PlanStep): Suggestion {
  const recipe = ctx.gd.recipes[st.recipeId];
  const needed = Math.min(ctx.remaining.get(st)!, recipe.maxRuns);
  const affordable = ctx.budget.affordable(side, recipe);
  const runs = affordable > 0 ? Math.min(needed, affordable) : needed;
  const short = shortfallNow(ctx, side, recipe, runs);
  spendBoth(ctx, side, recipe, runs);
  ctx.remaining.set(st, ctx.remaining.get(st)! - runs);
  return { buildingId: b.id, slot, recipeId: recipe.id, runs, reason: stepReason(ctx, side, st), ...short };
}

function suggestBestGoods(ctx: Ctx, ranked: RankedGood[], b: Building, slot: number): Suggestion | null {
  for (const g of ranked) {
    const recipe = ctx.gd.recipes[g.recipeId];
    if (recipe.buildingId !== b.id) continue;
    const runs = ctx.budget.affordable('goods', recipe);
    if (runs <= 0) continue;
    const short = shortfallNow(ctx, 'goods', recipe, runs);
    spendBoth(ctx, 'goods', recipe, runs);
    const x = Math.round(g.idpPerHour * 10) / 10;
    return { buildingId: b.id, slot, recipeId: recipe.id, runs, reason: `Best IDP/h you can make now (${x}/h)`, ...short };
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

/**
 * Running-job outputs per item (earliest end first). Reservations beyond on-hand stock are counted against
 * those outputs first, so `pendingUsed` starts there.
 */
function pendingOutputs(s: State, gd: GameData) {
  const pending = new Map<ItemId, { qty: number; endsAt: string }[]>();
  const jobs = [...s.jobs].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  for (const job of jobs) {
    const recipe = gd.recipes[job.recipeId];
    if (!recipe) continue;
    for (const q of jobOutputs(recipe, job.runs)) pending.set(q.item, [...(pending.get(q.item) ?? []), { qty: q.qty, endsAt: job.endsAt }]);
  }
  const pendingUsed = new Map<ItemId, number>();
  for (const q of reservedDemand(s)) {
    const over = q.qty - Math.max(0, s.stock[q.item] ?? 0);
    if (over > 0 && pending.has(q.item)) pendingUsed.set(q.item, over);
  }
  return { pending, pendingUsed };
}

export function buildPlan(gd: GameData, s: State, now: Date): Plan {
  const priority = s.settings.priority;
  const free = freeStock(s, gd, now);
  const cafeDemandList = cafeDemand(gd, s);
  const reserved = reservationDemand(gd, s);
  const foodDemand = mergeQty([...cafeDemandList, ...reserved.food]);
  const goodsDemandList = mergeQty([...goodsDemand(gd, s), ...reserved.goods]);
  const shared = sharedItems(gd);

  // Requirement pass: how much of each shared item each pipeline would use, then split and expand for real.
  const foodReq = requirement(gd, foodDemand, expandDemand(gd, foodDemand, free), shared);
  const goodsReq = requirement(gd, goodsDemandList, expandDemand(gd, goodsDemandList, free), shared);
  const alloc = allocate(free, foodReq, goodsReq, priority, shared);
  const expansions = { food: expandDemand(gd, foodDemand, alloc.food), goods: expandDemand(gd, goodsDemandList, alloc.goods) };

  const budget = new Budget(alloc, shared);
  const onHand = new Budget(allocate(onHandStock(s), foodReq, goodsReq, priority, shared), shared);
  const rankedGoods = rankGoods(gd, budget);
  const remaining = new Map<PlanStep, number>([...expansions.food.steps, ...expansions.goods.steps].map(st => [st, st.runs]));
  const { pending, pendingUsed } = pendingOutputs(s, gd);
  const ctx: Ctx = {
    gd, free, cafeDemandList, goodsDemandList, reserved, reservedReasons: reservationReasons(gd, s),
    topRecipes: topFactoryRecipes(gd).map(t => t.recipe), expansions, remaining, budget, onHand, pending, pendingUsed,
  };

  const idle: IdleSlots = new Map(Object.values(gd.buildings).filter(b => b.active).map(b => [b.id, idleSlots(s, b, now)]));
  const suggestions = [...assignNeededSteps(ctx, idle, priority), ...fillIdleFactories(ctx, idle, rankedGoods)];
  const buildingOrder = Object.keys(gd.buildings);
  suggestions.sort((a, b) => buildingOrder.indexOf(a.buildingId) - buildingOrder.indexOf(b.buildingId) || a.slot - b.slot);
  return { food: expansions.food, goods: expansions.goods, suggestions, rankedGoods };
}
