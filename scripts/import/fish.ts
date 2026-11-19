import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseDuration } from '../../src/shared/time';
import type { Building, GameData, Item, Recipe } from '../../src/shared/types';

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** Rows of sheet EN_INFO (header row 1), up to the first row with an empty FISH NAME. */
export function readFishSheet(path: string): Record<string, unknown>[] {
  const wb = XLSX.read(fs.readFileSync(path));
  const sheet = wb.Sheets['EN_INFO'];
  if (!sheet) throw new Error(`Sheet EN_INFO not found in ${path}`);
  const all = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows: Record<string, unknown>[] = [];
  for (const raw of all) {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) row[k.trim()] = v;
    if (!text(row['FISH NAME'])) break;
    rows.push(row);
  }
  return rows;
}

function seconds(name: string, v: unknown): number {
  if (typeof v === 'number') {
    const s = Math.round(v * 86400);
    if (s > 0) return s;
  } else {
    const r = parseDuration(text(v));
    if (r.ok) return r.value;
  }
  throw new Error(`Fish "${name}": can't read TIME TO PRODUCE "${text(v)}"`);
}

export function mapFish(rows: Record<string, unknown>[]): Pick<GameData, 'items' | 'recipes' | 'shop'> & { building: Building } {
  const out: Pick<GameData, 'items' | 'recipes' | 'shop'> = { items: {}, recipes: {}, shop: [] };
  for (const row of rows) {
    const name = text(row['FISH NAME']);
    const s = slug(name);
    const fishId = `fish-${s}`;
    const fryId = `fry-${s}`;
    const fish: Item = {
      id: fishId, name, category: 'Fish', idp: null, cafeValue: null, season: 'permanent', active: true,
      fishing: {
        location: text(row['WHERE TO FISH?']), bait: text(row['LURE ++']), rodLevel: Number(row['LVL ROD']) || 0,
        qte: text(row['QTE (Nb type / Nb min)']), usedIn: text(row['USED IN?']), idpNote: text(row['IDP / FISH']),
      },
    };
    out.items[fishId] = fish;
    out.items[fryId] = { id: fryId, name: `${name} Fry`, category: 'Fry', idp: null, cafeValue: null, season: 'permanent', active: true };
    out.shop.push({ item: fryId, price: Number(row['FRY PRICE']) || 0, currency: 'money', shop: 'Seeds/Hatchery' });
    const recipe: Recipe = {
      id: `fish-${s}`, buildingId: 'hatchery', inputs: [{ item: fryId, qty: 1 }], outputs: [{ item: fishId, qty: Number(row['PROD / TURN']) || 0 }],
      bonus: [], maxRuns: Number(row['MAX TURNS']) || 0, secondsPerRun: seconds(name, row['TIME TO PRODUCE']), stamina: 0, season: 'permanent', active: true,
    };
    out.recipes[recipe.id] = recipe;
  }
  const building: Building = { id: 'hatchery', name: 'Hatchery', kind: 'hatchery', pipeline: 'food', slots: 1, season: 'permanent', active: true };
  return { ...out, building };
}
