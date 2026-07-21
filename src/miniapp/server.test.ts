/**
 * Drives a real listening server, because the things most likely to be wrong
 * here are not logic but wiring: a missing auth check on a route, a header that
 * breaks the app inside Telegram Web, an asset path that only resolves in dev.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { createHandler, startMiniAppServer, INIT_DATA_HEADER } from './server.js';
import { ApiDeps } from './api.js';
import { ScheduledTask } from '../types.js';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TOKEN = '123456:test-token';
const OWNER = 42;
const FOLDER = 'telegram_main';

function initData(userId = OWNER): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'T' }),
  };
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    group_folder: FOLDER,
    chat_jid: 'tg:1',
    prompt: 'Do the thing',
    script: null,
    schedule_type: 'once',
    schedule_value: '2026-07-22T09:00:00.000Z',
    context_mode: 'isolated',
    kind: 'notify',
    next_run: '2026-07-22T09:00:00.000Z',
    status: 'active',
    created_at: '2026-07-22T00:00:00.000Z',
    ...over,
  } as ScheduledTask;
}

let server: http.Server;
let base: string;
let groupsDir: string;
let tasks: ScheduledTask[];
const deleted: string[] = [];

beforeAll(async () => {
  groupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-'));
  fs.mkdirSync(path.join(groupsDir, FOLDER), { recursive: true });
  fs.writeFileSync(
    path.join(groupsDir, FOLDER, 'links.jsonl'),
    JSON.stringify({ url: 'https://a.com', at: '2026-07-21T10:00:00.000Z' }) +
      '\n' +
      JSON.stringify({ url: 'https://b.com', at: '2026-07-21T11:00:00.000Z' }) +
      '\n',
  );
  tasks = [task(), task({ id: 'sched-morning', prompt: '⏰ Подъём' })];

  const api: ApiDeps = {
    groupFolder: FOLDER,
    groupsDir,
    getTasks: () => tasks,
    deleteTask: (id) => {
      deleted.push(id);
      tasks = tasks.filter((t) => t.id !== id);
    },
    lastRefreshAgeMs: () => 60_000,
  };

  server = http.createServer(
    createHandler({ port: 0, botToken: TOKEN, allowedUserIds: [OWNER], api }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(groupsDir, { recursive: true, force: true });
});

function get(p: string, data?: string): Promise<Response> {
  return fetch(base + p, {
    headers: data ? { [INIT_DATA_HEADER]: data } : {},
  });
}

function post(p: string, body: unknown, data = initData()): Promise<Response> {
  return fetch(base + p, {
    method: 'POST',
    headers: { [INIT_DATA_HEADER]: data, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Response bodies are asserted field by field, so a loose type is honest here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

describe('app shell', () => {
  it('serves the page without auth — it carries no data of its own', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('ConClaw');
  });

  // Telegram Web loads the Mini App in an iframe; a blanket DENY shows an
  // empty box there with nothing in the console to explain it.
  it('allows Telegram Web to frame it, and nobody else', async () => {
    const csp = (await get('/')).headers.get('content-security-policy') || '';
    expect(csp).toContain('frame-ancestors https://web.telegram.org');
    expect(csp).not.toContain("frame-ancestors 'none'");
    // The Mini App SDK is loaded from telegram.org.
    expect(csp).toContain('script-src');
    expect(csp).toContain('https://telegram.org');
  });

  it('answers health checks without auth and without leaking state', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });
});

describe('authentication', () => {
  const guarded = ['/api/overview', '/api/links', '/api/tasks'];

  it('rejects every api route with no initData at all', async () => {
    for (const route of guarded) {
      expect((await get(route)).status).toBe(401);
    }
  });

  it('rejects a forged initData', async () => {
    const forged = new URLSearchParams(initData());
    forged.set('user', JSON.stringify({ id: OWNER, first_name: 'X' }));
    expect((await get('/api/links', forged.toString())).status).toBe(401);
  });

  // Correctly signed by Telegram, just not this account.
  it('rejects a real Telegram user who is not on the allowlist', async () => {
    expect((await get('/api/links', initData(999))).status).toBe(401);
  });

  it('tells the client nothing about why it was refused', async () => {
    const body = await json(await get('/api/links', initData(999)));
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('guards writes too, not just reads', async () => {
    const res = await fetch(base + '/api/links/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://a.com' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('api', () => {
  it('returns an overview', async () => {
    const res = await get('/api/overview', initData());
    const body = await json(res);
    expect(body.linkCount).toBe(2);
    expect(body.taskCount).toBe(2);
    expect(body.lastRefreshAgeMs).toBe(60_000);
  });

  // A paused task keeps the next_run it had when it was paused, so it can sit
  // in the past and still sort first. Seen for real on the live install.
  it('leaves paused and past-due tasks out of "upcoming"', async () => {
    const saved = tasks;
    tasks = [
      task({ id: 'paused-1', status: 'paused', next_run: '2020-01-01T00:00:00.000Z' }),
      task({ id: 'past-1', next_run: '2020-01-02T00:00:00.000Z' }),
      task({ id: 'future-1', next_run: '2099-01-01T00:00:00.000Z' }),
    ];
    const body = await json(await get('/api/overview', initData()));
    expect(body.upcoming.map((t: { id: string }) => t.id)).toEqual(['future-1']);
    // Still counted — they exist, they are just not next.
    expect(body.taskCount).toBe(3);
    tasks = saved;
  });

  it('lists links newest first', async () => {
    const body = await json(await get('/api/links', initData()));
    expect(body.links.map((l: { url: string }) => l.url)).toEqual([
      'https://b.com',
      'https://a.com',
    ]);
  });

  it('marks schedule-derived tasks so the app can refuse to delete them', async () => {
    const body = await json(await get('/api/tasks', initData()));
    const derived = body.tasks.find((t: { id: string }) => t.id === 'sched-morning');
    expect(derived.derived).toBe(true);
  });

  it('archives a link', async () => {
    const res = await post('/api/links/archive', { url: 'https://a.com' });
    expect(await json(res)).toEqual({ removed: 1 });
    const after = await json(await get('/api/links', initData()));
    expect(after.links.map((l: { url: string }) => l.url)).toEqual(['https://b.com']);
  });

  // Deleting it would appear to work and then undo itself within the minute.
  it('refuses to delete a task derived from schedule.md', async () => {
    const body = await json(await post('/api/tasks/delete', { id: 'sched-morning' }));
    expect(body.deleted).toBe(false);
    expect(body.reason).toMatch(/schedule\.md/);
    expect(deleted).not.toContain('sched-morning');
  });

  it('deletes an ordinary task', async () => {
    const body = await json(await post('/api/tasks/delete', { id: 'task-1' }));
    expect(body).toEqual({ deleted: true });
    expect(deleted).toContain('task-1');
  });

  it('404s an unknown route rather than falling through', async () => {
    expect((await get('/api/nope', initData())).status).toBe(404);
    expect((await get('/../etc/passwd')).status).toBe(404);
  });

  it('refuses an oversized body instead of buffering it', async () => {
    const res = await post('/api/links/archive', { url: 'x'.repeat(20_000) });
    expect(res.status).toBe(400);
  });
});

describe('startMiniAppServer', () => {
  const api = {} as ApiDeps;

  it('refuses to start with an empty allowlist', () => {
    expect(
      startMiniAppServer({ port: 1, botToken: TOKEN, allowedUserIds: [], api }),
    ).toBeNull();
  });

  it('refuses to start with no bot token to verify against', () => {
    expect(
      startMiniAppServer({ port: 1, botToken: '', allowedUserIds: [OWNER], api }),
    ).toBeNull();
  });

  it('stays off when no port is configured', () => {
    expect(
      startMiniAppServer({ port: 0, botToken: TOKEN, allowedUserIds: [OWNER], api }),
    ).toBeNull();
  });
});
