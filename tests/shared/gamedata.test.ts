import { describe, it, expect } from 'vitest';
import { producersOf, consumersOf, derivePipeline, sharedItems, findReferences, deleteEntity, parsePaste } from '../../src/shared/gamedata';
import type { GameData, Item, Building, Recipe, State } from '../../src/shared/types';

const item = (id: string, name: string, extra: Partial<Item> = {}): Item =>
  ({ id, name, category: 'x', idp: null, cafeValue: null, season: 'permanent', active: true, ...extra });
const building = (id: string, name: string, kind: Building['kind']): Building =>
  ({ id, name, kind, pipeline: 'both', slots: 1, season: 'permanent', active: true });
const recipe = (id: string, buildingId: string, inputs: [string, number][], outputs: [string, number][], extra: Partial<Recipe> = {}): Recipe =>
  ({ id, buildingId, inputs: inputs.map(([item, qty]) => ({ item, qty })), outputs: outputs.map(([item, qty]) => ({ item, qty })),
    bonus: [], maxRuns: 5, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true, ...extra });

const gd = (): GameData => ({
  version: 1,
  items: {
    soy: item('soy', 'Soy Beans'), flax: item('flax', 'Flax'), lavender: item('lavender', 'Lavender'),
    tofu: item('tofu', 'Tofu'), cloth: item('cloth', 'Cloth'), tea: item('tea', 'Tea'), unused: item('unused', 'Unused'),
  },
  buildings: {
    field: building('field', 'Faircrop Fields', 'field'), nursery: building('nursery', 'Nursery', 'nursery'),
    koi: building('koi', 'Golden Koi Restaurant', 'kitchen'), arts: building('arts', 'Arts & Crafts', 'factory'),
    mill: building('mill', 'Mill', 'mill'),
  },
  recipes: {
    r_soy: recipe('r_soy', 'field', [], [['soy', 10]]),
    r_flax: recipe('r_flax', 'field', [], [['flax', 10]]),
    r_lav_f: recipe('r_lav_f', 'nursery', [], [['lavender', 5], ['soy', 1]]),
    r_tofu: recipe('r_tofu', 'koi', [['soy', 15]], [['tofu', 1]]),
    r_tea: recipe('r_tea', 'koi', [['lavender', 2]], [['tea', 1]]),
    r_cloth: recipe('r_cloth', 'arts', [['flax', 4]], [['cloth', 1]]),
    r_cloth2: recipe('r_cloth2', 'arts', [['lavender', 3]], [['cloth', 1]]),
    r_old: recipe('r_old', 'arts', [['unused', 1]], [['cloth', 1]], { active: false }),
  },
  cafes: { koi: { id: 'koi', name: 'Golden Koi Restaurant', kitchenBuildingId: 'koi', sellable: ['tofu'], ranks: [], season: 'permanent', active: true } },
  shop: [{ item: 'unused', price: 5, currency: 'coin', shop: 'Seeds' }],
  spawns: { sp: { id: 'sp', item: 'flax', qtyPerDay: 3, season: 'permanent', active: true } },
});

const state = (over: Partial<State> = {}): State => ({
  version: 1, stock: {}, jobs: [], cafePlans: [], cafeRuns: [],
  requests: { dailyCap: 0, weeklyCap: 0, dailyDone: 0, weeklyDone: 0, lastDailyReset: '', lastWeeklyReset: '' },
  reservations: [], idp: { earned: 0, target: null },
  settings: { priority: 'balanced', moneyTarget: null, money: null, season: 1, resetTime: '04:00', weeklyResetDay: 1 },
  spawnsCollectedOn: null, ...over,
});

describe('producersOf / consumersOf', () => {
  it('returns active recipes only', () => {
    expect(producersOf(gd(), 'cloth').map(r => r.id).sort()).toEqual(['r_cloth', 'r_cloth2']);
    expect(consumersOf(gd(), 'unused')).toEqual([]);
    expect(consumersOf(gd(), 'soy').map(r => r.id)).toEqual(['r_tofu']);
  });
});

describe('derivePipeline', () => {
  it('kitchens are food, factories are goods', () => {
    expect(derivePipeline(gd(), 'koi')).toBe('food');
    expect(derivePipeline(gd(), 'arts')).toBe('goods');
  });
  it('field producing soy (tofu kitchen) is food', () => {
    const g = gd(); delete g.recipes.r_flax;
    expect(derivePipeline(g, 'field')).toBe('food');
  });
  it('field producing flax (Arts & Crafts) is goods', () => {
    const g = gd(); delete g.recipes.r_soy;
    expect(derivePipeline(g, 'field')).toBe('goods');
  });
  it('field producing both is both', () => {
    expect(derivePipeline(gd(), 'field')).toBe('both');
  });
  it('nursery whose outputs feed a kitchen and a factory is both', () => {
    expect(derivePipeline(gd(), 'nursery')).toBe('both');
  });
  it('unconsumed outputs are both', () => {
    const g = gd(); g.recipes.r_x = recipe('r_x', 'mill', [], [['unused', 1]]);
    expect(derivePipeline(g, 'mill')).toBe('both');
  });
  it('walks transitively through intermediate buildings', () => {
    const g = gd();
    g.items.flour = item('flour', 'Flour');
    g.recipes.r_flour = recipe('r_flour', 'mill', [['soy', 1]], [['flour', 1]]);
    g.recipes.r_bread = recipe('r_bread', 'koi', [['flour', 1]], [['tofu', 1]]);
    delete g.recipes.r_flax; delete g.recipes.r_tofu;
    expect(derivePipeline(g, 'field')).toBe('food');
  });
  it('counts café-sellable outputs as food', () => {
    const g = gd(); g.recipes.r_x = recipe('r_x', 'mill', [], [['tofu', 1]]);
    expect(derivePipeline(g, 'mill')).toBe('food');
  });
  it('terminates on recipe cycles', () => {
    const g = gd();
    g.items.a = item('a', 'A'); g.items.b = item('b', 'B');
    g.recipes.r_ab = recipe('r_ab', 'mill', [['a', 1]], [['b', 1]]);
    g.recipes.r_ba = recipe('r_ba', 'nursery', [['b', 1]], [['a', 1]]);
    expect(derivePipeline(g, 'mill')).toBe('both');
  });
});

describe('sharedItems', () => {
  it('lists items consumed by both a kitchen and a factory recipe', () => {
    expect(sharedItems(gd())).toEqual(['lavender']);
  });
});

describe('findReferences / deleteEntity', () => {
  it('finds item references in recipes, stock, cafés, shop, spawns', () => {
    const g = gd();
    const soy = findReferences(g, state({ stock: { soy: 5 } }), { kind: 'item', id: 'soy' });
    expect(soy).toContain('recipe Tofu (Golden Koi Restaurant)');
    expect(soy).toContain('stock: 5');
    expect(findReferences(g, state(), { kind: 'item', id: 'tofu' })).toContain('café Golden Koi Restaurant');
    expect(findReferences(g, state(), { kind: 'item', id: 'unused' })).toContain('shop Seeds');
    expect(findReferences(g, state(), { kind: 'item', id: 'flax' })).toContain('daily spawn');
  });
  it('finds jobs and café plans', () => {
    const s = state({
      jobs: [{ id: 'j', buildingId: 'field', slot: 0, recipeId: 'r_soy', runs: 1, startedAt: '', endsAt: '' }],
      cafePlans: [{ cafeId: 'koi', rankIndex: 0, dishes: ['tofu'] }],
    });
    expect(findReferences(gd(), s, { kind: 'item', id: 'soy' })).toContain('running job in Faircrop Fields');
    expect(findReferences(gd(), s, { kind: 'recipe', id: 'r_soy' })).toEqual(['running job in Faircrop Fields']);
    expect(findReferences(gd(), s, { kind: 'cafe', id: 'koi' })).toEqual(['café plan']);
    expect(findReferences(gd(), s, { kind: 'item', id: 'tofu' })).toContain('café plan');
  });
  it('building references: recipes, cafés, jobs', () => {
    const refs = findReferences(gd(), state(), { kind: 'building', id: 'koi' });
    expect(refs).toContain('recipe Tofu (Golden Koi Restaurant)');
    expect(refs).toContain('café Golden Koi Restaurant');
  });
  it('blocks deleting a referenced item', () => {
    const r = deleteEntity(gd(), state({ stock: { soy: 5 } }), { kind: 'item', id: 'soy' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain('Tofu'); expect(r.error).toContain('stock'); }
  });
  it('deletes an unreferenced item without mutating the input', () => {
    const g = gd();
    g.shop = [];
    const r = deleteEntity(g, state(), { kind: 'item', id: 'unused' });
    expect(r.ok).toBe(false); // still used by inactive recipe r_old
    delete g.recipes.r_old;
    const r2 = deleteEntity(g, state(), { kind: 'item', id: 'unused' });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.items.unused).toBeUndefined();
    expect(g.items.unused).toBeDefined();
  });
  it('deletes unreferenced recipes, cafés and buildings; unknown ids fail', () => {
    const g = gd();
    const r = deleteEntity(g, state(), { kind: 'recipe', id: 'r_old' });
    expect(r.ok && r.value.recipes.r_old).toBeFalsy();
    expect(deleteEntity(g, state(), { kind: 'cafe', id: 'koi' }).ok).toBe(true);
    expect(deleteEntity(g, state(), { kind: 'building', id: 'koi' }).ok).toBe(false);
    expect(deleteEntity(g, state(), { kind: 'building', id: 'nope' }).ok).toBe(false);
  });
});

describe('parsePaste', () => {
  const pasteGd = (): GameData => { const g = gd(); g.buildings.koi.name = 'Golden Koi'; return g; };
  it('parses item rows', () => {
    const text = 'name\tcategory\tidp\tcafeValue\tseason\nCloth\tgoods\t120\t\t\nTea\tfood\t\t14\t5\n';
    const { rows, errors } = parsePaste(text, 'items', pasteGd());
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    const [a, b] = rows as Item[];
    expect(a).toMatchObject({ name: 'Cloth', category: 'goods', idp: 120, cafeValue: null, season: 'permanent', active: true });
    expect(b).toMatchObject({ idp: null, cafeValue: 14, season: 5 });
    expect(a.id).toMatch(/^custom-/);
    expect(a.id).not.toBe(b.id);
  });
  it('reports bad item numbers with row numbers', () => {
    const { rows, errors } = parsePaste('h\nA\tx\tabc\t\t\nB\tx\t\t1\t\n', 'items', pasteGd());
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^row 2:/);
  });
  it('parses recipe rows', () => {
    const { rows, errors } = parsePaste('h\nGolden Koi\tSoy Beans x15\tTofu x1\t5\t2:00\t5', 'recipes', pasteGd());
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ buildingId: 'koi', inputs: [{ item: 'soy', qty: 15 }], outputs: [{ item: 'tofu', qty: 1 }],
      maxRuns: 5, secondsPerRun: 7200, season: 5, bonus: [], stamina: 0, active: true });
    expect((rows[0] as Recipe).id).toMatch(/^custom-/);
  });
  it('matches buildings and items case-insensitively and handles multiple entries', () => {
    const { rows, errors } = parsePaste('h\nGOLDEN KOI\tsoy beans x2; TOFU x1\tTea x1\t1\t45m\t', 'recipes', pasteGd());
    expect(errors).toEqual([]);
    expect((rows[0] as Recipe).inputs).toHaveLength(2);
    expect((rows[0] as Recipe).season).toBe('permanent');
  });
  it('reports unknown item, building, duration, maxRuns; keeps valid rows; skips blanks', () => {
    const text = ['h',
      'Golden Koi\tSoy Bean x15\tTofu x1\t5\t2:00\t',
      '',
      'Nowhere\tSoy Beans x1\tTofu x1\t5\t2:00\t',
      'Golden Koi\tSoy Beans x1\tTofu x1\t5\tabc\t',
      'Golden Koi\tSoy Beans x1\tTofu x1\t0\t2:00\t',
      'Golden Koi\tSoy Beans x1\tTofu x1\t5\t2:00\t'].join('\n');
    const { rows, errors } = parsePaste(text, 'recipes', pasteGd());
    expect(rows).toHaveLength(1);
    expect(errors[0]).toBe("row 2: unknown item 'Soy Bean'");
    expect(errors[1]).toMatch(/^row 4: .*building.*Nowhere/i);
    expect(errors[2]).toMatch(/^row 5:/);
    expect(errors[3]).toMatch(/^row 6:.*maxRuns/);
    expect(errors).toHaveLength(4);
  });
});
