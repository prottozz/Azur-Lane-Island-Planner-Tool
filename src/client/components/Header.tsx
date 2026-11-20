import { useState } from 'react';
import type { Priority, Qty } from '../../shared/types';
import { collectSpawns, finishJob, readyJobs, spawnsAvailable } from '../../shared/actions';
import { hhmm } from '../../shared/time';
import { useApp, useNow } from '../useAppState';
import { CommitInput } from './CommitInput';

const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'idp', label: 'IDP' },
  { id: 'balanced', label: 'Balanced' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Blank → null (not tracked); otherwise a number of at least zero. */
function parseOptionalAmount(raw: string, what: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false, error: `${what} must be a number, zero or more, or blank` };
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function Header() {
  const { gd, state, warnings, apply, undo, canUndo, saveError } = useApp();
  const now = useNow();
  const { settings } = state;
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnQty, setSpawnQty] = useState<Record<string, string>>({});

  const run = (fn: Parameters<typeof apply>[0]) => setError(apply(fn));
  const setSettings = (patch: Partial<typeof settings>) => run(s => ({ ...s, settings: { ...s.settings, ...patch } }));
  /** For CommitInput: applies the patch and returns an error (shown inline), or null. */
  const commitSettings = (patch: Partial<typeof settings>) => apply(s => ({ ...s, settings: { ...s.settings, ...patch } }));
  const amountField = (key: 'money' | 'moneyTarget', what: string) => (raw: string) => {
    const p = parseOptionalAmount(raw, what);
    return p.ok ? commitSettings({ [key]: p.value }) : p.error;
  };

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
      {saveError && <div className="banner error" role="alert">Save failed: {saveError}. Changes are kept here; retrying every 5 seconds.</div>}
      {error && (
        <div className="banner error" role="alert">
          <div>{error}</div>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="header-row">
        <h1>Island Planner</h1>
        <span className="clock" data-testid="clock" title="Current time">{hhmm(now)}</span>
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
          <CommitInput numeric label="Money" value={settings.money === null ? '' : String(settings.money)} onCommit={amountField('money', 'Money')} />
        </label>
        <label>Target
          <CommitInput numeric label="Target" value={settings.moneyTarget === null ? '' : String(settings.moneyTarget)} onCommit={amountField('moneyTarget', 'Target')} />
        </label>
        {settings.moneyTarget !== null && settings.moneyTarget > 0 && (
          <progress aria-label="Money progress" value={progress} max={settings.moneyTarget} />
        )}
        {reached && <span className="hint">Target reached — switch priority?</span>}
      </div>

      <div className="header-row">
        <label>Season
          <CommitInput numeric label="Season" value={String(settings.season)} onCommit={raw => {
            const t = raw.trim();
            return /^\d+$/.test(t) && Number(t) > 0 ? commitSettings({ season: Number(t) }) : 'Season must be a whole number of at least 1';
          }} />
        </label>
        <label>Daily reset
          <CommitInput label="Daily reset" value={settings.resetTime} onCommit={raw => {
            const m = TIME_RE.exec(raw.trim());
            return m ? commitSettings({ resetTime: `${m[1].padStart(2, '0')}:${m[2]}` }) : 'Daily reset must be a time like 05:00';
          }} />
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
