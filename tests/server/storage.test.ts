import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, renameWithRetry } from '../../server/storage';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-store-'));
});

const backups = (name: string) =>
  fs.existsSync(path.join(dir, 'backups'))
    ? fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith(`${name}-`))
    : [];

describe('createStore', () => {
  it('returns the fallback with no warning when the file is missing', () => {
    const store = createStore(dir);
    const r = store.load('state', () => ({ version: 1, n: 0 }));
    expect(r.value).toEqual({ version: 1, n: 0 });
    expect(r.warning).toBeNull();
  });

  it('keeps one backup after two saves', () => {
    const store = createStore(dir);
    store.save('state', { version: 1, n: 1 });
    expect(backups('state')).toHaveLength(0);
    store.save('state', { version: 1, n: 2 });
    expect(backups('state')).toHaveLength(1);
    expect(store.load('state', () => ({ version: 1, n: 0 })).value).toEqual({ version: 1, n: 2 });
    expect(fs.existsSync(path.join(dir, 'state.json.tmp'))).toBe(false);
  });

  it('prunes to the newest 20 backups, even for same-millisecond saves', () => {
    const store = createStore(dir);
    for (let i = 0; i < 25; i++) store.save('state', { version: 1, n: i });
    expect(backups('state')).toHaveLength(20);
  });

  it('prunes per file name', () => {
    const store = createStore(dir);
    for (let i = 0; i < 25; i++) store.save('state', { version: 1, n: i });
    for (let i = 0; i < 3; i++) store.save('gamedata', { version: 1, n: i });
    expect(backups('state')).toHaveLength(20);
    expect(backups('gamedata')).toHaveLength(2);
  });

  it('restores the newest valid backup when the file is garbage', () => {
    const store = createStore(dir);
    store.save('state', { version: 1, n: 1 });
    store.save('state', { version: 1, n: 2 });
    fs.writeFileSync(path.join(dir, 'state.json'), '{ half-written');
    const r = store.load('state', () => ({ version: 1, n: 0 }));
    expect(r.value).toEqual({ version: 1, n: 1 });
    expect(r.warning).toMatch(/state\.json was unreadable; restored backup from/);
  });

  it('treats a wrong version as unreadable', () => {
    const store = createStore(dir);
    store.save('state', { version: 1, n: 1 });
    store.save('state', { version: 1, n: 2 });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 2 }));
    const r = store.load('state', () => ({ version: 1, n: 0 }));
    expect(r.value).toEqual({ version: 1, n: 1 });
    expect(r.warning).toMatch(/restored backup/);
  });

  it('skips unparseable backups and picks the newest valid one', () => {
    const store = createStore(dir);
    store.save('state', { version: 1, n: 1 });
    store.save('state', { version: 1, n: 2 });
    store.save('state', { version: 1, n: 3 });
    const names = backups('state').sort((a, b) => a.replace('.json', '').localeCompare(b.replace('.json', '')));
    fs.writeFileSync(path.join(dir, 'backups', names[names.length - 1]), 'garbage');
    fs.writeFileSync(path.join(dir, 'state.json'), 'garbage');
    const r = store.load('state', () => ({ version: 1, n: 0 }));
    expect(r.value).toEqual({ version: 1, n: 1 });
    expect(r.warning).toMatch(/restored backup/);
  });

  it('falls back with a warning when garbage and no backup', () => {
    fs.writeFileSync(path.join(dir, 'gamedata.json'), 'nope');
    const store = createStore(dir);
    const r = store.load('gamedata', () => ({ version: 1, empty: true }));
    expect(r.value).toEqual({ version: 1, empty: true });
    expect(r.warning).toBe('gamedata.json was unreadable and no valid backup exists; started empty');
  });
});

describe('rename retry (Windows file locks)', () => {
  const failing = (codes: string[]) => {
    const calls: string[] = [];
    const rename = (from: string, to: string) => {
      calls.push(from);
      const code = codes.shift();
      if (code) throw Object.assign(new Error(`${code}: locked`), { code });
      fs.renameSync(from, to);
    };
    return { rename, calls };
  };

  it('retries EPERM/EBUSY and saves on the third try', () => {
    const { rename, calls } = failing(['EPERM', 'EBUSY']);
    const sleeps: number[] = [];
    const store = createStore(dir, { rename, sleep: ms => sleeps.push(ms) });
    store.save('state', { version: 1, n: 7 });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([10, 20]);
    expect(store.load('state', () => ({ version: 1, n: 0 })).value).toEqual({ version: 1, n: 7 });
    expect(fs.existsSync(path.join(dir, 'state.json.tmp'))).toBe(false);
  });

  it('gives up after 10 tries with backoff capped at 50 ms', () => {
    const { rename, calls } = failing(Array(20).fill('EACCES'));
    const sleeps: number[] = [];
    expect(() => renameWithRetry('a', 'b', rename, ms => sleeps.push(ms))).toThrow(/EACCES/);
    expect(calls).toHaveLength(10);
    expect(sleeps).toEqual([10, 20, 30, 40, 50, 50, 50, 50, 50]);
  });

  it('does not retry other errors', () => {
    const { rename, calls } = failing(['ENOENT']);
    expect(() => renameWithRetry('a', 'b', rename, () => {})).toThrow(/ENOENT/);
    expect(calls).toHaveLength(1);
  });

  it('uses a real (short) sleep by default', () => {
    const { rename } = failing(['EBUSY']);
    const t0 = Date.now();
    createStore(dir, { rename }).save('state', { version: 1, n: 1 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(9);
  });
});

describe('backup retention by day', () => {
  const stamp = (day: string, n: number) => `${day}-1200${String(n).padStart(2, '0')}-000`;
  const seed = (names: string[]) => {
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(dir, 'backups', `state-${n}.json`), '{"version":1}');
  };

  it('keeps the newest 20 plus the newest backup of each of the last 7 calendar days', () => {
    // 2 backups on each of 10 days (Nov 10..19) = 20, then 30 on Nov 20 (today).
    const old: string[] = [];
    for (let d = 10; d <= 19; d++) old.push(stamp(`202611${d}`, 1), stamp(`202611${d}`, 2));
    const today = Array.from({ length: 29 }, (_, i) => stamp('20261120', i + 10));
    seed([...old, ...today]);
    fs.writeFileSync(path.join(dir, 'state.json'), '{"version":1}');
    const store = createStore(dir, { now: () => new Date(Date.UTC(2026, 10, 20, 12, 30)) });
    store.save('state', { version: 1, n: 1 });

    const left = backups('state').map(f => f.slice('state-'.length, -'.json'.length)).sort();
    const days = (prefix: string) => left.filter(f => f.startsWith(prefix));
    expect(days('20261120')).toHaveLength(20);                         // newest 20 are all from today
    for (let d = 14; d <= 19; d++) expect(days(`202611${d}`)).toEqual([stamp(`202611${d}`, 2)]);   // newest of each recent day
    for (let d = 10; d <= 13; d++) expect(days(`202611${d}`)).toEqual([]);                         // older than 7 days
    expect(left).toHaveLength(26);
  });
});
