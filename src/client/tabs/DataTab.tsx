import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Season } from '../../shared/types';
import { PasteImport } from '../components/PasteImport';
import { downloadGameData, parseGameDataJson } from '../gamedataIo';
import { useApp } from '../useAppState';
import { BuildingsTable, CafesTable, ItemsTable, RecipesTable, ShopTable, SpawnsTable } from './dataTables';

const SUBTABS = [
  { id: 'items', label: 'Items' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'cafes', label: 'Cafés' },
  { id: 'shop', label: 'Shop' },
  { id: 'spawns', label: 'Daily spawns' },
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
      {sub === 'items' && <ItemsTable visible={visible} />}
      {sub === 'recipes' && <RecipesTable visible={visible} />}
      {sub === 'buildings' && <BuildingsTable visible={visible} />}
      {sub === 'cafes' && <CafesTable visible={visible} />}
      {sub === 'shop' && <ShopTable />}
      {sub === 'spawns' && <SpawnsTable visible={visible} />}
      <PasteImport />
    </div>
  );
}
