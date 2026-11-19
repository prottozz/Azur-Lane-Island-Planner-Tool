import { useState } from 'react';
import { startJob } from '../../shared/actions';
import { fillJob, jobInputs } from '../../shared/recipes';
import { parseDuration } from '../../shared/time';
import type { Qty } from '../../shared/types';
import { useApp } from '../useAppState';

interface Props { buildingId: string; slot: number; onClose(): void }

export function JobDialog({ buildingId, slot, onClose }: Props) {
  const { gd, state, apply } = useApp();
  const name = (id: string) => gd.items[id]?.name ?? id;
  const recipeName = (outputs: Qty[]) => (outputs[0] ? name(outputs[0].item) : '(no output)');
  const recipes = Object.values(gd.recipes)
    .filter(r => r.active && r.buildingId === buildingId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? '');
  const recipe = recipes.find(r => r.id === recipeId);
  const [runsText, setRunsText] = useState(recipe ? String(recipe.maxRuns) : '');
  const [timeText, setTimeText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!recipe) {
    return (
      <div className="panel job-dialog">
        <p>No active recipes for this building.</p>
        <button onClick={onClose}>Close</button>
      </div>
    );
  }

  const runs = Number(runsText);
  const runsValid = runsText.trim() !== '' && Number.isInteger(runs) && runs >= 1 && runs <= recipe.maxRuns;
  const timeTrimmed = timeText.trim();
  const parsed = timeTrimmed === '' ? null : parseDuration(timeText);
  const timeError = parsed && !parsed.ok ? parsed.error : null;
  const inputs = runsValid ? jobInputs(recipe, runs) : [];

  const describeFill = (r: typeof recipe) => {
    const fill = fillJob(r).map(q => `${q.qty} ${name(q.item)}`).join(', ');
    return `to fill: ${fill || 'nothing'}`;
  };

  const confirm = () => {
    const durationSec = parsed && parsed.ok ? parsed.value : undefined;
    const err = apply((s, g) => startJob(s, g, { buildingId, slot, recipeId: recipe.id, runs, durationSec, now: new Date() }));
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="panel job-dialog">
      <div className="job-dialog-row">
        <label>Recipe{' '}
          <select
            value={recipeId}
            onChange={e => {
              const next = recipes.find(r => r.id === e.target.value);
              setRecipeId(e.target.value);
              if (next) setRunsText(String(next.maxRuns));
              setError(null);
            }}
          >
            {recipes.map(r => <option key={r.id} value={r.id}>{recipeName(r.outputs)} ({describeFill(r)})</option>)}
          </select>
        </label>
        <label>Runs{' '}
          <input type="number" min={1} max={recipe.maxRuns} value={runsText}
            onChange={e => { setRunsText(e.target.value); setError(null); }} />
        </label>
        <span className="muted">of {recipe.maxRuns}</span>
        <label>Time shown in game{' '}
          <input type="text" value={timeText} placeholder="optional, e.g. 2:15 or 1h 30m"
            onChange={e => { setTimeText(e.target.value); setError(null); }} />
        </label>
      </div>
      {!runsValid && <p className="error" role="alert">Runs must be a whole number from 1 to {recipe.maxRuns}</p>}
      {timeError && <p className="error" role="alert">{timeError}</p>}
      <table>
        <thead><tr><th>Item</th><th>Need</th><th>Have</th></tr></thead>
        <tbody>
          {inputs.map(q => {
            const have = state.stock[q.item] ?? 0;
            return (
              <tr key={q.item} className={have < q.qty ? 'short' : undefined}>
                <td>{name(q.item)}</td><td>{q.qty}</td><td>{have}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="job-dialog-row">
        <button onClick={confirm} disabled={!runsValid || timeError !== null}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
