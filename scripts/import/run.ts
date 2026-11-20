import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore } from '../../server/storage';
import { emptyGameData } from '../../src/shared/defaults';
import { derivePipeline } from '../../src/shared/gamedata';
import type { GameData } from '../../src/shared/types';
import { mapFish, readFishSheet } from './fish';
import { mergeGameData, unknownItemRefs } from './merge';
import { mapSite } from './site';

const BASE_URL = 'https://azurlane.mrlar.dev/db/static/json/island';
const VERSION = '1.8.4.1';
const FILES = ['items', 'places', 'restaurants', 'shops'] as const;
const DEFAULT_FISH = '../Sources/Azur Lane - fish production and finding info (partially translated from ZH sheet).xlsx';

export interface ImportOptions { dataDir: string; fishPath: string; offline: boolean; season?: number }

export async function runImport(opts: ImportOptions): Promise<string> {
  const lines: string[] = [];
  const seedDir = path.join(opts.dataDir, 'seed', 'site');
  fs.mkdirSync(seedDir, { recursive: true });

  const src: Record<string, unknown> = {};
  for (const name of FILES) {
    const file = path.join(seedDir, `${name}.json`);
    if (opts.offline) {
      if (!fs.existsSync(file)) throw new Error(`--offline: ${file} not found`);
    } else {
      const res = await fetch(`${BASE_URL}/${name}.json?v=${VERSION}`);
      if (!res.ok) throw new Error(`Fetching ${name}.json failed: HTTP ${res.status}`);
      const body = await res.text();
      try { JSON.parse(body); } catch { throw new Error(`${name}.json from the site is not valid JSON`); }
      fs.writeFileSync(file, body);
    }
    src[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  const imported = mapSite(src as any, opts.season ?? 5);
  if (fs.existsSync(opts.fishPath)) {
    const fish = mapFish(readFishSheet(opts.fishPath));
    Object.assign(imported.items, fish.items);
    Object.assign(imported.recipes, fish.recipes);
    imported.shop.push(...fish.shop);
    imported.buildings[fish.building.id] = fish.building;
    lines.push(`Fish sheet: ${Object.keys(fish.recipes).length} fish from ${opts.fishPath}`);
  } else {
    lines.push(`Warning: fish sheet not found at ${opts.fishPath}; importing without fish.`);
  }
  for (const b of Object.values(imported.buildings)) if (b.kind !== 'hatchery') b.pipeline = derivePipeline(imported, b.id);

  const store = createStore(opts.dataDir);
  const existing = store.load<GameData>('gamedata', emptyGameData);
  if (existing.warning) lines.push(`Warning: ${existing.warning}`);
  const { merged, added, skipped } = mergeGameData(existing.value, imported);
  store.save('gamedata', merged);

  lines.push(
    `added: ${added.items} items, ${added.buildings} buildings, ${added.recipes} recipes, ${added.cafes} cafes, ${added.shop} shop entries`,
    `skipped: ${skipped} already present`,
    `totals: ${Object.keys(merged.items).length} items, ${Object.keys(merged.buildings).length} buildings (${Object.values(merged.buildings).map(b => b.id).join(', ')}), ` +
      `${Object.keys(merged.recipes).length} recipes, ${Object.keys(merged.cafes).length} cafes`,
  );
  const unknown = unknownItemRefs(merged);
  lines.push(`recipes referencing unknown items: ${unknown.length}`);
  for (const u of unknown) lines.push(`  ${u.recipeId}: ${u.items.join(', ')}`);
  return lines.join('\n');
}

function parseArgs(argv: string[]): ImportOptions {
  const opts: ImportOptions = { dataDir: path.join(process.cwd(), 'data'), fishPath: path.resolve(DEFAULT_FISH), offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') opts.offline = true;
    else if (a === '--fish' || a === '--data') {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      if (a === '--fish') opts.fishPath = path.resolve(v);
      else opts.dataDir = path.resolve(v);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runImport(parseArgs(process.argv.slice(2))).then(
    report => console.log(report),
    err => { console.error(err instanceof Error ? err.message : err); process.exit(1); },
  );
}
