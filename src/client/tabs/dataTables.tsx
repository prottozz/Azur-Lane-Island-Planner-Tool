import { useMemo } from 'react';
import { deleteEntity } from '../../shared/gamedata';
import type { EntityRef } from '../../shared/gamedata';
import { newId } from '../../shared/ids';
import { fillJob } from '../../shared/recipes';
import { formatDuration } from '../../shared/time';
import type { Building, BuildingKind, Cafe, DailySpawn, GameData, Item, Pipeline, Qty, Recipe, Season, ShopEntry } from '../../shared/types';
import { DataTable } from '../components/DataTable';
import type { Column, EditSpec } from '../components/DataTable';
import { QtyChipsEditor } from '../components/QtyChipsEditor';
import { RanksEditor } from '../components/RanksEditor';
import { useApp } from '../useAppState';
import type { AppState } from '../useAppState';
import { parseName, parseNonNegative, parseOptionalValue, parsePositiveInt, parseSeason, parseTime } from './dataValidate';

type TableKey = 'items' | 'buildings' | 'recipes' | 'cafes' | 'spawns';
type Row<K extends TableKey> = GameData[K][string];
export interface Visibility { visible(e: { season: Season; active: boolean }): boolean }

const BUILDING_KINDS: BuildingKind[] = ['field', 'orchard', 'nursery', 'ranch', 'hatchery', 'mine', 'woods', 'kitchen', 'factory', 'mill', 'other'];
const PIPELINES: Pipeline[] = ['food', 'goods', 'both'];
const opts = (values: string[]) => values.map(v => ({ value: v, label: v }));
const newCustomId = () => `custom-${newId()}`;

function patch<K extends TableKey>(gd: GameData, key: K, id: string, change: Partial<Row<K>>): GameData {
  const cur = gd[key][id];
  if (!cur) return gd;
  return { ...gd, [key]: { ...gd[key], [id]: { ...cur, ...change } } } as GameData;
}

function put<K extends TableKey>(app: AppState, key: K, entity: Row<K>): string | null {
  return app.applyGameData(gd => ({ ...gd, [key]: { ...gd[key], [entity.id]: entity } }));
}

function remove(app: AppState, ref: EntityRef): string | null {
  const err = app.applyGameData(gd => deleteEntity(gd, app.state, ref));
  return err ? err.replace(/^Can't delete: used by /, 'Can’t delete — used by: ') : null;
}

/** An editable scalar column on a keyed table. */
function field<K extends TableKey>(
  key: K, label: string, kind: EditSpec<Row<K>>['kind'], get: (r: Row<K>) => string | boolean,
  toPatch: (v: unknown) => Partial<Row<K>>,
  extra: { parse?: (raw: string) => { ok: true; value: unknown } | { ok: false; error: string }; options?: EditSpec<Row<K>>['options'] } = {},
): Column<Row<K>> {
  return {
    key: label, label,
    edit: { kind, value: get, parse: extra.parse, options: extra.options, commit: (r, v, gd) => patch(gd, key, r.id, toPatch(v)) },
  };
}

function seasonAndActive<K extends 'items' | 'buildings' | 'recipes' | 'cafes' | 'spawns'>(key: K): Column<Row<K>>[] {
  return [
    field(key, 'Season', 'text', r => String(r.season), v => ({ season: v as Season }) as Partial<Row<K>>, { parse: parseSeason }),
    field(key, 'Active', 'bool', r => r.active, v => ({ active: v as boolean }) as Partial<Row<K>>),
  ];
}

const itemOptions = (gd: GameData) =>
  Object.values(gd.items).sort((a, b) => a.name.localeCompare(b.name)).map(i => ({ value: i.id, label: i.active ? i.name : `${i.name} (inactive)` }));
const buildingOptions = (gd: GameData) => Object.values(gd.buildings).sort((a, b) => a.name.localeCompare(b.name)).map(b => ({ value: b.id, label: b.name }));
const itemName = (gd: GameData, id: string) => gd.items[id]?.name ?? id;
const byName = <T extends { name: string }>(list: T[]) => list.sort((a, b) => a.name.localeCompare(b.name));

export function ItemsTable({ visible }: Visibility) {
  const app = useApp();
  const { gd, state } = app;
  const rows = byName(Object.values(gd.items).filter(visible));
  const columns: Column<Item>[] = [
    field('items', 'Name', 'text', r => r.name, v => ({ name: v as string }), { parse: parseName }),
    field('items', 'Category', 'text', r => r.category, v => ({ category: v as string })),
    field('items', 'IDP', 'number', r => (r.idp === null ? '' : String(r.idp)), v => ({ idp: v as number | null }), { parse: parseOptionalValue }),
    field('items', 'Café value', 'number', r => (r.cafeValue === null ? '' : String(r.cafeValue)), v => ({ cafeValue: v as number | null }), { parse: parseOptionalValue }),
    ...seasonAndActive('items'),
  ];
  return (
    <DataTable columns={columns} rows={rows} rowKey={r => r.id} rowLabel={r => r.name} addLabel="Add item"
      onAdd={() => put(app, 'items', { id: newCustomId(), name: 'New item', category: '', idp: null, cafeValue: null, season: state.settings.season, active: true })}
      onDuplicate={r => put(app, 'items', { ...r, id: newCustomId(), name: `${r.name} (copy)` })}
      onDelete={r => remove(app, { kind: 'item', id: r.id })} />
  );
}

export function BuildingsTable({ visible }: Visibility) {
  const app = useApp();
  const { gd, state } = app;
  const rows = byName(Object.values(gd.buildings).filter(visible));
  const columns: Column<Building>[] = [
    field('buildings', 'Name', 'text', r => r.name, v => ({ name: v as string }), { parse: parseName }),
    field('buildings', 'Kind', 'select', r => r.kind, v => ({ kind: v as BuildingKind }), { options: opts(BUILDING_KINDS) }),
    field('buildings', 'Pipeline', 'select', r => r.pipeline, v => ({ pipeline: v as Pipeline }), { options: opts(PIPELINES) }),
    field('buildings', 'Slots', 'int', r => String(r.slots), v => ({ slots: v as number }), { parse: parsePositiveInt }),
    ...seasonAndActive('buildings'),
  ];
  return (
    <DataTable columns={columns} rows={rows} rowKey={r => r.id} rowLabel={r => r.name} addLabel="Add building"
      onAdd={() => put(app, 'buildings', { id: newCustomId(), name: 'New building', kind: 'other', pipeline: 'both', slots: 1, season: state.settings.season, active: true })}
      onDuplicate={r => put(app, 'buildings', { ...r, id: newCustomId(), name: `${r.name} (copy)` })}
      onDelete={r => remove(app, { kind: 'building', id: r.id })} />
  );
}

const recipeLabel = (gd: GameData, r: Recipe) => `${itemName(gd, r.outputs[0]?.item ?? r.id)} @ ${gd.buildings[r.buildingId]?.name ?? r.buildingId}`;

export function RecipesTable({ visible }: Visibility) {
  const app = useApp();
  const { gd, state } = app;
  const rows = Object.values(gd.recipes).filter(visible).sort((a, b) => recipeLabel(gd, a).localeCompare(recipeLabel(gd, b)));
  const set = (id: string, change: Partial<Recipe>) => app.applyGameData(cur => patch(cur, 'recipes', id, change));
  const fillText = (list: Qty[]) => list.map(q => `${q.qty} ${itemName(gd, q.item)}`).join(', ');

  const columns: Column<Recipe>[] = [
    field('recipes', 'Building', 'select', r => r.buildingId, v => ({ buildingId: v as string }), { options: buildingOptions(gd) }),
    { key: 'inputs', label: 'Inputs', render: r => (
      <QtyChipsEditor label={`Inputs ${recipeLabel(gd, r)}`} items={gd.items} entries={r.inputs} onChange={next => set(r.id, { inputs: next.map(e => ({ item: e.item, qty: e.qty })) })} />) },
    { key: 'outputs', label: 'Outputs', render: r => (
      <QtyChipsEditor label={`Outputs ${recipeLabel(gd, r)}`} items={gd.items} entries={r.outputs} minEntries={1} onChange={next => set(r.id, { outputs: next.map(e => ({ item: e.item, qty: e.qty })) })} />) },
    { key: 'bonus', label: 'Bonus outputs', render: r => (
      <QtyChipsEditor label={`Bonus ${recipeLabel(gd, r)}`} items={gd.items} entries={r.bonus} withEvery
        onChange={next => set(r.id, { bonus: next.map(e => ({ item: e.item, qty: e.qty, everyRuns: e.everyRuns ?? 1 })) })} />) },
    field('recipes', 'Max runs', 'int', r => String(r.maxRuns), v => ({ maxRuns: v as number }), { parse: parsePositiveInt }),
    field('recipes', 'Time per run', 'duration', r => formatDuration(r.secondsPerRun), v => ({ secondsPerRun: v as number }), { parse: parseTime }),
    { key: 'fill', label: 'To fill the job', render: r => <span data-testid={`fill-${r.id}`}>{fillText(fillJob(r))}</span> },
    ...seasonAndActive('recipes'),
  ];
  const first = Object.values(gd.buildings)[0];
  const firstItem = Object.values(gd.items)[0];
  return (
    <DataTable columns={columns} rows={rows} rowKey={r => r.id} rowLabel={r => recipeLabel(gd, r)} addLabel="Add recipe"
      addDisabledReason={first && firstItem ? undefined : 'Add a building and an item first.'}
      onAdd={() => put(app, 'recipes', { id: newCustomId(), buildingId: first.id, inputs: [], outputs: [{ item: firstItem.id, qty: 1 }], bonus: [],
        maxRuns: 1, secondsPerRun: 60, stamina: 0, season: state.settings.season, active: true })}
      onDuplicate={r => put(app, 'recipes', { ...r, id: newCustomId() })}
      onDelete={r => remove(app, { kind: 'recipe', id: r.id })} />
  );
}

export function CafesTable({ visible }: Visibility) {
  const app = useApp();
  const { gd, state } = app;
  const rows = byName(Object.values(gd.cafes).filter(visible));
  const set = (id: string, change: Partial<Cafe>) => app.applyGameData(cur => patch(cur, 'cafes', id, change));
  const columns: Column<Cafe>[] = [
    field('cafes', 'Name', 'text', r => r.name, v => ({ name: v as string }), { parse: parseName }),
    field('cafes', 'Kitchen', 'select', r => r.kitchenBuildingId, v => ({ kitchenBuildingId: v as string }), { options: buildingOptions(gd) }),
    { key: 'sellable', label: 'Sellable', render: r => (
      <QtyChipsEditor label={`Sellable ${r.name}`} items={gd.items} withQty={false} entries={r.sellable.map(item => ({ item, qty: 1 }))}
        onChange={next => set(r.id, { sellable: next.map(e => e.item) })} />) },
    { key: 'ranks', label: 'Ranks', render: r => <RanksEditor label={r.name} ranks={r.ranks} onChange={next => set(r.id, { ranks: next })} /> },
    ...seasonAndActive('cafes'),
  ];
  const first = Object.values(gd.buildings)[0];
  return (
    <DataTable columns={columns} rows={rows} rowKey={r => r.id} rowLabel={r => r.name} addLabel="Add café"
      addDisabledReason={first ? undefined : 'Add a building first.'}
      onAdd={() => put(app, 'cafes', { id: newCustomId(), name: 'New café', kitchenBuildingId: first.id, sellable: [],
        ranks: [{ name: 'Rank 1', dishSlots: 1, capacityPerDish: 1 }], season: state.settings.season, active: true })}
      onDuplicate={r => put(app, 'cafes', { ...r, id: newCustomId(), name: `${r.name} (copy)`, ranks: r.ranks.map(k => ({ ...k })) })}
      onDelete={r => remove(app, { kind: 'cafe', id: r.id })} />
  );
}

type ShopRow = ShopEntry & { index: number };

export function ShopTable() {
  const app = useApp();
  const { gd } = app;
  const rows: ShopRow[] = gd.shop.map((e, index) => ({ ...e, index }));
  const shopField = (label: string, kind: EditSpec<ShopRow>['kind'], get: (r: ShopRow) => string, toPatch: (v: unknown) => Partial<ShopEntry>,
    parse?: EditSpec<ShopRow>['parse'], options?: EditSpec<ShopRow>['options']): Column<ShopRow> => ({
    key: label, label,
    edit: { kind, value: get, parse, options, commit: (r, v, cur) => ({ ...cur, shop: cur.shop.map((e, i) => (i === r.index ? { ...e, ...toPatch(v) } : e)) }) },
  });
  const columns: Column<ShopRow>[] = [
    shopField('Item', 'select', r => r.item, v => ({ item: v as string }), undefined, itemOptions(gd)),
    shopField('Shop', 'text', r => r.shop, v => ({ shop: v as string }), parseName),
    shopField('Price', 'number', r => String(r.price), v => ({ price: v as number }), parseNonNegative),
    shopField('Currency', 'text', r => r.currency, v => ({ currency: v as string }), parseName),
  ];
  const firstItem = Object.values(gd.items)[0];
  const last = gd.shop[gd.shop.length - 1];
  return (
    <DataTable columns={columns} rows={rows} rowKey={r => String(r.index)} rowLabel={r => `${itemName(gd, r.item)} in ${r.shop}`} addLabel="Add shop entry"
      addDisabledReason={firstItem ? undefined : 'Add an item first.'}
      onAdd={() => app.applyGameData(cur => ({ ...cur, shop: [...cur.shop, { item: firstItem.id, price: 0, currency: last?.currency ?? 'coin', shop: last?.shop ?? 'shop' }] }))}
      onDuplicate={r => app.applyGameData(cur => ({ ...cur, shop: [...cur.shop, { item: r.item, price: r.price, currency: r.currency, shop: r.shop }] }))}
      onDelete={r => app.applyGameData(cur => ({ ...cur, shop: cur.shop.filter((_, i) => i !== r.index) }))} />
  );
}

export function SpawnsTable({ visible }: Visibility) {
  const app = useApp();
  const { gd, state } = app;
  const rows = useMemo(() => Object.values(gd.spawns).filter(visible).sort((a, b) => itemName(gd, a.item).localeCompare(itemName(gd, b.item))), [gd, visible]);
  const columns: Column<DailySpawn>[] = [
    field('spawns', 'Item', 'select', r => r.item, v => ({ item: v as string }), { options: itemOptions(gd) }),
    field('spawns', 'Qty per day', 'int', r => String(r.qtyPerDay), v => ({ qtyPerDay: v as number }), { parse: parsePositiveInt }),
    ...seasonAndActive('spawns'),
  ];
  const firstItem = Object.values(gd.items)[0];
  return (
    <DataTable columns={columns} rows={rows} rowKey={r => r.id} rowLabel={r => itemName(gd, r.item)} addLabel="Add daily spawn"
      addDisabledReason={firstItem ? undefined : 'Add an item first.'}
      onAdd={() => put(app, 'spawns', { id: newCustomId(), item: firstItem.id, qtyPerDay: 1, season: state.settings.season, active: true })}
      onDuplicate={r => put(app, 'spawns', { ...r, id: newCustomId() })}
      onDelete={r => app.applyGameData(cur => ({ ...cur, spawns: Object.fromEntries(Object.entries(cur.spawns).filter(([id]) => id !== r.id)) }))} />
  );
}
