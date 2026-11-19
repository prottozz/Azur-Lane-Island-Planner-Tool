import { describe, it, expect } from 'vitest';
import {
  cafeDemand, reservedDemand, goodsDemand, freeStock, allocate, buildPlan,
} from '../../src/shared/planner/suggest';
import { emptyState } from '../../src/shared/defaults';
import type { Building, BuildingKind, GameData, Item, Pipeline, Priority, Recipe, State } from '../../src/shared/types';

const item = (id: string, name: string, idp: number | null = null): Item =>
  ({ id, name, category: 'x', idp, cafeValue: null, season: 'permanent', active: true });
const building = (id: string, name: string, kind: BuildingKind, pipeline: Pipeline, slots: number): Building =>
  ({ id, name, kind, pipeline, slots, season: 'permanent', active: true });
const recipe = (id: string, buildingId: string, inputs: [string, number][], outputs: [string, number][], extra: Partial<Recipe> = {}): Recipe =>
  ({ id, buildingId, inputs: inputs.map(([i, qty]) => ({ item: i, qty })), outputs: outputs.map(([i, qty]) => ({ item: i, qty })),
    bonus: [], maxRuns: 12, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true, ...extra });

const fixture = (): GameData => ({
  version: 1,
  items: {
    soy: item('soy', 'Soybean'), tofu: item('tofu', 'Tofu'), cake: item('cake', 'Strawberry Cake'),
    strawberry: item('strawberry', 'Strawberry'), flax: item('flax', 'Flax'), seeds: item('seeds', 'Seeds'),
    linen: item('linen', 'Linen', 50), lavender: item('lavender', 'Lavender'), perfume: item('perfume', 'Perfume', 1000),
  },
  buildings: {
    koi: building('koi', 'Golden Koi', 'kitchen', 'food', 1),
    nursery: building('nursery', 'Nursery', 'nursery', 'both', 1),
    factory: building('factory', 'Textile Mill', 'factory', 'goods', 1),
  },
  recipes: {
    r_tofu: recipe('r_tofu', 'koi', [['soy', 15]], [['tofu', 1]], { maxRuns: 50 }),
    r_cake: recipe('r_cake', 'koi', [['strawberry', 2]], [['cake', 1]]),
    r_straw: recipe('r_straw', 'nursery', [['seeds', 3]], [['strawberry', 10]]),
    r_flax: recipe('r_flax', 'nursery', [['seeds', 3]], [['flax', 10]]),
    r_linen: recipe('r_linen', 'factory', [['flax', 5]], [['linen', 1]]),      // 300 IDP/h
  },
  cafes: {
    cafe1: { id: 'cafe1', name: 'Golden Koi Café', kitchenBuildingId: 'koi', sellable: ['tofu', 'cake'],
      ranks: [{ name: 'R1', dishSlots: 3, capacityPerDish: 6 }], season: 'permanent', active: true },
  },
  shop: [],
  spawns: {},
});

const now = new Date(2026, 10, 19, 12, 0, 0);
const iso = (offsetMin: number) => new Date(now.getTime() + offsetMin * 60000).toISOString();
const state = (over: Partial<State> = {}, priority: Priority = 'money'): State => {
  const s = emptyState(now);
  return { ...s, ...over, settings: { ...s.settings, priority } };
};

describe('demand', () => {
  it('cafeDemand counts only the first dishSlots dishes at capacityPerDish each', () => {
    const g = fixture();
    g.items.d1 = item('d1', 'D1'); g.items.d2 = item('d2', 'D2');
    const s = state({ cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['tofu', 'cake', 'd1', 'd2'] }] });
    expect(cafeDemand(g, s)).toEqual([{ item: 'tofu', qty: 6 }, { item: 'cake', qty: 6 }, { item: 'd1', qty: 6 }]);
  });

  it('cafeDemand ignores plans for unknown cafés or ranks', () => {
    const s = state({ cafePlans: [{ cafeId: 'nope', rankIndex: 0, dishes: ['tofu'] }, { cafeId: 'cafe1', rankIndex: 5, dishes: ['tofu'] }] });
    expect(cafeDemand(fixture(), s)).toEqual([]);
  });

  it('reservedDemand sums reservations by item', () => {
    const s = state({ reservations: [
      { id: '1', item: 'tofu', qty: 3, source: 'request' },
      { id: '2', item: 'flax', qty: 2, source: 'quest' },
      { id: '3', item: 'tofu', qty: 4, source: 'quest' },
    ] });
    expect(reservedDemand(s)).toEqual([{ item: 'tofu', qty: 7 }, { item: 'flax', qty: 2 }]);
  });

  it('goodsDemand fills every slot of each factory with its top IDP/h recipe', () => {
    const g = fixture();
    g.buildings.factory.slots = 2;
    g.recipes.r_perfume = recipe('r_perfume', 'factory', [['lavender', 1]], [['perfume', 1]]);   // 6000 IDP/h
    expect(goodsDemand(g, state())).toEqual([{ item: 'lavender', qty: 24 }]);
  });

  it('freeStock adds running job outputs and subtracts reservations, floored at 0', () => {
    const s = state({
      stock: { tofu: 5, soy: 2 },
      jobs: [{ id: 'j', buildingId: 'koi', slot: 0, recipeId: 'r_tofu', runs: 4, startedAt: iso(-10), endsAt: iso(10) }],
      reservations: [{ id: 'r', item: 'tofu', qty: 3, source: 'request' }, { id: 'q', item: 'soy', qty: 9, source: 'quest' }],
    });
    expect(freeStock(s, fixture(), now)).toEqual({ tofu: 6, soy: 0 });
  });
});

describe('allocate', () => {
  const food = [{ item: 'lavender', qty: 8 }];
  const goods = [{ item: 'lavender', qty: 8 }];
  it.each([
    ['money', 8, 2],
    ['idp', 2, 8],
    ['balanced', 5, 5],
  ] as const)('%s splits shared lavender food %i / goods %i', (priority, f, gq) => {
    const a = allocate({ lavender: 10 }, food, goods, priority, ['lavender']);
    expect(a.food.lavender).toBe(f);
    expect(a.goods.lavender).toBe(gq);
  });

  it('balanced floors goods and gives the remainder to food', () => {
    const a = allocate({ lavender: 10 }, [{ item: 'lavender', qty: 1 }], [{ item: 'lavender', qty: 2 }], 'balanced', ['lavender']);
    expect(a).toEqual({ food: { lavender: 4 }, goods: { lavender: 6 } });
  });

  it('gives non-shared items in full to both pipelines', () => {
    const a = allocate({ soy: 30 }, [{ item: 'soy', qty: 30 }], [], 'idp', ['lavender']);
    expect(a).toEqual({ food: { soy: 30 }, goods: { soy: 30 } });
  });
});

describe('buildPlan', () => {
  it('suggests Tofu for an idle Golden Koi slot when the café needs it', () => {
    const s = state({ stock: { soy: 100 }, cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['tofu'] }] });
    const p = buildPlan(fixture(), s, now);
    const koi = p.suggestions.find(x => x.buildingId === 'koi')!;
    expect(koi).toMatchObject({ slot: 0, recipeId: 'r_tofu', runs: 6, missing: [] });
    expect(koi.reason.startsWith('Café needs')).toBe(true);
    expect(koi.reason).toBe('Café needs 6 Tofu; you have 0');
  });

  it('does not suggest for a busy slot but does for a slot whose job is ready', () => {
    const job = (endsMin: number) => ({ id: 'j', buildingId: 'koi', slot: 0, recipeId: 'r_cake', runs: 1, startedAt: iso(-60), endsAt: iso(endsMin) });
    const base = { stock: { soy: 100 }, cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['tofu'] }] };
    expect(buildPlan(fixture(), state({ ...base, jobs: [job(10)] }), now).suggestions.some(x => x.buildingId === 'koi')).toBe(false);
    expect(buildPlan(fixture(), state({ ...base, jobs: [job(0)] }), now).suggestions.some(x => x.buildingId === 'koi')).toBe(true);
  });

  it('caps runs by what the allocation affords, and fills missing when nothing is affordable', () => {
    const plan = { cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['tofu'] }] };
    const some = buildPlan(fixture(), state({ ...plan, stock: { soy: 45 } }), now).suggestions.find(x => x.buildingId === 'koi')!;
    expect(some).toMatchObject({ recipeId: 'r_tofu', runs: 3, missing: [] });
    const none = buildPlan(fixture(), state({ ...plan, stock: { soy: 10 } }), now).suggestions.find(x => x.buildingId === 'koi')!;
    expect(none).toMatchObject({ recipeId: 'r_tofu', runs: 6, missing: [{ item: 'soy', qty: 80 }] });
  });

  it('priority decides whether the nursery grows strawberries (food) or flax (goods)', () => {
    const s = (priority: Priority) =>
      state({ stock: { seeds: 3 }, cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['cake'] }] }, priority);
    const nursery = (priority: Priority) => buildPlan(fixture(), s(priority), now).suggestions.find(x => x.buildingId === 'nursery')!;
    expect(nursery('money')).toMatchObject({ recipeId: 'r_straw', runs: 1, missing: [] });
    expect(nursery('money').reason).toBe('Feeds Strawberry for Strawberry Cake');
    expect(nursery('idp')).toMatchObject({ recipeId: 'r_flax', runs: 1, missing: [] });
    expect(nursery('idp').reason).toBe('Feeds Flax for Linen');
  });

  it('an idle factory with nothing needed makes the best feasible IDP/h recipe', () => {
    const g = fixture();
    g.recipes.r_perfume = recipe('r_perfume', 'factory', [['lavender', 1]], [['perfume', 1]]);   // 6000 IDP/h, no lavender
    const p = buildPlan(g, state({ stock: { flax: 100 } }), now);
    expect(p.rankedGoods).toEqual([
      { recipeId: 'r_perfume', idpPerHour: 6000, feasibleRuns: 0 },
      { recipeId: 'r_linen', idpPerHour: 300, feasibleRuns: 12 },
    ]);
    const f = p.suggestions.find(x => x.buildingId === 'factory')!;
    expect(f).toMatchObject({ recipeId: 'r_linen', runs: 12, missing: [] });
    expect(f.reason).toBe('Best IDP/h you can make now (300/h)');
  });

  it('every suggestion has a non-empty reason and the plan is deterministic', () => {
    const g = fixture();
    g.buildings.nursery.slots = 3;
    const s = state({
      stock: { soy: 30, seeds: 9, flax: 20 },
      cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['tofu', 'cake'] }],
    }, 'balanced');
    const p = buildPlan(g, s, now);
    expect(p.suggestions.length).toBeGreaterThanOrEqual(4);
    // balanced alternates globally: food (cake at Koi), goods (flax takes all 9 seeds), food (strawberries, short), goods (rest of flax)
    expect(p.suggestions.filter(x => x.buildingId === 'nursery').map(x => [x.recipeId, x.runs, x.missing]))
      .toEqual([['r_flax', 3, []], ['r_straw', 2, [{ item: 'seeds', qty: 6 }]], ['r_flax', 1, [{ item: 'seeds', qty: 3 }]]]);
    for (const x of p.suggestions) expect(x.reason.length).toBeGreaterThan(0);
    expect(buildPlan(g, s, now)).toEqual(p);
  });

  it('uses the stored building pipeline: a nursery stored as food never grows flax, even under idp', () => {
    const g = fixture();
    g.buildings.nursery.pipeline = 'food';
    const s = state({ stock: { seeds: 3 }, cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['cake'] }] }, 'idp');
    const p = buildPlan(g, s, now);
    expect(p.goods.steps.some(st => st.recipeId === 'r_flax')).toBe(true);
    expect(p.suggestions.some(x => x.recipeId === 'r_flax')).toBe(false);
    expect(p.suggestions.find(x => x.buildingId === 'nursery')).toMatchObject({ recipeId: 'r_straw', runs: 1, missing: [] });
  });

  it('priority decides which building gets stock that two buildings compete for', () => {
    const g = fixture();
    delete g.buildings.nursery;
    g.buildings = {
      orchard: building('orchard', 'Orchard', 'orchard', 'food', 1),
      flaxField: building('flaxField', 'Flax Field', 'field', 'goods', 1),
      ...g.buildings,
    };
    g.recipes.r_straw.buildingId = 'orchard';
    g.recipes.r_flax.buildingId = 'flaxField';
    const plan = (priority: Priority) => buildPlan(g, state({ stock: { seeds: 3 }, cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['cake'] }] }, priority), now);
    const at = (p: ReturnType<typeof buildPlan>, id: string) => p.suggestions.find(x => x.buildingId === id)!;

    const money = plan('money');
    expect(at(money, 'orchard')).toMatchObject({ recipeId: 'r_straw', runs: 1, missing: [] });
    expect(at(money, 'flaxField')).toMatchObject({ recipeId: 'r_flax', missing: [{ item: 'seeds', qty: 18 }] });
    const idp = plan('idp');
    expect(at(idp, 'flaxField')).toMatchObject({ recipeId: 'r_flax', runs: 1, missing: [] });
    expect(at(idp, 'orchard')).toMatchObject({ recipeId: 'r_straw', missing: [{ item: 'seeds', qty: 6 }] });
  });

  it('splits a truly shared item by priority through the requirement pass', () => {
    // strawberry feeds both the café cake (kitchen) and jam (factory): food needs 12, goods 24, 20 in stock
    const g = fixture();
    g.items.jam = item('jam', 'Jam', 100);                                                         // 600 IDP/h beats linen
    g.recipes.r_jam = recipe('r_jam', 'factory', [['strawberry', 2]], [['jam', 1]]);
    const plan = (priority: Priority) =>
      buildPlan(g, state({ stock: { strawberry: 20 }, cafePlans: [{ cafeId: 'cafe1', rankIndex: 0, dishes: ['cake'] }] }, priority), now);
    const at = (p: ReturnType<typeof buildPlan>, id: string) => p.suggestions.find(x => x.buildingId === id)!;

    const money = plan('money');   // food 12 / goods 8
    expect(at(money, 'koi')).toMatchObject({ recipeId: 'r_cake', runs: 6, missing: [] });
    expect(at(money, 'factory')).toMatchObject({ recipeId: 'r_jam', runs: 4 });
    const idp = plan('idp');       // goods 20 / food 0
    expect(at(idp, 'koi')).toMatchObject({ recipeId: 'r_cake', runs: 6, missing: [{ item: 'strawberry', qty: 12 }] });
    expect(at(idp, 'factory')).toMatchObject({ recipeId: 'r_jam', runs: 10 });
  });
});
