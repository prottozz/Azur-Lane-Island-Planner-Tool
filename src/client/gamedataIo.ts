import type { GameData, Result } from '../shared/types';
import { localDay } from '../shared/time';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses and shape-checks an exported game data file. */
export function parseGameDataJson(text: string): Result<GameData> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not a game data file: the file is not valid JSON' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'Not a game data file: expected a JSON object' };
  if (raw.version !== 1) return { ok: false, error: `Not a game data file: unsupported version ${JSON.stringify(raw.version) ?? 'missing'} (expected 1)` };
  for (const key of ['items', 'buildings', 'recipes', 'cafes', 'spawns']) {
    if (!isRecord(raw[key])) return { ok: false, error: `Not a game data file: "${key}" must be an object` };
  }
  if (!Array.isArray(raw.shop)) return { ok: false, error: 'Not a game data file: "shop" must be a list' };
  return { ok: true, value: raw as unknown as GameData };
}

export const exportFileName = (now: Date) => `island-gamedata-${localDay(now)}.json`;

export function downloadGameData(gd: GameData, now = new Date()): void {
  const blob = new Blob([JSON.stringify(gd, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
