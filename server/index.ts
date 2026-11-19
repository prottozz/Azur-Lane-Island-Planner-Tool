import path from 'node:path';
import { createApp } from './app';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 4747;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));

const app = createApp(dataDir, {
  basicAuth: process.env.BASIC_AUTH || undefined,
  seedPath: process.env.SEED_GAMEDATA || undefined,
});

app.listen(port, host, () => {
  console.log(`Island Planner listening on http://${host}:${port} (data: ${dataDir})`);
});
