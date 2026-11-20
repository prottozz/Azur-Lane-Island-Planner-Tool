import type { GameData, Item, ItemId, Pipeline, Qty, Recipe, Result, State } from './types';
import { parseDuration } from './time';
import { newId } from './ids';

export type EntityRef = { kind: 'item' | 'building' | 'recipe' | 'cafe'; id: string };

const touches = (r: Recipe, item: ItemId) =>
  r.inputs.some(q => q.item === item) || r.outputs.some(q => q.item === item) || r.bonus.some(q => q.item === item);

export function producersOf(gd: GameData, item: ItemId): Recipe[] {
  return Object.values(gd.recipes).filter(r => r.active && (r.outputs.some(q => q.item === item) || r.bonus.some(q => q.item === item)));
}

export function consumersOf(gd: GameData, item: ItemId): Recipe[] {
  return Object.values(gd.recipes).filter(r => r.active && r.inputs.some(q => q.item === item));
}

const isSellable = (gd: GameData, item: ItemId) => Object.values(gd.cafes).some(c => c.sellable.includes(item));

/** kitchens → food, factories → goods; others by what their outputs are (transitively) consumed by. */
export function derivePipeline(gd: GameData, buildingId: string): Pipeline {
  const b = gd.buildings[buildingId];
  if (!b) return 'both';
  if (b.kind === 'kitchen') return 'food';
  if (b.kind === 'factory') return 'goods';

  let food = false;
  let goods = false;
  const seen = new Set<ItemId>();
  const walk = (item: ItemId) => {
    if (seen.has(item)) return;
    seen.add(item);
    if (isSellable(gd, item)) food = true;
    for (const r of consumersOf(gd, item)) {
      const kind = gd.buildings[r.buildingId]?.kind;
      if (kind === 'kitchen') food = true;
      else if (kind === 'factory') goods = true;
      else for (const o of [...r.outputs, ...r.bonus]) walk(o.item);
    }
  };
  for (const r of Object.values(gd.recipes)) {
    if (r.buildingId === buildingId && r.active) for (const o of [...r.outputs, ...r.bonus]) walk(o.item);
  }
  if (food && !goods) return 'food';
  if (goods && !food) return 'goods';
  return 'both';
}

/** Items consumed directly by both a kitchen recipe and a factory recipe. */
export function sharedItems(gd: GameData): ItemId[] {
  const food = new Set<ItemId>();
  const goods = new Set<ItemId>();
  for (const r of Object.values(gd.recipes)) {
    if (!r.active) continue;
    const kind = gd.buildings[r.buildingId]?.kind;
    const target = kind === 'kitchen' ? food : kind === 'factory' ? goods : null;
    if (target) for (const q of r.inputs) target.add(q.item);
  }
  return [...food].filter(i => goods.has(i));
}

function recipeName(gd: GameData, r: Recipe): string {
  const first = r.outputs[0];
  return (first && gd.items[first.item]?.name) || r.id;
}
const buildingName = (gd: GameData, id: string) => gd.buildings[id]?.name ?? id;
const recipeLabel = (gd: GameData, r: Recipe) => `recipe ${recipeName(gd, r)} (${buildingName(gd, r.buildingId)})`;

/** Human-readable "used by" lines; empty when nothing references the entity. */
export function findReferences(gd: GameData, s: State, ref: EntityRef): string[] {
  const out: string[] = [];
  const jobLine = (buildingId: string) => `running job in ${buildingName(gd, buildingId)}`;

  switch (ref.kind) {
    case 'item': {
      for (const r of Object.values(gd.recipes)) if (touches(r, ref.id)) out.push(recipeLabel(gd, r));
      const stock = s.stock[ref.id] ?? 0;
      if (stock > 0) out.push(`stock: ${stock}`);
      for (const c of Object.values(gd.cafes)) if (c.sellable.includes(ref.id)) out.push(`café ${c.name}`);
      for (const e of gd.shop) if (e.item === ref.id) out.push(`shop ${e.shop}`);
      if (Object.values(gd.spawns).some(sp => sp.item === ref.id)) out.push('daily spawn');
      for (const j of s.jobs) {
        const r = gd.recipes[j.recipeId];
        if (r && touches(r, ref.id)) out.push(jobLine(j.buildingId));
      }
      if (s.cafePlans.some(p => p.dishes.includes(ref.id))) out.push('café plan');
      if (s.reservations.some(x => x.item === ref.id)) out.push('reservation');
      break;
    }
    case 'building': {
      for (const r of Object.values(gd.recipes)) if (r.buildingId === ref.id) out.push(recipeLabel(gd, r));
      for (const c of Object.values(gd.cafes)) if (c.kitchenBuildingId === ref.id) out.push(`café ${c.name}`);
      for (const j of s.jobs) if (j.buildingId === ref.id) out.push(jobLine(j.buildingId));
      break;
    }
    case 'recipe': {
      for (const j of s.jobs) if (j.recipeId === ref.id) out.push(jobLine(j.buildingId));
      break;
    }
    case 'cafe': {
      if (s.cafePlans.some(p => p.cafeId === ref.id)) out.push('café plan');
      if (s.cafeRuns.some(r => r.cafeId === ref.id && r.status === 'running')) out.push('running café run');
      break;
    }
  }
  return out;
}

const TABLE = { item: 'items', building: 'buildings', recipe: 'recipes', cafe: 'cafes' } as const;

/** Returns a new GameData without the entity, or an error listing what still uses it. */
export function deleteEntity(gd: GameData, s: State, ref: EntityRef): Result<GameData> {
  const key = TABLE[ref.kind];
  if (!gd[key][ref.id]) return { ok: false, error: `Unknown ${ref.kind} "${ref.id}"` };
  const refs = findReferences(gd, s, ref);
  if (refs.length > 0) return { ok: false, error: `Can't delete: used by ${refs.join('; ')}` };
  const { [ref.id]: _gone, ...rest } = gd[key];
  return { ok: true, value: { ...gd, [key]: rest } };
}

/**
 * Removes rank `index` from a café and remaps café plans so they keep pointing at the same rank:
 * indices above the removed one shift down; a plan on the removed rank clamps to the new last rank.
 */
export function removeCafeRank(gd: GameData, s: State, cafeId: string, index: number): Result<{ gd: GameData; state: State }> {
  const cafe = gd.cafes[cafeId];
  if (!cafe) return { ok: false, error: `Unknown café "${cafeId}"` };
  if (!Number.isInteger(index) || index < 0 || index >= cafe.ranks.length) return { ok: false, error: `Rank ${index + 1} does not exist` };
  if (cafe.ranks.length <= 1) return { ok: false, error: 'A café needs at least one rank' };
  const ranks = cafe.ranks.filter((_, i) => i !== index);
  const last = ranks.length - 1;
  const remap = (i: number) => Math.max(0, Math.min(i > index ? i - 1 : i, last));
  const cafePlans = s.cafePlans.map(p => (p.cafeId === cafeId && remap(p.rankIndex) !== p.rankIndex ? { ...p, rankIndex: remap(p.rankIndex) } : p));
  return {
    ok: true,
    value: { gd: { ...gd, cafes: { ...gd.cafes, [cafeId]: { ...cafe, ranks } } }, state: { ...s, cafePlans } },
  };
}

// ---- paste parsing ----

function parseSeason(raw: string): Result<Item['season']> {
  const t = raw.trim().toLowerCase();
  if (t === '' || t === 'permanent') return { ok: true, value: 'permanent' };
  if (/^\d+$/.test(t) && Number(t) > 0) return { ok: true, value: Number(t) };
  return { ok: false, error: `bad season '${raw.trim()}'` };
}

function parseOptionalNumber(raw: string, label: string): Result<number | null> {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} '${t}' is not a number` };
  return { ok: true, value: n };
}

function parseQtyList(raw: string, gd: GameData): Result<Qty[]> {
  const byName = new Map<string, ItemId>();
  for (const it of Object.values(gd.items)) {
    const k = it.name.trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, it.id);
  }
  const list: Qty[] = [];
  for (const part of raw.split(';').map(p => p.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*x\s*(\d+)$/i.exec(part);
    if (!m) return { ok: false, error: `can't read '${part}' (use "Name x3")` };
    const name = m[1].trim();
    const id = byName.get(name.toLowerCase());
    if (!id) return { ok: false, error: `unknown item '${name}'` };
    const qty = Number(m[2]);
    if (qty <= 0) return { ok: false, error: `quantity for '${name}' must be above zero` };
    list.push({ item: id, qty });
  }
  return { ok: true, value: list };
}

export function parsePaste(text: string, kind: 'items' | 'recipes', gd: GameData): { rows: (Item | Recipe)[]; errors: string[] } {
  const rows: (Item | Recipe)[] = [];
  const errors: string[] = [];
  const buildings = new Map(Object.values(gd.buildings).map(b => [b.name.trim().toLowerCase(), b.id]));

  text.split(/\r?\n/).forEach((line, idx) => {
    if (idx === 0 || line.trim() === '') return;
    const rowNo = idx + 1;
    const cols = line.split('\t');
    const fail = (msg: string) => errors.push(`row ${rowNo}: ${msg}`);

    if (kind === 'items') {
      const [name = '', category = '', idp = '', cafeValue = '', season = ''] = cols;
      if (!name.trim()) return fail('missing name');
      const i = parseOptionalNumber(idp, 'idp');
      if (!i.ok) return fail(i.error);
      const c = parseOptionalNumber(cafeValue, 'cafeValue');
      if (!c.ok) return fail(c.error);
      const se = parseSeason(season);
      if (!se.ok) return fail(se.error);
      rows.push({ id: `custom-${newId()}`, name: name.trim(), category: category.trim(), idp: i.value, cafeValue: c.value, season: se.value, active: true });
      return;
    }

    const [building = '', inputs = '', outputs = '', maxRuns = '', timePerRun = '', season = ''] = cols;
    const buildingId = buildings.get(building.trim().toLowerCase());
    if (!buildingId) return fail(`unknown building '${building.trim()}'`);
    const inp = parseQtyList(inputs, gd);
    if (!inp.ok) return fail(inp.error);
    const outp = parseQtyList(outputs, gd);
    if (!outp.ok) return fail(outp.error);
    if (outp.value.length === 0) return fail('missing outputs');
    const mr = maxRuns.trim();
    if (!/^\d+$/.test(mr) || Number(mr) <= 0) return fail(`maxRuns '${mr}' must be a positive whole number`);
    const dur = parseDuration(timePerRun);
    if (!dur.ok) return fail(dur.error);
    const se = parseSeason(season);
    if (!se.ok) return fail(se.error);
    rows.push({ id: `custom-${newId()}`, buildingId, inputs: inp.value, outputs: outp.value, bonus: [], maxRuns: Number(mr),
      secondsPerRun: dur.value, stamina: 0, season: se.value, active: true });
  });

  return { rows, errors };
}
