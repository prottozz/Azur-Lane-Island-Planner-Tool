import type { GameData, State } from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body; fall through to the status check
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new Error(msg ?? `${init?.method ?? 'GET'} ${url} failed (${res.status})`);
  }
  return body as T;
}

/** Browsers refuse keepalive requests whose bodies exceed 64 KiB in total; stay under that. */
export const KEEPALIVE_MAX_BYTES = 60_000;

export interface PutOptions {
  /** Let the request outlive the page (used on pagehide); ignored for bodies over KEEPALIVE_MAX_BYTES. */
  keepalive?: boolean;
}

function put(url: string, value: unknown, opts: PutOptions = {}): Promise<unknown> {
  const body = JSON.stringify(value);
  const keepalive = opts.keepalive === true && new Blob([body]).size <= KEEPALIVE_MAX_BYTES;
  return request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, ...(keepalive ? { keepalive } : {}) });
}

export const api = {
  getGameData: () => request<GameData>('/api/gamedata'),
  getState: () => request<State>('/api/state'),
  putGameData: (gd: GameData, opts?: PutOptions) => put('/api/gamedata', gd, opts),
  putState: (s: State, opts?: PutOptions) => put('/api/state', s, opts),
  getWarnings: async (): Promise<string[]> => (await request<{ warnings: string[] }>('/api/health')).warnings,
};
