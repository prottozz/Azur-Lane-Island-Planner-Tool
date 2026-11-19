import { describe, it, expect } from 'vitest';
import { expandDemand } from '../../src/shared/planner/expand';
import type { Building, GameData, Item, Recipe } from '../../src/shared/types';

const item = (id: string, name = id): Item =>
  ({ id, name, category: 'x', idp: null, cafeValue: null, season: 'permanent', active: true });
const building = (id: string, slots: number): Building =>
  ({ id, name: id, kind: 'other', pipeline: 'both', slots, season: 'permanent', active: true });
const recipe = (id: string, buildingId: string, inputs: [string, number][], outputs: [string, number][], extra: Partial<Recipe> = {}): Recipe =>
  ({ id, buildingId, inputs: inputs.map(([i, qty]) => ({ item: i, qty })), outputs: outputs.map(([i, qty]) => ({ item: i, qty })),
    bonus: [], maxRuns: 12, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true, ...extra });

const gd = (over: Partial<GameData> = {}): GameData => ({
  version: 1,
  items: Object.fromEntries(['tofu', 'soy', 'seeds', 'stew', 'a', 'b', 'ghost'].map(i => [i, item(i)])),
  buildings: { kitchen: building('kitchen', 2), field: building('field', 2) },
  recipes: {
    r_tofu: recipe('r_tofu', 'kitchen', [['soy', 15]], [['tofu', 1]], { maxRuns: 50 }),
    r_soy: recipe('r_soy', 'field', [['seeds', 3]], [['soy', 18]], { maxRuns: 12 }),
    r_stew: recipe('r_stew', 'kitchen', [['soy', 5]], [['stew', 1]]),
  },
  cafes: {},
  shop: [{ item: 'seeds', price: 60, currency: 'coin', shop: 'Seeds' }],
  spawns: {},
  ...over,
});

const runsOf = (steps: { recipeId: string; runs: number }[], id: string) =>
  steps.filter(s => s.recipeId === id).reduce((n, s) => n + s.runs, 0);

describe('expandDemand', () => {
  it('expands tofu demand down to purchased seeds', () => {
    const e = expandDemand(gd(), [{ item: 'tofu', qty: 30 }], { tofu: 6 });
    expect(runsOf(e.steps, 'r_tofu')).toBe(24);
    expect(runsOf(e.steps, 'r_soy')).toBe(20);
    expect(e.purchases).toEqual([{ item: 'seeds', qty: 60, cost: 3600, currency: 'coin' }]);
    expect(e.unobtainable).toEqual([]);
    expect(e.shortfalls).toEqual([{ item: 'tofu', qty: 24 }]);
  });

  it('splits a step that exceeds maxRuns x slots', () => {
    const e = expandDemand(gd(), [{ item: 'soy', qty: 18 * 30 }], {});
    const soy = e.steps.filter(s => s.recipeId === 'r_soy');
    expect(soy.length).toBe(2);
    expect(soy.every(s => s.runs <= 24)).toBe(true);
    expect(runsOf(e.steps, 'r_soy')).toBe(30);
  });

  it('does nothing when available covers demand', () => {
    const e = expandDemand(gd(), [{ item: 'tofu', qty: 5 }], { tofu: 9 });
    expect(e).toEqual({ steps: [], purchases: [], unobtainable: [], shortfalls: [] });
  });

  it('does not mutate the caller available map', () => {
    const avail = { tofu: 2 };
    expandDemand(gd(), [{ item: 'tofu', qty: 5 }], avail);
    expect(avail).toEqual({ tofu: 2 });
  });

  it('reports items with no recipe and no shop entry as unobtainable', () => {
    const e = expandDemand(gd(), [{ item: 'ghost', qty: 7 }], {});
    expect(e.unobtainable).toEqual([{ item: 'ghost', qty: 7 }]);
    expect(e.steps).toEqual([]);
    expect(e.shortfalls).toEqual([{ item: 'ghost', qty: 7 }]);
  });

  it('terminates on recipe cycles and lists the cycled item as unobtainable', () => {
    const g = gd({
      recipes: {
        r_a: recipe('r_a', 'field', [['b', 1]], [['a', 1]]),
        r_b: recipe('r_b', 'field', [['a', 1]], [['b', 1]]),
      },
    });
    const e = expandDemand(g, [{ item: 'a', qty: 2 }], {});
    expect(e.unobtainable.some(q => q.item === 'a')).toBe(true);
  });

  it('nets a shared intermediate from available once', () => {
    // tofu: 15 soy each, stew: 5 soy each; 1 tofu + 1 stew = 20 soy, 8 in stock
    const e = expandDemand(gd(), [{ item: 'tofu', qty: 1 }, { item: 'stew', qty: 1 }], { soy: 8 });
    // soy needed: 15 (tofu) covered 8 -> 7 short; stew then needs 5 more from nothing => 12 total, 1 run of 18 leaves 6
    expect(runsOf(e.steps, 'r_soy')).toBe(1);
    expect(e.purchases).toEqual([{ item: 'seeds', qty: 3, cost: 180, currency: 'coin' }]);
  });

  it('prefers the producer with fewest distinct inputs, tie by id', () => {
    const g = gd({
      recipes: {
        r_x2: recipe('r_x2', 'field', [['a', 1], ['b', 1]], [['soy', 1]]),
        r_x1b: recipe('r_x1b', 'field', [['seeds', 1]], [['soy', 1]]),
        r_x1a: recipe('r_x1a', 'field', [['seeds', 2]], [['soy', 1]]),
      },
    });
    const e = expandDemand(g, [{ item: 'soy', qty: 1 }], {});
    expect(e.steps.map(s => s.recipeId)).toEqual(['r_x1a']);
  });

  it('is deterministic', () => {
    const d = [{ item: 'tofu', qty: 30 }, { item: 'stew', qty: 4 }];
    expect(expandDemand(gd(), d, { tofu: 6 })).toEqual(expandDemand(gd(), d, { tofu: 6 }));
  });
});
