import type { CafeRun, GameData, ItemId, Job, Qty, Result, State } from './types';
import { newId } from './ids';
import { jobInputs, jobOutputs, jobSeconds } from './recipes';
import { lastResetAt, lastWeeklyResetAt, localDay } from './time';

const err = (error: string, missing?: Qty[]): { ok: false; error: string; missing?: Qty[] } =>
  missing ? { ok: false, error, missing } : { ok: false, error };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const isNonNegInt = (n: number) => Number.isInteger(n) && n >= 0;
/** Game day: the local day of the most recent daily reset. */
const gameDay = (s: State, now: Date) => localDay(lastResetAt(now, s.settings.resetTime));
const SPAWN_DELAY_MS = 3 * 3600 * 1000;

function mergeQty(list: Qty[]): Qty[] {
  const m = new Map<ItemId, number>();
  for (const q of list) m.set(q.item, (m.get(q.item) ?? 0) + q.qty);
  return [...m].map(([item, qty]) => ({ item, qty }));
}

/** Shortfall per item (needed - have), merged by item; empty when stock covers it. */
function shortfall(stock: State['stock'], needs: Qty[]): Qty[] {
  return mergeQty(needs)
    .map(q => ({ item: q.item, qty: q.qty - (stock[q.item] ?? 0) }))
    .filter(q => q.qty > 0);
}

function withStock(stock: State['stock'], add: Qty[], sign: 1 | -1 = 1): State['stock'] {
  const next = { ...stock };
  for (const q of add) next[q.item] = (next[q.item] ?? 0) + sign * q.qty;
  return next;
}

const validQtys = (list: Qty[]) => list.every(q => isNonNegInt(q.qty));

export function startJob(
  s: State, gd: GameData,
  a: { buildingId: string; slot: number; recipeId: string; runs: number; durationSec?: number; now: Date },
): Result<State> {
  const building = gd.buildings[a.buildingId];
  if (!building) return err(`Unknown building "${a.buildingId}"`);
  const recipe = gd.recipes[a.recipeId];
  if (!recipe) return err(`Unknown recipe "${a.recipeId}"`);
  if (recipe.buildingId !== building.id) return err(`Recipe "${recipe.id}" is not made in ${building.name}`);
  if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= building.slots) {
    return err(`${building.name} has ${building.slots} slot(s); slot ${a.slot} does not exist`);
  }
  if (s.jobs.some(j => j.buildingId === building.id && j.slot === a.slot)) {
    return err(`Slot ${a.slot} in ${building.name} is already running a job`);
  }
  if (!Number.isInteger(a.runs) || a.runs < 1 || a.runs > recipe.maxRuns) {
    return err(`Runs must be a whole number from 1 to ${recipe.maxRuns}`);
  }
  if (a.durationSec !== undefined && (!Number.isInteger(a.durationSec) || a.durationSec <= 0)) {
    return err('Duration must be a positive whole number of seconds');
  }
  const inputs = jobInputs(recipe, a.runs);
  const missing = shortfall(s.stock, inputs);
  if (missing.length) return err('Not enough stock to start this job', missing);

  const seconds = a.durationSec ?? jobSeconds(recipe, a.runs);
  const job: Job = {
    id: newId(), buildingId: building.id, slot: a.slot, recipeId: recipe.id, runs: a.runs,
    startedAt: a.now.toISOString(), endsAt: new Date(a.now.getTime() + seconds * 1000).toISOString(),
  };
  return ok({ ...s, stock: withStock(s.stock, inputs, -1), jobs: [...s.jobs, job] });
}

export function finishJob(s: State, gd: GameData, jobId: string): Result<State> {
  const job = s.jobs.find(j => j.id === jobId);
  if (!job) return err('Job not found');
  const recipe = gd.recipes[job.recipeId];
  if (!recipe) return err(`Unknown recipe "${job.recipeId}"`);
  return ok({ ...s, stock: withStock(s.stock, jobOutputs(recipe, job.runs)), jobs: s.jobs.filter(j => j.id !== jobId) });
}

/** Removes the job and refunds its inputs; a job whose recipe no longer exists is removed without a refund. */
export function cancelJob(s: State, gd: GameData, jobId: string): Result<State> {
  const job = s.jobs.find(j => j.id === jobId);
  if (!job) return err('Job not found');
  const recipe = gd.recipes[job.recipeId];
  const jobs = s.jobs.filter(j => j.id !== jobId);
  if (!recipe) return ok({ ...s, jobs });
  return ok({ ...s, stock: withStock(s.stock, jobInputs(recipe, job.runs)), jobs });
}

export function readyJobs(s: State, now: Date): Job[] {
  return s.jobs.filter(j => Date.parse(j.endsAt) <= now.getTime());
}

export function setStock(s: State, item: ItemId, qty: number): Result<State> {
  if (!isNonNegInt(qty)) return err('Stock must be a whole number, zero or more');
  return ok({ ...s, stock: { ...s.stock, [item]: qty } });
}

export function addStock(s: State, items: Qty[]): State {
  return { ...s, stock: withStock(s.stock, items) };
}

export function startCafeRun(s: State, gd: GameData, a: { cafeId: string; dishes: Qty[]; now: Date }): Result<State> {
  const cafe = gd.cafes[a.cafeId];
  if (!cafe) return err(`Unknown café "${a.cafeId}"`);
  if (!validQtys(a.dishes)) return err('Dish quantities must be whole numbers, zero or more');
  const date = gameDay(s, a.now);
  if (s.cafeRuns.some(r => r.cafeId === cafe.id && r.date === date)) {
    return err(`${cafe.name} already has a run for ${date}`);
  }
  const missing = shortfall(s.stock, a.dishes);
  if (missing.length) return err('Not enough dishes in stock', missing);
  const run: CafeRun = {
    id: newId(), date, cafeId: cafe.id, dishes: mergeQty(a.dishes), status: 'running',
    startedAt: a.now.toISOString(), leftovers: [], income: null,
  };
  return ok({ ...s, stock: withStock(s.stock, a.dishes, -1), cafeRuns: [...s.cafeRuns, run] });
}

export function finishCafeRun(
  s: State, gd: GameData, a: { runId: string; leftovers: Qty[]; income: number | null },
): Result<State> {
  const run = s.cafeRuns.find(r => r.id === a.runId);
  if (!run) return err('Café run not found');
  if (run.status !== 'running') return err('Café run is already finished');
  if (!validQtys(a.leftovers)) return err('Leftover quantities must be whole numbers, zero or more');
  const sent = new Map(run.dishes.map(d => [d.item, d.qty]));
  for (const q of mergeQty(a.leftovers)) {
    const max = sent.get(q.item) ?? 0;
    if (q.qty > max) return err(`Leftover ${gd.items[q.item]?.name ?? q.item} (${q.qty}) is more than the ${max} sent in this run`);
  }
  if (a.income !== null && (!Number.isFinite(a.income) || a.income < 0)) return err('Income must be zero or more');
  const money = a.income !== null && s.settings.money !== null ? s.settings.money + a.income : s.settings.money;
  const done: CafeRun = { ...run, status: 'done', leftovers: mergeQty(a.leftovers), income: a.income };
  return ok({
    ...s,
    stock: withStock(s.stock, a.leftovers),
    cafeRuns: s.cafeRuns.map(r => (r.id === run.id ? done : r)),
    settings: { ...s.settings, money },
  });
}

export function convertToIdp(s: State, gd: GameData, items: Qty[]): Result<State> {
  if (!validQtys(items)) return err('Quantities must be whole numbers, zero or more');
  let earned = 0;
  for (const q of items) {
    const idp = gd.items[q.item]?.idp ?? null;
    if (idp === null) return err(`${gd.items[q.item]?.name ?? q.item} has no IDP value and cannot be converted`);
    earned += q.qty * idp;
  }
  const missing = shortfall(s.stock, items);
  if (missing.length) return err('Not enough stock to convert', missing);
  return ok({ ...s, stock: withStock(s.stock, items, -1), idp: { ...s.idp, earned: s.idp.earned + earned } });
}

export function spawnsAvailable(s: State, gd: GameData, now: Date): boolean {
  if (s.spawnsCollectedOn === gameDay(s, now)) return false;
  if (now.getTime() < lastResetAt(now, s.settings.resetTime).getTime() + SPAWN_DELAY_MS) return false;
  return Object.values(gd.spawns).some(sp => sp.active);
}

export function collectSpawns(s: State, _gd: GameData, quantities: Qty[], now: Date): State {
  return { ...addStock(s, quantities), spawnsCollectedOn: gameDay(s, now) };
}

export function applyResets(s: State, now: Date): State {
  const daily = localDay(lastResetAt(now, s.settings.resetTime));
  const weekly = localDay(lastWeeklyResetAt(now, s.settings.resetTime, s.settings.weeklyResetDay));
  const r = s.requests;
  if (r.lastDailyReset === daily && r.lastWeeklyReset === weekly) return s;
  return {
    ...s,
    requests: {
      ...r,
      dailyDone: r.lastDailyReset === daily ? r.dailyDone : 0,
      weeklyDone: r.lastWeeklyReset === weekly ? r.weeklyDone : 0,
      lastDailyReset: daily,
      lastWeeklyReset: weekly,
    },
  };
}

/** A request counts toward both the daily and weekly tallies. */
export function bumpRequests(s: State, delta: 1 | -1): State {
  const r = s.requests;
  const clamp = (n: number, cap: number) => Math.min(Math.max(n, 0), cap);
  return {
    ...s,
    requests: { ...r, dailyDone: clamp(r.dailyDone + delta, r.dailyCap), weeklyDone: clamp(r.weeklyDone + delta, r.weeklyCap) },
  };
}
