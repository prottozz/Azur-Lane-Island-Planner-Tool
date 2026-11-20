import { bumpRequests } from '../../shared/actions';
import { runningRun, startedAtLabel, todaysRun } from '../cafeRuns';
import { BuildingBoard } from '../components/BuildingBoard';
import { CafePanel } from '../components/CafePanel';
import { CommitInput } from '../components/CommitInput';
import { Shortfalls } from '../components/Shortfalls';
import { useApp, useNow } from '../useAppState';

export function CafeTab() {
  const { gd, state, plan, apply } = useApp();
  const now = useNow();
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

  const setCap = (key: 'dailyCap' | 'weeklyCap', what: string) => (raw: string): string | null => {
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return `${what} must be a whole number, zero or more`;
    return apply(s => ({ ...s, requests: { ...s.requests, [key]: Number(t) } }));
  };

  return (
    <div className="cafe-tab">
      <p className="summary">Café run: {runSummary}</p>
      <p data-testid="requests">
        Requests: {r.dailyDone}/{r.dailyCap} daily · {r.weeklyDone}/{r.weeklyCap} weekly{' '}
        <button className="small" onClick={() => apply(s => bumpRequests(s, -1))}>−</button>{' '}
        <button className="small" onClick={() => apply(s => bumpRequests(s, 1))}>+</button>{' '}
        <label>Daily cap{' '}
          <CommitInput numeric label="Daily cap" value={String(r.dailyCap)} onCommit={setCap('dailyCap', 'Daily cap')} />
        </label>{' '}
        <label>Weekly cap{' '}
          <CommitInput numeric label="Weekly cap" value={String(r.weeklyCap)} onCommit={setCap('weeklyCap', 'Weekly cap')} />
        </label>
      </p>
      <BuildingBoard pipeline="food" />
      <CafePanel />
      <Shortfalls expansion={plan.food} />
    </div>
  );
}
