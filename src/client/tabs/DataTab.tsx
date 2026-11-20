import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { GameData, Season } from '../../shared/types';
import { PasteImport } from '../components/PasteImport';
import { downloadGameData, parseGameDataJson } from '../gamedataIo';
import { useApp } from '../useAppState';
import { BuildingsTable, CafesTable, FishTable, ItemsTable, RecipesTable, ShopTable, SpawnsTable } from './dataTables';
import type { NewRow } from './dataTables';

const SUBTABS = [
  { id: 'items', label: 'Items' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'cafes', label: 'Cafés' },
  { id: 'shop', label: 'Shop' },
  { id: 'spawns', label: 'Daily spawns' },
  { id: 'fish', label: 'Fish' },
] as const;
type SubId = (typeof SUBTABS)[number]['id'];

const CONFIRM_REPLACE = 'Replace all game data? This can be undone.';

function ImportExport() {
  const { gd, applyGameData } = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseGameDataJson(String(reader.result ?? ''));
      if (!parsed.ok) { setError(parsed.error); return; }
      if (!window.confirm(CONFIRM_REPLACE)) { setError(null); return; }
      setError(applyGameData(() => parsed.value));
    };
    reader.onerror = () => setError('Could not read the file');
    reader.readAsText(file);
    input.value = '';
  };

  return (
    <span className="import-export">
      <button type="button" onClick={() => downloadGameData(gd)}>Export JSON</button>{' '}
      <button type="button" onClick={() => fileInput.current?.click()}>Import JSON</button>
      <input ref={fileInput} type="file" accept="application/json,.json" aria-label="Import JSON file" hidden onChange={onFile} />
      {error && <span className="error" role="alert"> {error}</span>}
    </span>
  );
}

export function DataTab() {
  const { gd, state } = useApp();
  const [sub, setSub] = useState<SubId>('items');
  const [seasonFilter, setSeasonFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  /** The row just added or duplicated; `gd` is the game data right after it, so the next edit clears it. */
  const [fresh, setFresh] = useState<{ sub: SubId; id: string; gd: GameData | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!fresh) return;
    if (fresh.gd === null) setFresh({ ...fresh, gd });
    else if (fresh.gd !== gd) { setFresh(null); setNote(null); }
  }, [gd, fresh]);

  const onCreated = (table: SubId) => (row: NewRow) => {
    setFresh({ sub: table, id: row.id, gd: null });
    if (row.season !== undefined && seasonFilter !== 'all' && String(row.season) !== seasonFilter) {
      setSeasonFilter('all');
      setNote('Season filter switched to All so the new row is visible.');
    } else {
      setNote(null);
    }
  };
  const rowProps = (table: SubId) => ({ fresh: fresh?.sub === table ? fresh.id : null, onCreated: onCreated(table) });

  const seasons = useMemo(() => {
    const found = new Set<number>([state.settings.season]);
    const add = (s: Season) => { if (typeof s === 'number') found.add(s); };
    for (const table of [gd.items, gd.buildings, gd.recipes, gd.cafes, gd.spawns]) Object.values(table).forEach(e => add(e.season));
    return [...found].sort((a, b) => a - b);
  }, [gd, state.settings.season]);

  const visible = useMemo(() => (e: { season: Season; active: boolean }) =>
    (showInactive || e.active) && (seasonFilter === 'all' || String(e.season) === seasonFilter),
  [showInactive, seasonFilter]);

  return (
    <div className="data-tab">
      <p className="data-toolbar">
        <label>Season{' '}
          <select aria-label="Season filter" value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="permanent">Permanent</option>
            {seasons.map(n => <option key={n} value={String(n)}>{`Season ${n}`}</option>)}
          </select>
        </label>{' '}
        <label><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>{' '}
        <ImportExport />
      </p>
      <div role="tablist" className="subtabs">
        {SUBTABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === sub} className={t.id === sub ? 'primary' : undefined} onClick={() => setSub(t.id)}>{t.label}</button>
        ))}
      </div>
      {note && <p className="note" role="status">{note}</p>}
      {sub === 'items' && <ItemsTable visible={visible} {...rowProps('items')} />}
      {sub === 'recipes' && <RecipesTable visible={visible} {...rowProps('recipes')} />}
      {sub === 'buildings' && <BuildingsTable visible={visible} {...rowProps('buildings')} />}
      {sub === 'cafes' && <CafesTable visible={visible} {...rowProps('cafes')} />}
      {sub === 'shop' && <ShopTable {...rowProps('shop')} />}
      {sub === 'spawns' && <SpawnsTable visible={visible} {...rowProps('spawns')} />}
      {sub === 'fish' && <FishTable visible={visible} />}
      <PasteImport />
    </div>
  );
}
