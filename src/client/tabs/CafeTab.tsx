import { bumpRequests } from '../../shared/actions';
import { runningRun, startedAtLabel, todaysRun } from '../cafeRuns';
import { BuildingBoard } from '../components/BuildingBoard';
import { CafePanel } from '../components/CafePanel';
import { Shortfalls } from '../components/Shortfalls';
import { useApp } from '../useAppState';

export function CafeTab() {
  const { gd, state, plan, now, apply } = useApp();
  const r = state.requests;

  const cafes = Object.values(gd.cafes).filter(c => c.active);
  const statusOf = (cafeId: string) => {
    const running = runningRun(state, cafeId);
    if (running) return `running since ${startedAtLabel(running)}`;
    return todaysRun(state, cafeId, now)?.status === 'done' ? 'done' : 'not started';
  };
  const runSummary = cafes.length === 1
    ? statusOf(cafes[0].id)
    : cafes.length === 0 ? 'not started' : cafes.map(c => `${c.name} ${statusOf(c.id)}`).join('; ');

  const setCap = (key: 'dailyCap' | 'weeklyCap', raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(n) || n < 0) return;
    apply(s => ({ ...s, requests: { ...s.requests, [key]: n } }));
  };

  return (
    <div className="cafe-tab">
      <p className="summary">Café run: {runSummary}</p>
      <p data-testid="requests">
        Requests: {r.dailyDone}/{r.dailyCap} daily · {r.weeklyDone}/{r.weeklyCap} weekly{' '}
        <button className="small" onClick={() => apply(s => bumpRequests(s, -1))}>−</button>{' '}
        <button className="small" onClick={() => apply(s => bumpRequests(s, 1))}>+</button>{' '}
        <label>Daily cap{' '}
          <input type="number" min={0} step={1} aria-label="Daily cap" value={r.dailyCap} onChange={e => setCap('dailyCap', e.target.value)} />
        </label>{' '}
        <label>Weekly cap{' '}
          <input type="number" min={0} step={1} aria-label="Weekly cap" value={r.weeklyCap} onChange={e => setCap('weeklyCap', e.target.value)} />
        </label>
      </p>
      <BuildingBoard pipeline="food" />
      <CafePanel />
      <Shortfalls expansion={plan.food} />
    </div>
  );
}
