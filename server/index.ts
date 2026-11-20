import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 4747;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const basicAuth = process.env.BASIC_AUTH || undefined;

/** Exits instead of running with data that cannot be saved (e.g. a root-owned bind mount). */
function assertWritable(dir: string): void {
  const probe = path.join(dir, `.write-test-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch {
    const uid = process.getuid?.() ?? 'unknown';
    console.error(`DATA_DIR ${dir} is not writable by uid ${uid} — chown the host folder or use a named volume`);
    process.exit(1);
  }
}

assertWritable(dataDir);

const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'];
if (!loopback.includes(host) && !basicAuth) {
  console.warn('Listening on all interfaces without BASIC_AUTH — anyone on your network can edit your data');
}

const app = createApp(dataDir, {
  basicAuth,
  seedPath: process.env.SEED_GAMEDATA || undefined,
});

app.listen(port, host, () => {
  console.log(`Island Planner listening on http://${host}:${port} (data: ${dataDir})`);
});
