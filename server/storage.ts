import fs from 'node:fs';
import path from 'node:path';

export type StoreName = 'gamedata' | 'state';

const KEEP_BACKUPS = 20;
/** Besides the newest KEEP_BACKUPS, the newest backup of each of the last KEEP_DAYS calendar days is kept. */
const KEEP_DAYS = 7;
const RENAME_TRIES = 10;
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

export interface Store {
  load<T>(name: StoreName, fallback: () => T): { value: T; warning: string | null };
  save<T>(name: StoreName, value: T): void;
}

export interface StoreOptions {
  /** Replaces fs.renameSync (tests inject failures). */
  rename?: (from: string, to: string) => void;
  /** Synchronous sleep between rename retries. */
  sleep?: (ms: number) => void;
  now?: () => Date;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Windows briefly locks files (antivirus, indexer, an editor), so rename can fail with EPERM/EACCES/EBUSY.
 * Retries up to RENAME_TRIES times with a 10–50 ms backoff; other errors and the last failure are thrown.
 */
export function renameWithRetry(from: string, to: string, rename: (a: string, b: string) => void, sleep: (ms: number) => void): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_TRIES || !code || !RETRYABLE.has(code)) throw e;
      sleep(Math.min(50, 10 * attempt));
    }
  }
}

/** UTC calendar day (YYYYMMDD) as written in backup file names. */
function utcDay(d: Date): string {
  return timestamp(d).slice(0, 8);
}

function timestamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}`
  );
}

function readValid(file: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1) return parsed;
  } catch {
    // unreadable or unparsable
  }
  return undefined;
}

export function createStore(dataDir: string, opts: StoreOptions = {}): Store {
  const backupDir = path.join(dataDir, 'backups');
  const rename = opts.rename ?? fs.renameSync;
  const sleep = opts.sleep ?? sleepSync;
  const now = opts.now ?? (() => new Date());

  // Backup file names without the .json extension, oldest first. A same-millisecond
  // counter suffix ("-001") sorts after the bare timestamp once the extension is dropped.
  function backupStems(name: StoreName): string[] {
    if (!fs.existsSync(backupDir)) return [];
    return fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith(`${name}-`) && f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  }

  function backupCurrent(name: StoreName, file: string): void {
    if (!fs.existsSync(file)) return;
    fs.mkdirSync(backupDir, { recursive: true });
    const at = now();
    const base = `${name}-${timestamp(at)}`;
    let stem = base;
    for (let n = 1; fs.existsSync(path.join(backupDir, `${stem}.json`)); n++) {
      stem = `${base}-${String(n).padStart(3, '0')}`;
    }
    fs.copyFileSync(file, path.join(backupDir, `${stem}.json`));
    prune(name, at);
  }

  /** Keeps the newest KEEP_BACKUPS plus the newest backup of each of the last KEEP_DAYS days (by file-name date). */
  function prune(name: StoreName, at: Date): void {
    const stems = backupStems(name);
    const keep = new Set(stems.slice(-KEEP_BACKUPS));
    const recentDays = new Set(Array.from({ length: KEEP_DAYS }, (_, i) => utcDay(new Date(at.getTime() - i * 86_400_000))));
    const newestOfDay = new Map<string, string>();
    for (const stem of stems) newestOfDay.set(stem.slice(name.length + 1, name.length + 9), stem);   // sorted: last wins
    for (const [day, stem] of newestOfDay) if (recentDays.has(day)) keep.add(stem);
    for (const old of stems) {
      if (!keep.has(old)) fs.rmSync(path.join(backupDir, `${old}.json`), { force: true });
    }
  }

  return {
    load<T>(name: StoreName, fallback: () => T) {
      const file = path.join(dataDir, `${name}.json`);
      if (!fs.existsSync(file)) return { value: fallback(), warning: null };
      const ok = readValid(file);
      if (ok !== undefined) return { value: ok as T, warning: null };
      for (const stem of backupStems(name).reverse()) {
        const restored = readValid(path.join(backupDir, `${stem}.json`));
        if (restored !== undefined) {
          const time = stem.slice(name.length + 1);
          return { value: restored as T, warning: `${name}.json was unreadable; restored backup from ${time}` };
        }
      }
      return {
        value: fallback(),
        warning: `${name}.json was unreadable and no valid backup exists; started empty`,
      };
    },

    save<T>(name: StoreName, value: T) {
      fs.mkdirSync(dataDir, { recursive: true });
      const file = path.join(dataDir, `${name}.json`);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
      backupCurrent(name, file);
      renameWithRetry(tmp, file, rename, sleep);
    },
  };
}
