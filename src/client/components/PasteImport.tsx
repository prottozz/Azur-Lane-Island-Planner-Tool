import { useState } from 'react';
import { parsePaste } from '../../shared/gamedata';
import { formatDuration } from '../../shared/time';
import type { GameData, Item, Qty, Recipe } from '../../shared/types';
import { useApp } from '../useAppState';

type Kind = 'items' | 'recipes';
interface Preview { kind: Kind; rows: (Item | Recipe)[]; errors: string[] }

// Column that holds the season in each paste layout.
const SEASON_COL: Record<Kind, number> = { items: 4, recipes: 5 };

/** Blank season cells default to the current season, so pasted rows land in the season being entered. */
function withDefaultSeason(text: string, kind: Kind, season: number): string {
  const at = SEASON_COL[kind];
  return text.split(/\r?\n/).map((line, idx) => {
    if (idx === 0 || line.trim() === '') return line;
    const cols = line.split('\t');
    while (cols.length <= at) cols.push('');
    if (cols[at].trim() === '') cols[at] = String(season);
    return cols.join('\t');
  }).join('\n');
}

const seasonText = (s: Item['season']) => (s === 'permanent' ? 'Permanent' : `Season ${s}`);

function qtyText(gd: GameData, list: Qty[]): string {
  return list.map(q => `${gd.items[q.item]?.name ?? q.item} ×${q.qty}`).join(', ');
}

export function PasteImport() {
  const { gd, state, applyGameData } = useApp();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('items');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPreview = () => {
    const parsed = parsePaste(withDefaultSeason(text, kind, state.settings.season), kind, gd);
    setPreview({ kind, ...parsed });
    setError(null);
  };

  const add = () => {
    if (!preview || preview.rows.length === 0) return;
    const rows = preview.rows;
    const table = preview.kind;
    const err = applyGameData(cur => ({ ...cur, [table]: { ...cur[table], ...Object.fromEntries(rows.map(r => [r.id, r])) } }));
    setError(err);
    if (!err) { setPreview(null); setText(''); }
  };

  return (
    <section className="paste-import">
      <h3>Paste import</h3>
      <p className="muted">Paste tab-separated rows (copied from a spreadsheet) with a header line first.</p>
      <p>
        <label>Kind{' '}
          <select aria-label="Paste kind" value={kind} onChange={e => { setKind(e.target.value as Kind); setPreview(null); }}>
            <option value="items">Items</option>
            <option value="recipes">Recipes</option>
          </select>
        </label>
      </p>
      <textarea aria-label="Paste data" rows={6} cols={80} value={text} onChange={e => { setText(e.target.value); setPreview(null); }} />
      <p><button type="button" onClick={runPreview}>Preview</button></p>
      {preview && (
        <div data-testid="paste-preview">
          {preview.rows.length > 0 && (
            <table>
              <thead>
                {preview.kind === 'items'
                  ? <tr><th>Name</th><th>Category</th><th>IDP</th><th>Café value</th><th>Season</th></tr>
                  : <tr><th>Building</th><th>Inputs</th><th>Outputs</th><th>Max runs</th><th>Time per run</th><th>Season</th></tr>}
              </thead>
              <tbody>
                {preview.rows.map(r => 'name' in r
                  ? <tr key={r.id} data-testid="paste-row"><td>{r.name}</td><td>{r.category}</td><td>{r.idp ?? ''}</td><td>{r.cafeValue ?? ''}</td><td>{seasonText(r.season)}</td></tr>
                  : <tr key={r.id} data-testid="paste-row">
                    <td>{gd.buildings[r.buildingId]?.name ?? r.buildingId}</td><td>{qtyText(gd, r.inputs)}</td><td>{qtyText(gd, r.outputs)}</td>
                    <td>{r.maxRuns}</td><td>{formatDuration(r.secondsPerRun)}</td><td>{seasonText(r.season)}</td>
                  </tr>)}
              </tbody>
            </table>
          )}
          {preview.errors.length > 0 && (
            <ul className="error" data-testid="paste-errors">
              {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {preview.rows.length === 0 && preview.errors.length === 0 && <p className="muted">No data rows found.</p>}
          {preview.rows.length > 0 && <p><button type="button" className="primary" onClick={add}>{`Add ${preview.rows.length} rows`}</button></p>}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
