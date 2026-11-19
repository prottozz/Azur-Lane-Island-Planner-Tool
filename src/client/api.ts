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

function put(url: string, value: unknown): Promise<unknown> {
  return request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

export const api = {
  getGameData: () => request<GameData>('/api/gamedata'),
  getState: () => request<State>('/api/state'),
  putGameData: (gd: GameData) => put('/api/gamedata', gd),
  putState: (s: State) => put('/api/state', s),
  getWarnings: async (): Promise<string[]> => (await request<{ warnings: string[] }>('/api/health')).warnings,
};
