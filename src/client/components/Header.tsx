import { useState } from 'react';
import type { Priority, Qty } from '../../shared/types';
import { collectSpawns, finishJob, readyJobs, spawnsAvailable } from '../../shared/actions';
import { useApp } from '../useAppState';

const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'idp', label: 'IDP' },
  { id: 'balanced', label: 'Balanced' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function Header() {
  const { gd, state, now, warnings, apply, undo, canUndo, saveError } = useApp();
  const { settings } = state;
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnQty, setSpawnQty] = useState<Record<string, string>>({});

  const run = (fn: Parameters<typeof apply>[0]) => setError(apply(fn));
  const setSettings = (patch: Partial<typeof settings>) => run(s => ({ ...s, settings: { ...s.settings, ...patch } }));

  const ready = readyJobs(state, now);
  const spawnsReady = spawnsAvailable(state, gd, now);
  const activeSpawns = Object.values(gd.spawns).filter(sp => sp.active);
  const reached = settings.money !== null && settings.moneyTarget !== null && settings.money >= settings.moneyTarget;
  const progress = settings.moneyTarget && settings.moneyTarget > 0 ? Math.min(settings.money ?? 0, settings.moneyTarget) : 0;

  const finishAll = () => run((s, g) => {
    let cur = s;
    for (const job of readyJobs(s, now)) {
      const r = finishJob(cur, g, job.id);
      if (!r.ok) return r;
      cur = r.value;
    }
    return cur;
  });

  const openSpawns = () => {
    setSpawnQty(Object.fromEntries(activeSpawns.map(sp => [sp.id, String(sp.qtyPerDay)])));
    setSpawnOpen(true);
  };

  const confirmSpawns = () => {
    const quantities: Qty[] = [];
    for (const sp of activeSpawns) {
      const qty = Number(spawnQty[sp.id]);
      if (!Number.isInteger(qty) || qty < 0) {
        setError(`Quantity for ${gd.items[sp.item]?.name ?? sp.item} must be a whole number, zero or more`);
        return;
      }
      if (qty > 0) quantities.push({ item: sp.item, qty });
    }
    const err = apply((s, g) => collectSpawns(s, g, quantities, now));
    setError(err);
    if (!err) setSpawnOpen(false);
  };

  return (
    <header className="header">
      {warnings.length > 0 && !dismissed && (
        <div className="banner warn" role="alert">
          <div>{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
          <button onClick={() => setDismissed(true)}>Dismiss</button>
        </div>
      )}
      {saveError && <div className="banner error" role="alert">Save failed: {saveError}. Changes are kept here and will be retried on your next edit.</div>}
      {error && (
        <div className="banner error" role="alert">
          <div>{error}</div>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="header-row">
        <h1>Island Planner</h1>
        <fieldset className="priority">
          <legend>Priority</legend>
          {PRIORITIES.map(p => (
            <label key={p.id}>
              <input type="radio" name="priority" checked={settings.priority === p.id} onChange={() => setSettings({ priority: p.id })} />
              {p.label}
            </label>
          ))}
        </fieldset>
        <button onClick={undo} disabled={!canUndo}>Undo</button>
      </div>

      <div className="header-row">
        <label>Money
          <input type="number" min={0} value={settings.money ?? ''} onChange={e => setSettings({ money: numOrNull(e.target.value) })} />
        </label>
        <label>Target
          <input type="number" min={0} value={settings.moneyTarget ?? ''} onChange={e => setSettings({ moneyTarget: numOrNull(e.target.value) })} />
        </label>
        {settings.moneyTarget !== null && settings.moneyTarget > 0 && (
          <progress aria-label="Money progress" value={progress} max={settings.moneyTarget} />
        )}
        {reached && <span className="hint">Target reached — switch priority?</span>}
      </div>

      <div className="header-row">
        <label>Season
          <input type="number" min={1} value={settings.season} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n > 0) setSettings({ season: n }); }} />
        </label>
        <label>Daily reset
          <input type="time" value={settings.resetTime} onChange={e => { if (e.target.value) setSettings({ resetTime: e.target.value }); }} />
        </label>
        <label>Weekly reset
          <select value={settings.weeklyResetDay} onChange={e => setSettings({ weeklyResetDay: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        {ready.length > 0 && <button className="badge" onClick={finishAll}>{ready.length} jobs ready</button>}
        {spawnsReady && <button className="badge" onClick={openSpawns}>Daily spawns ready</button>}
      </div>

      {spawnOpen && (
        <div className="panel">
          <strong>Collect daily spawns</strong>
          <table>
            <tbody>
              {activeSpawns.map(sp => (
                <tr key={sp.id}>
                  <td>{gd.items[sp.item]?.name ?? sp.item}</td>
                  <td>
                    <input type="number" min={0} aria-label={`${gd.items[sp.item]?.name ?? sp.item} quantity`} value={spawnQty[sp.id] ?? ''}
                      onChange={e => setSpawnQty(q => ({ ...q, [sp.id]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={confirmSpawns}>Confirm</button>
          <button onClick={() => setSpawnOpen(false)}>Cancel</button>
        </div>
      )}
    </header>
  );
}
