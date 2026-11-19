import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp, seedIfEmpty } from '../../server/app';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-api-'));
});

describe('API', () => {
  it('round-trips state through PUT and GET', async () => {
    const app = createApp(dir);
    const state = { version: 1, stock: { a: 3 } };
    const put = await request(app).put('/api/state').send(state);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ok: true });
    const got = await request(app).get('/api/state');
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject(state);
  });

  it('serves default gamedata and state on first run with no warnings', async () => {
    const app = createApp(dir);
    const g = await request(app).get('/api/gamedata');
    expect(g.body.version).toBe(1);
    const s = await request(app).get('/api/state');
    expect(s.body.version).toBe(1);
    expect((await request(app).get('/api/health')).body).toEqual({ warnings: [] });
  });

  it('rejects bodies that are not objects with version 1', async () => {
    const app = createApp(dir);
    for (const body of [{ version: 2 }, { foo: 1 }, [1, 2], 'x']) {
      const r = await request(app).put('/api/gamedata').send(body as object).set('Content-Type', 'application/json');
      expect(r.status).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(typeof r.body.error).toBe('string');
    }
    expect(fs.existsSync(path.join(dir, 'gamedata.json'))).toBe(false);
  });

  it('lists load warnings on /api/health', async () => {
    fs.writeFileSync(path.join(dir, 'state.json'), 'garbage');
    const app = createApp(dir);
    const r = await request(app).get('/api/health');
    expect(r.body.warnings).toHaveLength(1);
    expect(r.body.warnings[0]).toMatch(/state\.json was unreadable/);
  });

  it('recovers a corrupted state from backup via the API', async () => {
    const app = createApp(dir);
    await request(app).put('/api/state').send({ version: 1, n: 1 });
    await request(app).put('/api/state').send({ version: 1, n: 2 });
    fs.writeFileSync(path.join(dir, 'state.json'), '{ bad');
    const app2 = createApp(dir);
    expect((await request(app2).get('/api/state')).body.n).toBe(1);
    expect((await request(app2).get('/api/health')).body.warnings[0]).toMatch(/restored backup/);
  });
});

describe('seedIfEmpty', () => {
  it('copies the seed when gamedata.json is missing', () => {
    const seed = path.join(dir, 'seed.json');
    fs.writeFileSync(seed, JSON.stringify({ version: 1, seeded: true }));
    const dataDir = path.join(dir, 'data');
    expect(seedIfEmpty(dataDir, seed)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'gamedata.json'), 'utf8')).seeded).toBe(true);
  });

  it('leaves an existing file untouched', () => {
    const seed = path.join(dir, 'seed.json');
    fs.writeFileSync(seed, JSON.stringify({ version: 1, seeded: true }));
    fs.writeFileSync(path.join(dir, 'gamedata.json'), '{"version":1,"mine":true}');
    expect(seedIfEmpty(dir, seed)).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'gamedata.json'), 'utf8')).toBe('{"version":1,"mine":true}');
  });

  it('returns false with no seed path', () => {
    expect(seedIfEmpty(dir, undefined)).toBe(false);
  });

  it('reports a seed failure as a health warning', async () => {
    const app = createApp(dir, { seedPath: path.join(dir, 'missing-seed.json') });
    const r = await request(app).get('/api/health');
    expect(r.body.warnings[0]).toMatch(/seed/i);
  });
});

describe('basic auth', () => {
  const header = (cred: string) => 'Basic ' + Buffer.from(cred).toString('base64');

  it('rejects requests without credentials', async () => {
    const r = await request(createApp(dir, { basicAuth: 'me:pw' })).get('/api/state');
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toBe('Basic realm="Island Planner"');
  });

  it('accepts correct credentials', async () => {
    const r = await request(createApp(dir, { basicAuth: 'me:pw' })).get('/api/state').set('Authorization', header('me:pw'));
    expect(r.status).toBe(200);
  });

  it('rejects a wrong password, including different lengths', async () => {
    const app = createApp(dir, { basicAuth: 'me:pw' });
    for (const bad of ['me:nope', 'me:p', 'x:pw', 'me']) {
      const r = await request(app).get('/api/state').set('Authorization', header(bad));
      expect(r.status).toBe(401);
    }
  });

  it('protects health too', async () => {
    const r = await request(createApp(dir, { basicAuth: 'me:pw' })).get('/api/health');
    expect(r.status).toBe(401);
  });
});
