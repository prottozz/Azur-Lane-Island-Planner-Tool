import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { mapSite } from '../../scripts/import/site';
import { mapFish, readFishSheet } from '../../scripts/import/fish';
import { mergeGameData } from '../../scripts/import/merge';
import { runImport } from '../../scripts/import/run';
import { emptyGameData } from '../../src/shared/defaults';
import { createStore } from '../../server/storage';
import type { GameData } from '../../src/shared/types';

const fixtureDir = path.resolve(__dirname, '../fixtures/site');
const readFixture = (n: string) => JSON.parse(fs.readFileSync(path.join(fixtureDir, `${n}.json`), 'utf8'));
const src = () => ({ items: readFixture('items'), places: readFixture('places'), restaurants: readFixture('restaurants'), shops: readFixture('shops') });

const crayfish = {
  'FISH NAME': 'Crayfish', 'WHERE TO FISH?': 'River', 'LURE ++': 'Worm', 'LVL ROD': 2, 'QTE (Nb type / Nb min)': '3 / 1',
  'USED IN?': 'Soup', 'IDP / FISH': 12, 'FRY PRICE': 200, 'PROD / TURN': 8, 'MAX TURNS': 5, 'TIME TO PRODUCE': 0.0946990741,
};

function writeFishXlsx(file: string, rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'EN_INFO');
  fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('mapSite', () => {
  const gd = mapSite(src(), 5);

  it('maps the wheat field recipe', () => {
    const r = gd.recipes['recipe-10101'];
    expect(r.buildingId).toBe('place-101');
    expect(r.maxRuns).toBe(12);
    expect(r.secondsPerRun).toBe(2400);
    expect(r.inputs).toEqual([{ item: '1101', qty: 1 }]);
    expect(r.outputs).toEqual([{ item: '1001', qty: 4 }]);
    expect(r.bonus).toEqual([]);
    expect(r.active).toBe(true);
    expect(gd.buildings['place-101'].kind).toBe('field');
  });

  it('ignores recipes_manual and places without recipes', () => {
    expect(gd.recipes['recipe-99999']).toBeUndefined();
    expect(gd.buildings['place-702']).toBeUndefined();
  });

  it('gives only factory-produced items an idp, and café-sellable items a cafeValue', () => {
    expect(gd.items['3001'].idp).toBe(310);
    expect(gd.items['2001'].idp).toBeNull();
    expect(gd.items['2001'].cafeValue).toBe(340);
    expect(gd.items['1001'].cafeValue).toBeNull();
    expect(gd.items['2001'].category).toBe('Dishes');
    expect(gd.items['2001'].season).toBe('permanent');
  });

  it('maps extra_produce to a bonus output', () => {
    expect(gd.recipes['recipe-10201'].bonus).toEqual([{ item: '1003', qty: 1, everyRuns: 3 }]);
  });

  it('maps the seeds shop entry with a per-unit price', () => {
    expect(gd.shop).toEqual([{ item: '1101', price: 20, currency: 'money', shop: 'Seeds/General' }]);
  });

  it('maps the flour mill goods', () => {
    expect(gd.buildings['mill']).toMatchObject({ kind: 'mill', slots: 1 });
    expect(gd.recipes['mill-7']).toMatchObject({
      buildingId: 'mill', inputs: [{ item: '1001', qty: 3 }], outputs: [{ item: '1004', qty: 2 }], maxRuns: 1, secondsPerRun: 1,
    });
  });

  it('maps cafés and derives pipelines', () => {
    expect(gd.cafes['cafe-1']).toMatchObject({ name: 'Tofu Cafe', kitchenBuildingId: 'place-601', sellable: ['2001'] });
    expect(gd.cafes['cafe-1'].ranks[1]).toEqual({ name: 'Rank 2', dishSlots: 3, capacityPerDish: 40 });
    expect(gd.buildings['place-601'].pipeline).toBe('food');
    expect(gd.buildings['place-703'].pipeline).toBe('goods');
  });
});

describe('mapFish', () => {
  const out = mapFish([crayfish]);

  it('builds the crayfish recipe from the day-fraction time', () => {
    const r = out.recipes['fish-crayfish'];
    expect(r.secondsPerRun).toBe(8182);
    expect(r.outputs).toEqual([{ item: 'fish-crayfish', qty: 8 }]);
    expect(r.inputs).toEqual([{ item: 'fry-crayfish', qty: 1 }]);
    expect(r.maxRuns).toBe(5);
    expect(r.buildingId).toBe('hatchery');
  });

  it('creates fish and fry items, fry price and hatchery', () => {
    expect(out.items['fish-crayfish']).toMatchObject({
      category: 'Fish', idp: null, cafeValue: null,
      fishing: { location: 'River', bait: 'Worm', rodLevel: 2, qte: '3 / 1', usedIn: 'Soup', idpNote: '12' },
    });
    expect(out.items['fry-crayfish']).toMatchObject({ name: 'Crayfish Fry', category: 'Fry' });
    expect(out.shop).toEqual([{ item: 'fry-crayfish', price: 200, currency: 'money', shop: 'Seeds/Hatchery' }]);
    expect(out.building).toMatchObject({ id: 'hatchery', kind: 'hatchery', pipeline: 'food', slots: 1 });
  });

  it('accepts HH:MM:SS strings', () => {
    expect(mapFish([{ ...crayfish, 'TIME TO PRODUCE': '02:16:22' }]).recipes['fish-crayfish'].secondsPerRun).toBe(8182);
  });
});

const realHeaders = {
  ICON: '', 'FISH NAME': 'Crayfish', CATEGORY: 'Freshwater', 'WHERE TO FISH?': 'River', 'QTE (Nb type / Nb min)': '3 / 1', 'QTE SPEED': 'Slow',
  'LVL ROD': 2, CORN: 0, WORM: 1, SHRIMP: 0, OCTO: 0, 'LURE ++': 'Worm', 'FRY PRICE': 200, 'TIME TO PRODUCE (no speed up)': 0.0946990741,
  'PROD / TURN': 8, 'MAX TURNS': 5, 'PROD MAX TURN': 40, 'MEAT / FISH': '(NA)', 'IDP / FISH': 12, 'USED IN?': 'Soup',
};

describe('real sheet headers and strict columns', () => {
  const roundTrip = (rows: Record<string, unknown>[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-'));
    const file = path.join(dir, 'fish.xlsx');
    writeFishXlsx(file, rows);
    return mapFish(readFishSheet(file));
  };

  it('reads TIME TO PRODUCE (no speed up) by prefix', () => {
    const out = roundTrip([realHeaders]);
    expect(out.recipes['fish-crayfish'].secondsPerRun).toBe(8182);
    expect(out.recipes['fish-crayfish'].outputs[0].qty).toBe(8);
    expect(out.shop[0].price).toBe(200);
    expect(out.items['fish-crayfish'].fishing?.idpNote).toBe('12');
  });

  it('throws column not found for a missing required column', () => {
    const { 'MAX TURNS': _drop, ...rest } = realHeaders;
    expect(() => roundTrip([rest])).toThrow('column not found: MAX TURNS');
  });

  it.each(['FRY PRICE', 'PROD / TURN', 'MAX TURNS'])('throws with the fish name on bad %s', col => {
    expect(() => roundTrip([{ ...realHeaders, [col]: '' }])).toThrow(/Crayfish.*must be a number above 0/);
    expect(() => roundTrip([{ ...realHeaders, [col]: 0 }])).toThrow(/Crayfish/);
    expect(() => roundTrip([{ ...realHeaders, [col]: 'abc' }])).toThrow(/Crayfish/);
  });

  it('throws on duplicate slugs', () => {
    expect(() => roundTrip([realHeaders, { ...realHeaders, 'FISH NAME': 'CRAYFISH!' }])).toThrow('duplicate fish slug: crayfish');
  });
});

describe('readFishSheet', () => {
  it('reads EN_INFO and stops at the first row with an empty FISH NAME', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-'));
    const file = path.join(dir, 'fish.xlsx');
    writeFishXlsx(file, [crayfish, { ...crayfish, 'FISH NAME': 'Trout' }, { ...crayfish, 'FISH NAME': '' }, { ...crayfish, 'FISH NAME': 'After' }]);
    const rows = readFishSheet(file);
    expect(rows.map(r => r['FISH NAME'])).toEqual(['Crayfish', 'Trout']);
    expect(mapFish(rows).recipes['fish-crayfish'].secondsPerRun).toBe(8182);
  });
});

describe('mergeGameData', () => {
  it('keeps edited existing entries and reports them skipped', () => {
    const imported = mapSite(src(), 5);
    const existing: GameData = { ...emptyGameData(), items: { '3001': { ...imported.items['3001'], idp: 999 } } };
    const { merged, added, skipped } = mergeGameData(existing, imported);
    expect(merged.items['3001'].idp).toBe(999);
    expect(skipped).toBe(1);
    expect(added.items).toBe(Object.keys(imported.items).length - 1);
    expect(added.recipes).toBe(Object.keys(imported.recipes).length);
  });

  it('dedupes shop entries by item and shop', () => {
    const imported = mapSite(src(), 5);
    const first = mergeGameData(emptyGameData(), imported);
    const second = mergeGameData(first.merged, imported);
    expect(second.merged.shop).toHaveLength(1);
    expect(second.added.shop).toBe(0);
  });
});

describe('runImport', () => {
  function seeded() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
    fs.mkdirSync(path.join(dir, 'seed', 'site'), { recursive: true });
    for (const n of ['items', 'places', 'restaurants', 'shops']) fs.copyFileSync(path.join(fixtureDir, `${n}.json`), path.join(dir, 'seed', 'site', `${n}.json`));
    return dir;
  }

  it('imports offline with fish, saves gamedata, and reports unknown items', async () => {
    const dir = seeded();
    const fish = path.join(dir, 'fish.xlsx');
    writeFishXlsx(fish, [crayfish]);
    const places = readFixture('places');
    places['101'].recipes[0].produce.push({ id: 424242, amount: 1 });
    fs.writeFileSync(path.join(dir, 'seed', 'site', 'places.json'), JSON.stringify(places));

    const report = await runImport({ dataDir: dir, fishPath: fish, offline: true });
    const gd = createStore(dir).load<GameData>('gamedata', emptyGameData).value;
    expect(gd.recipes['fish-crayfish'].secondsPerRun).toBe(8182);
    expect(gd.buildings['hatchery']).toBeDefined();
    expect(gd.buildings['mill']).toBeDefined();
    expect(report).toContain('unknown items');
    expect(report).toContain('recipe-10101');
    expect(report).toContain('424242');
  });

  it('warns and continues when the fish sheet is missing; re-run is idempotent', async () => {
    const dir = seeded();
    const opts = { dataDir: dir, fishPath: path.join(dir, 'nope.xlsx'), offline: true };
    const first = await runImport(opts);
    expect(first).toContain('Warning');
    const second = await runImport(opts);
    expect(second).toMatch(/skipped: [1-9]/);
    expect(second).toMatch(/added: 0 items/);
  });
});
