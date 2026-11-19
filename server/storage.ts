import fs from 'node:fs';
import path from 'node:path';

export type StoreName = 'gamedata' | 'state';

const KEEP_BACKUPS = 20;

export interface Store {
  load<T>(name: StoreName, fallback: () => T): { value: T; warning: string | null };
  save<T>(name: StoreName, value: T): void;
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

export function createStore(dataDir: string): Store {
  const backupDir = path.join(dataDir, 'backups');

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
    const base = `${name}-${timestamp(new Date())}`;
    let stem = base;
    for (let n = 1; fs.existsSync(path.join(backupDir, `${stem}.json`)); n++) {
      stem = `${base}-${String(n).padStart(3, '0')}`;
    }
    fs.copyFileSync(file, path.join(backupDir, `${stem}.json`));
    for (const old of backupStems(name).slice(0, -KEEP_BACKUPS)) {
      fs.rmSync(path.join(backupDir, `${old}.json`), { force: true });
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
      fs.renameSync(tmp, file);
    },
  };
}
