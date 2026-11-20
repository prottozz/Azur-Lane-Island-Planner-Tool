import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { emptyGameData, emptyState } from '../src/shared/defaults';
import { createStore, type StoreName } from './storage';

export interface AppOptions {
  basicAuth?: string;
  /** Seed file copied to gamedata.json on first run (see seedIfEmpty). */
  seedPath?: string;
}

/** Copies seedPath to <dataDir>/gamedata.json only if that file does not exist. A missing seed file is silently skipped. */
export function seedIfEmpty(dataDir: string, seedPath: string | undefined): boolean {
  if (!seedPath) return false;
  const target = path.join(dataDir, 'gamedata.json');
  if (fs.existsSync(target) || !fs.existsSync(seedPath)) return false;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(seedPath, target);
  return true;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison so timing does not depend on where lengths differ.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function basicAuthMiddleware(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const match = /^Basic (.+)$/i.exec(header);
    const given = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
    if (match && safeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Island Planner"').status(401).send('Authentication required');
  };
}

export function createApp(dataDir: string, opts: AppOptions = {}): express.Express {
  const warnings: string[] = [];
  if (opts.seedPath) {
    try {
      seedIfEmpty(dataDir, opts.seedPath);
    } catch (e) {
      warnings.push(`Could not seed gamedata.json from ${opts.seedPath}: ${(e as Error).message}`);
    }
  }

  const store = createStore(dataDir);
  const cache = {
    gamedata: store.load('gamedata', emptyGameData),
    state: store.load('state', () => emptyState(new Date())),
  };
  for (const loaded of Object.values(cache)) if (loaded.warning) warnings.push(loaded.warning);

  const app = express();
  // Registered before basic auth so container health checks work; the body is only warnings.
  app.get('/api/health', (_req, res) => {
    res.json({ warnings });
  });

  if (opts.basicAuth) app.use(basicAuthMiddleware(opts.basicAuth));

  const json = express.json({ limit: '10mb' });

  for (const [route, name] of [['gamedata', 'gamedata'], ['state', 'state']] as [string, StoreName][]) {
    app.get(`/api/${route}`, (_req, res) => {
      res.json(cache[name].value);
    });
    app.put(`/api/${route}`, json, (req, res) => {
      const body: unknown = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || (body as { version?: unknown }).version !== 1) {
        res.status(400).json({ ok: false, error: 'Body must be a JSON object with version 1' });
        return;
      }
      store.save(name, body);
      cache[name] = { value: body as never, warning: null };
      res.json({ ok: true });
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).json({ ok: false, error: status === 500 ? 'Internal error' : err.message });
  });

  return app;
}
