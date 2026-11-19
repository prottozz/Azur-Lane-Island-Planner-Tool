import { describe, it, expect } from 'vitest';
import {
  startJob, finishJob, cancelJob, readyJobs, setStock, addStock, startCafeRun, finishCafeRun,
  convertToIdp, spawnsAvailable, collectSpawns, applyResets, bumpRequests,
} from '../../src/shared/actions';
import { emptyState } from '../../src/shared/defaults';
import { lastResetAt, localDay } from '../../src/shared/time';
import type { GameData, Item, Recipe, State } from '../../src/shared/types';

const item = (id: string, idp: number | null = null, cafeValue: number | null = null): Item =>
  ({ id, name: id, category: 'x', idp, cafeValue, season: 'permanent', active: true });
const wheat: Recipe = { id: 'wheat', buildingId: 'place-101', inputs: [{ item: '1000', qty: 9 }], outputs: [{ item: '2000', qty: 162 }],
  bonus: [], maxRuns: 12, secondsPerRun: 2400, stamina: 0, season: 'permanent', active: true };
const gd: GameData = {
  version: 1,
  items: { '1000': item('1000'), '2000': item('2000'), '3011': item('3011'), clock: item('clock', 310), tofu: item('tofu') },
  buildings: { 'place-101': { id: 'place-101', name: 'Field', kind: 'field', pipeline: 'food', slots: 2, season: 'permanent', active: true } },
  recipes: { wheat },
  cafes: { cafe1: { id: 'cafe1', name: 'Cafe', kitchenBuildingId: 'k', sellable: ['3011'], ranks: [], season: 'permanent', active: true } },
  shop: [],
  spawns: { sp1: { id: 'sp1', item: '2000', qtyPerDay: 5, season: 'permanent', active: true } },
};
const now = new Date(2026, 10, 19, 12, 0, 0);
const base = (): State => ({ ...emptyState(now), stock: { '1000': 100 } });
const start = (s: State, over: Record<string, unknown> = {}) =>
  startJob(s, gd, { buildingId: 'place-101', slot: 0, recipeId: 'wheat', runs: 11, now, ...over } as never);
const must = <T>(r: { ok: boolean; value?: T }): T => { expect(r.ok).toBe(true); return (r as { value: T }).value; };

describe('jobs', () => {
  it('fails with a shortfall list and leaves state unchanged', () => {
    const s = base(); const snap = structuredClone(s);
    const r = start(s, { runs: 12 });
    expect(r).toMatchObject({ ok: false, missing: [{ item: '1000', qty: 8 }] });
    expect(s).toEqual(snap);
  });
  it('starts a job, deducting inputs and computing endsAt', () => {
    const s = base(); const snap = structuredClone(s);
    const n = must(start(s));
    expect(n.stock['1000']).toBe(1);
    expect(n.jobs).toHaveLength(1);
    expect((Date.parse(n.jobs[0].endsAt) - Date.parse(n.jobs[0].startedAt)) / 1000).toBe(26400);
    expect(s).toEqual(snap);
  });
  it('honours durationSec', () => {
    const n = must(start(base(), { durationSec: 8100 }));
    expect(Date.parse(n.jobs[0].endsAt)).toBe(now.getTime() + 8100_000);
  });
  it('rejects bad runs and durations', () => {
    for (const runs of [0, 13, 1.5, NaN]) expect(start(base(), { runs }).ok).toBe(false);
    for (const durationSec of [0, -5, 1.5, NaN]) expect(start(base(), { durationSec }).ok).toBe(false);
  });
  it('rejects an occupied slot, out-of-range slot, unknown building/recipe, and wrong-building recipe', () => {
    const n = must(start(base(), { runs: 1 }));
    expect(start(n, { runs: 1 }).ok).toBe(false);
    expect(start(n, { slot: 1, runs: 1 }).ok).toBe(true);
    expect(start(base(), { slot: 2 }).ok).toBe(false);
    expect(start(base(), { slot: -1 }).ok).toBe(false);
    expect(start(base(), { buildingId: 'nope' }).ok).toBe(false);
    expect(start(base(), { recipeId: 'nope' }).ok).toBe(false);
  });
  it('finishes a job, adding outputs and removing it', () => {
    const n = must(start(base())); const snap = structuredClone(n);
    const f = must(finishJob(n, gd, n.jobs[0].id));
    expect(f.stock['2000']).toBe(1782);
    expect(f.jobs).toEqual([]);
    expect(n).toEqual(snap);
    expect(finishJob(n, gd, 'missing').ok).toBe(false);
  });
  it('cancels a job, refunding inputs', () => {
    const n = must(start(base()));
    const c = must(cancelJob(n, gd, n.jobs[0].id));
    expect(c.stock['1000']).toBe(100);
    expect(c.jobs).toEqual([]);
    expect(cancelJob(n, gd, 'missing').ok).toBe(false);
  });
  it('readyJobs returns jobs whose endsAt has passed', () => {
    const n = must(start(base(), { runs: 1 }));
    expect(readyJobs(n, now)).toEqual([]);
    expect(readyJobs(n, new Date(now.getTime() + 2400_000))).toHaveLength(1);
  });
});

describe('stock', () => {
  it('setStock rejects negative and non-integer, accepts valid', () => {
    const s = base(); const snap = structuredClone(s);
    expect(setStock(s, '1000', -1).ok).toBe(false);
    expect(setStock(s, '1000', 2.5).ok).toBe(false);
    expect(setStock(s, '1000', NaN).ok).toBe(false);
    expect(must(setStock(s, '1000', 7)).stock['1000']).toBe(7);
    expect(s).toEqual(snap);
  });
  it('addStock adds without mutating', () => {
    const s = base();
    const n = addStock(s, [{ item: '1000', qty: 5 }, { item: '2000', qty: 2 }]);
    expect(n.stock).toEqual({ '1000': 105, '2000': 2 });
    expect(s.stock).toEqual({ '1000': 100 });
  });
});

describe('cafe runs', () => {
  const s0 = (): State => ({ ...base(), stock: { '3011': 10 } });
  const run = (s: State, over = {}) => startCafeRun(s, gd, { cafeId: 'cafe1', dishes: [{ item: '3011', qty: 8 }], now, ...over });
  it('deducts dishes and blocks a second run the same day', () => {
    const s = s0(); const snap = structuredClone(s);
    const n = must(run(s));
    expect(n.stock['3011']).toBe(2);
    expect(n.cafeRuns[0]).toMatchObject({ cafeId: 'cafe1', date: localDay(now), status: 'running' });
    expect(run(n, { dishes: [{ item: '3011', qty: 1 }] }).ok).toBe(false);
    expect(s).toEqual(snap);
  });
  it('allows a run on another day', () => {
    const n = must(run(s0(), { dishes: [{ item: '3011', qty: 1 }] }));
    expect(run(n, { dishes: [{ item: '3011', qty: 1 }], now: new Date(2026, 10, 20, 9) }).ok).toBe(true);
  });
  it('reports missing dishes', () => {
    expect(run(s0(), { dishes: [{ item: '3011', qty: 12 }] })).toMatchObject({ ok: false, missing: [{ item: '3011', qty: 2 }] });
  });
  it('finish returns leftovers and adds income when money is tracked', () => {
    const n = must(run({ ...s0(), settings: { ...s0().settings, money: 100 } }));
    const snap = structuredClone(n);
    const f = must(finishCafeRun(n, gd, { runId: n.cafeRuns[0].id, leftovers: [{ item: '3011', qty: 2 }], income: 50 }));
    expect(f.stock['3011']).toBe(4);
    expect(f.settings.money).toBe(150);
    expect(f.cafeRuns[0]).toMatchObject({ status: 'done', income: 50, leftovers: [{ item: '3011', qty: 2 }] });
    expect(n).toEqual(snap);
    expect(finishCafeRun(f, gd, { runId: n.cafeRuns[0].id, leftovers: [], income: null }).ok).toBe(false);
  });
  it('finish leaves money null when untracked', () => {
    const n = must(run(s0()));
    const f = must(finishCafeRun(n, gd, { runId: n.cafeRuns[0].id, leftovers: [], income: 50 }));
    expect(f.settings.money).toBeNull();
  });
});

describe('convertToIdp', () => {
  it('adds qty x idp to earned and deducts stock', () => {
    const s = { ...base(), stock: { clock: 3 } };
    const n = must(convertToIdp(s, gd, [{ item: 'clock', qty: 2 }]));
    expect(n.idp.earned).toBe(620);
    expect(n.stock.clock).toBe(1);
    expect(s.idp.earned).toBe(0);
  });
  it('rejects items without idp and insufficient stock', () => {
    expect(convertToIdp({ ...base(), stock: { tofu: 5 } }, gd, [{ item: 'tofu', qty: 1 }]).ok).toBe(false);
    expect(convertToIdp({ ...base(), stock: { clock: 1 } }, gd, [{ item: 'clock', qty: 2 }]))
      .toMatchObject({ ok: false, missing: [{ item: 'clock', qty: 1 }] });
  });
});

describe('spawns', () => {
  const reset = lastResetAt(now, '00:00');
  it('becomes available 3h after reset and not again once collected', () => {
    const s = base();
    expect(spawnsAvailable(s, gd, new Date(reset.getTime() + (3 * 3600 - 60) * 1000))).toBe(false);
    const at = new Date(reset.getTime() + 3 * 3600 * 1000);
    expect(spawnsAvailable(s, gd, at)).toBe(true);
    const c = collectSpawns(s, gd, [{ item: '2000', qty: 5 }], at);
    expect(c.stock['2000']).toBe(5);
    expect(c.spawnsCollectedOn).toBe(localDay(at));
    expect(spawnsAvailable(c, gd, at)).toBe(false);
    expect(s.spawnsCollectedOn).toBeNull();
  });
  it('is false with no active spawns', () => {
    const none = { ...gd, spawns: { sp1: { ...gd.spawns.sp1, active: false } } };
    expect(spawnsAvailable(base(), none, now)).toBe(false);
  });
});

describe('applyResets', () => {
  it('zeroes counters when the recorded reset is older', () => {
    const s = base();
    s.requests = { ...s.requests, dailyDone: 3, weeklyDone: 4, lastDailyReset: '2026-11-18', lastWeeklyReset: '2026-01-01' };
    const n = applyResets(s, now);
    expect(n.requests.dailyDone).toBe(0);
    expect(n.requests.weeklyDone).toBe(0);
    expect(n.requests.lastDailyReset).toBe(localDay(lastResetAt(now, '00:00')));
    expect(s.requests.dailyDone).toBe(3);
  });
  it('leaves current counters alone', () => {
    const s = base();
    s.requests = { ...s.requests, dailyDone: 3, weeklyDone: 4 };
    expect(applyResets(s, now).requests).toEqual(s.requests);
  });
});

describe('bumpRequests', () => {
  it('clamps to [0, cap]', () => {
    const s = base();
    s.requests = { ...s.requests, dailyCap: 2, weeklyCap: 3, dailyDone: 1, weeklyDone: 3 };
    const up = bumpRequests(s, 1);
    expect(up.requests).toMatchObject({ dailyDone: 2, weeklyDone: 3 });
    expect(bumpRequests(bumpRequests(up, -1), -1).requests.dailyDone).toBe(0);
    expect(bumpRequests(emptyState(now), 1).requests.dailyDone).toBe(0);
    expect(s.requests.dailyDone).toBe(1);
  });
});
