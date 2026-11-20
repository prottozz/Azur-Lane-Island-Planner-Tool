import { lastResetAt, localDay } from '../shared/time';
import type { CafeRun, State } from '../shared/types';

/** The café's run for the current game day (running or done), if any. */
export function todaysRun(state: State, cafeId: string, now: Date): CafeRun | undefined {
  const day = localDay(lastResetAt(now, state.settings.resetTime));
  return state.cafeRuns.find(r => r.cafeId === cafeId && r.date === day);
}

/** Any still-running run for the café, even one started on an earlier game day. */
export function runningRun(state: State, cafeId: string): CafeRun | undefined {
  return state.cafeRuns.find(r => r.cafeId === cafeId && r.status === 'running');
}

export function startedAtLabel(run: CafeRun): string {
  return new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
