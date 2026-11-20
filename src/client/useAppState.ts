import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameData, Result, State } from '../shared/types';
import { applyResets } from '../shared/actions';
import { emptyGameData, emptyState } from '../shared/defaults';
import { buildPlan } from '../shared/planner/suggest';
import type { Plan } from '../shared/planner/suggest';
import { api } from './api';

const SAVE_DEBOUNCE_MS = 300;
const SAVE_RETRY_MS = 5_000;
const NOW_TICK_MS = 30_000;
const RESET_TICK_MS = 60_000;
const MAX_UNDO = 50;

interface Snapshot { state: State; gd: GameData }

export interface AppState {
  gd: GameData;
  state: State;
  plan: Plan;
  now: Date;
  warnings: string[];
  /** Run a transition; returns an error message, or null on success. */
  apply(fn: (s: State, gd: GameData) => Result<State> | State): string | null;
  applyGameData(fn: (gd: GameData) => Result<GameData> | GameData): string | null;
  undo(): void;
  canUndo: boolean;
  /** Message of the last failed save, or null. Local state is kept and the save is retried every 5 s and on the next change. */
  saveError: string | null;
  loaded: boolean;
  loadError: string | null;
  retryLoad(): void;
}

function isResult<T>(r: Result<T> | T): r is Result<T> {
  return typeof r === 'object' && r !== null && 'ok' in r && typeof (r as { ok: unknown }).ok === 'boolean';
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useAppState(): AppState {
  const [data, setData] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const dataRef = useRef<Snapshot | null>(null);
  const history = useRef<Snapshot[]>([]);
  const dirty = useRef({ state: false, gd: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** At most one flush (so at most one PUT per file) is in flight; a flush requested meanwhile runs after it. */
  const inFlight = useRef(false);
  const flushAgain = useRef(false);

  const flush = useCallback(async (opts: { keepalive?: boolean } = {}): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) { flushAgain.current = true; return; }
    const cur = dataRef.current;
    if (!cur || (!dirty.current.state && !dirty.current.gd)) return;
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    inFlight.current = true;
    const sent = { state: dirty.current.state ? cur.state : null, gd: dirty.current.gd ? cur.gd : null };
    // The fetches start synchronously, before the first await (pagehide relies on this).
    const results = await Promise.all([
      sent.state ? api.putState(sent.state, opts).then(() => null, (e: unknown) => errorMessage(e)) : null,
      sent.gd ? api.putGameData(sent.gd, opts).then(() => null, (e: unknown) => errorMessage(e)) : null,
    ]);
    inFlight.current = false;
    const [stateErr, gdErr] = results;
    // A value is clean only if its PUT succeeded and nothing newer arrived meanwhile.
    if (sent.state && stateErr === null && dataRef.current?.state === sent.state) dirty.current.state = false;
    if (sent.gd && gdErr === null && dataRef.current?.gd === sent.gd) dirty.current.gd = false;
    const err = stateErr ?? gdErr ?? null;
    setSaveError(err);
    if (flushAgain.current) {
      flushAgain.current = false;
      void flush();
    } else if (err) {
      retryTimer.current = setTimeout(() => { retryTimer.current = null; void flush(); }, SAVE_RETRY_MS);
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  const commit = useCallback((next: Snapshot, opts: { undoable: boolean }) => {
    const cur = dataRef.current;
    if (!cur) return;
    if (opts.undoable) {
      history.current = [...history.current, cur].slice(-MAX_UNDO);
      setCanUndo(true);
    }
    if (next.state !== cur.state) dirty.current.state = true;
    if (next.gd !== cur.gd) dirty.current.gd = true;
    dataRef.current = next;
    setData(next);
    scheduleSave();
  }, [scheduleSave]);

  // Load both files and the health warnings.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    Promise.all([api.getGameData(), api.getState(), api.getWarnings().catch(() => [] as string[])]).then(
      ([gd, state, warn]) => {
        if (cancelled) return;
        const reset = applyResets(state, new Date());
        dataRef.current = { gd, state: reset };
        history.current = [];
        dirty.current = { state: reset !== state, gd: false };
        setCanUndo(false);
        setWarnings(warn);
        setData({ gd, state: reset });
        if (reset !== state) scheduleSave();
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(errorMessage(e));
      },
    );
    return () => { cancelled = true; };
  }, [loadAttempt, scheduleSave]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const cur = dataRef.current;
      if (!cur) return;
      const reset = applyResets(cur.state, new Date());
      if (reset !== cur.state) commit({ ...cur, state: reset }, { undoable: false });
    }, RESET_TICK_MS);
    return () => clearInterval(id);
  }, [commit]);

  // Closing or navigating away: send pending changes now, with keepalive so the request outlives the page.
  // If a PUT is already in flight, the newer value is not sent alongside it (one PUT per file at a time).
  useEffect(() => {
    const onPageHide = () => { void flush({ keepalive: true }); };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [flush]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  const apply = useCallback((fn: (s: State, gd: GameData) => Result<State> | State): string | null => {
    const cur = dataRef.current;
    if (!cur) return 'Data is not loaded yet';
    const r = fn(cur.state, cur.gd);
    if (isResult(r)) {
      if (!r.ok) return r.error;
      commit({ ...cur, state: r.value }, { undoable: true });
    } else {
      commit({ ...cur, state: r }, { undoable: true });
    }
    return null;
  }, [commit]);

  const applyGameData = useCallback((fn: (gd: GameData) => Result<GameData> | GameData): string | null => {
    const cur = dataRef.current;
    if (!cur) return 'Data is not loaded yet';
    const r = fn(cur.gd);
    if (isResult(r)) {
      if (!r.ok) return r.error;
      commit({ ...cur, gd: r.value }, { undoable: true });
    } else {
      commit({ ...cur, gd: r }, { undoable: true });
    }
    return null;
  }, [commit]);

  const undo = useCallback(() => {
    const prev = history.current[history.current.length - 1];
    if (!prev) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    commit(prev, { undoable: false });
  }, [commit]);

  const fallback = useMemo(() => ({ gd: emptyGameData(), state: emptyState(new Date()) }), []);
  const gd = data?.gd ?? fallback.gd;
  const state = data?.state ?? fallback.state;
  const plan = useMemo(() => buildPlan(gd, state, now), [gd, state, now]);

  return {
    gd, state, plan, now, warnings, apply, applyGameData, undo, canUndo, saveError,
    loaded: data !== null, loadError, retryLoad: () => setLoadAttempt(n => n + 1),
  };
}

export const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const app = useAppState();
  let body: ReactNode = children;
  if (app.loadError) {
    body = createElement('p', { className: 'status error' },
      `Could not load data: ${app.loadError} `,
      createElement('button', { onClick: app.retryLoad }, 'Retry'));
  } else if (!app.loaded) {
    body = createElement('p', { className: 'status' }, 'Loading…');
  }
  return createElement(AppStateContext.Provider, { value: app }, body);
}

export function useApp(): AppState {
  const app = useContext(AppStateContext);
  if (!app) throw new Error('useApp must be used inside an AppStateProvider');
  return app;
}
