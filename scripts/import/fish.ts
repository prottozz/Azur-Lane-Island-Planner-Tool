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

function positive(name: string, column: string, v: unknown): number {
  const n = typeof v === 'number' ? v : text(v) === '' ? NaN : Number(text(v));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Fish "${name}": ${column} must be a number above 0, got "${text(v)}"`);
  return n;
}

/** Find a column by exact header, else by header prefix (e.g. "TIME TO PRODUCE (no speed up)"). */
function findColumn(headers: string[], wanted: string): string | undefined {
  return headers.find(h => h === wanted) ?? headers.find(h => h.startsWith(wanted));
}

export function mapFish(rows: Record<string, unknown>[]): Pick<GameData, 'items' | 'recipes' | 'shop'> & { building: Building } {
  const out: Pick<GameData, 'items' | 'recipes' | 'shop'> = { items: {}, recipes: {}, shop: [] };
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const col = (name: string, required: boolean): string => {
    const found = findColumn(headers, name);
    if (found === undefined && required && rows.length) throw new Error(`column not found: ${name}`);
    return found ?? name;
  };
  const c = {
    name: col('FISH NAME', true), price: col('FRY PRICE', true), time: col('TIME TO PRODUCE', true),
    prod: col('PROD / TURN', true), turns: col('MAX TURNS', true),
    where: col('WHERE TO FISH?', false), lure: col('LURE ++', false), rod: col('LVL ROD', false),
    qte: col('QTE (Nb type / Nb min)', false), used: col('USED IN?', false), idp: col('IDP / FISH', false),
  };
  const slugs = new Set<string>();
  for (const row of rows) {
    const name = text(row[c.name]);
    const s = slug(name);
    if (slugs.has(s)) throw new Error(`duplicate fish slug: ${s}`);
    slugs.add(s);
    const fishId = `fish-${s}`;
    const fryId = `fry-${s}`;
    const fish: Item = {
      id: fishId, name, category: 'Fish', idp: null, cafeValue: null, season: 'permanent', active: true,
      fishing: {
        location: text(row[c.where]), bait: text(row[c.lure]), rodLevel: Number(row[c.rod]) || 0,
        qte: text(row[c.qte]), usedIn: text(row[c.used]), idpNote: text(row[c.idp]),
      },
    };
    out.items[fishId] = fish;
    out.items[fryId] = { id: fryId, name: `${name} Fry`, category: 'Fry', idp: null, cafeValue: null, season: 'permanent', active: true };
    out.shop.push({ item: fryId, price: positive(name, 'FRY PRICE', row[c.price]), currency: 'money', shop: 'Seeds/Hatchery' });
    const recipe: Recipe = {
      id: `fish-${s}`, buildingId: 'hatchery', inputs: [{ item: fryId, qty: 1 }],
      outputs: [{ item: fishId, qty: positive(name, 'PROD / TURN', row[c.prod]) }],
      bonus: [], maxRuns: positive(name, 'MAX TURNS', row[c.turns]), secondsPerRun: seconds(name, row[c.time]), stamina: 0, season: 'permanent', active: true,
    };
    out.recipes[recipe.id] = recipe;
  }
  const building: Building = { id: 'hatchery', name: 'Hatchery', kind: 'hatchery', pipeline: 'food', slots: 1, season: 'permanent', active: true };
  return { ...out, building };
}
