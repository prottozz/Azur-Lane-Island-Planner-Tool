import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../server/storage';

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
