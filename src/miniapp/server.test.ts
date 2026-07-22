/**
 * Drives a real listening server, because the things most likely to be wrong
 * here are not logic but wiring: a missing auth check on a route, a header that
 * breaks the app inside Telegram Web, an asset path that only resolves in dev.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import http from 'http';

import { createHandler, startMiniAppServer, INIT_DATA_HEADER } from './server.js';
import { ApiDeps } from './api.js';
import { LinkQuery, LinkRow, LinkUpdate } from '../db.js';
import type { Rule } from '../rules.js';
import type { SkillProposal } from '../skill-proposals.js';
import type { Note } from '../notes-store.js';
import { NewMessage, ScheduledTask } from '../types.js';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TOKEN = '123456:test-token';
const OWNER = 42;
const FOLDER = 'telegram_main';
const CHAT = 'tg:1';

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
    chat_jid: CHAT,
    prompt: 'Do the thing',
    script: null,
    schedule_type: 'once',
    schedule_value: '2099-01-01T09:00:00.000Z',
    context_mode: 'isolated',
    kind: 'notify',
    next_run: '2099-01-01T09:00:00.000Z',
    status: 'active',
    created_at: '2026-07-22T00:00:00.000Z',
    ...over,
  } as ScheduledTask;
}

function link(over: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 1,
    group_folder: FOLDER,
    url: 'https://a.com',
    title: null,
    icon: null,
    enriched_at: null,
    description: null,
    domain: 'a.com',
    tags: null,
    note: null,
    read: 0,
    added_at: '2026-07-21T10:00:00.000Z',
    read_at: null,
    ...over,
  };
}

let server: http.Server;
let base: string;
let tasks: ScheduledTask[];
let links: LinkRow[];
let history: NewMessage[];
let rules: Rule[];
let proposals: SkillProposal[];
let notes: Note[];
const deleted: string[] = [];
const installed: string[] = [];
const discarded: string[] = [];
/** Group folders the api layer asked about — proves scoping is not bypassed. */
const scopes: string[] = [];

beforeAll(async () => {
  const api: ApiDeps = {
    assistantName: 'ConClaw',
    groupFolder: FOLDER,
    chatJid: CHAT,
    getTasks: () => tasks,
    deleteTask: (id) => {
      deleted.push(id);
      tasks = tasks.filter((t) => t.id !== id);
    },
    getLinks: (folder: string, query: LinkQuery = {}) => {
      scopes.push(folder);
      let rows = links;
      if (query.read !== undefined) {
        rows = rows.filter((l) => (l.read === 1) === query.read);
      }
      return rows;
    },
    updateLink: (folder: string, id: number, fields: LinkUpdate) => {
      scopes.push(folder);
      const row = links.find((l) => l.id === id);
      if (!row) return false;
      if (fields.read !== undefined) row.read = fields.read ? 1 : 0;
      if (fields.tags !== undefined) row.tags = fields.tags;
      if (fields.note !== undefined) row.note = fields.note;
      return true;
    },
    deleteLink: (folder: string, id: number) => {
      scopes.push(folder);
      const before = links.length;
      links = links.filter((l) => l.id !== id);
      return links.length < before;
    },
    countLinks: (_folder: string, read?: boolean) =>
      read === undefined
        ? links.length
        : links.filter((l) => (l.read === 1) === read).length,
    searchHistory: (_jid, q) =>
      history.filter((m) =>
        String(m.content).toLocaleLowerCase().includes(q.toLocaleLowerCase()),
      ),

    readRules: () => rules,
    removeRule: (text) => {
      const before = rules.length;
      rules = rules.filter((r) => r.text !== text);
      return rules.length < before;
    },
    listSkills: () => [{ name: 'notes', description: 'Notes.' }],
    listNotes: () => notes,
    saveNote: (id, input) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return { saved: false, reason: 'not found' };
      Object.assign(note, { title: input.title, body: input.body, tags: input.tags });
      return { saved: true, id };
    },
    createNote: (input) => {
      const id = `General/${input.title}.md`;
      notes.push({ ...input, id, type: 'knowledge', created: null, updated: null });
      return { saved: true, id };
    },
    deleteNote: (id) => {
      const before = notes.length;
      notes = notes.filter((n) => n.id !== id);
      return notes.length < before;
    },
    listProposals: () => proposals,
    readProposal: (name) =>
      proposals.some((p) => p.name === name)
        ? `---\nname: ${name}\ndescription: x\n---\n\n# Полный текст`
        : null,
    promoteSkill: (name) => {
      installed.push(name);
      return { promoted: true };
    },
    rejectSkill: (name) => {
      discarded.push(name);
      return true;
    },
    days: (n) =>
      Array.from({ length: n }, (_, i) => ({
        day: `2026-07-${String(16 + i).padStart(2, '0')}`,
        meetings: i,
        meetingMinutes: i * 30,
        linksSaved: 0,
        linksRead: 0,
        notesTouched: 0,
        messagesFromUser: 0,
        messagesFromBot: 0,
        tasksRun: 0,
      })),
    recentTurns: () => [
      {
        skills: ['notes'],
        tools: { Read: 2, Write: 1 },
        rules: 3,
        startedAt: '2026-07-22T18:00:00.000Z',
        durationMs: 4200,
      },
    ],

    lastRefreshAgeMs: () => 60_000,
  };

  server = http.createServer(
    createHandler({ port: 0, botToken: TOKEN, allowedUserIds: [OWNER], api }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
  tasks = [task(), task({ id: 'sched-morning', prompt: '⏰ Подъём' })];
  links = [
    link({ id: 1, url: 'https://a.com', tags: 'rust' }),
    link({ id: 2, url: 'https://b.com', read: 1, title: 'Про деплой' }),
  ];
  history = [
    {
      id: 'm1',
      chat_jid: CHAT,
      sender: 'u',
      sender_name: 'U',
      content: 'Когда мы говорили про Деплой?',
      timestamp: '2026-07-20T10:00:00.000Z',
      is_from_me: false,
    } as NewMessage,
  ];
  rules = [
    { text: 'Не делегировать сабагенту', learnedAt: '2026-07-22' },
    { text: 'Заметки в General', learnedAt: '2026-07-22' },
  ];
  proposals = [
    {
      name: 'weather-jokes',
      dir: '/tmp/weather-jokes',
      description: 'Шутит про погоду.',
      bytes: 120,
      replaces: false,
      announced: true,
    },
  ];
  installed.length = 0;
  discarded.length = 0;
  notes = [
    {
      id: 'General/Domain.md',
      title: 'Domain',
      body: 'Registrar is Namecheap.',
      tags: ['infra'],
      type: 'knowledge',
      created: '2026-07-01',
      updated: '2026-07-22',
    },
  ];
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function get(p: string, data?: string): Promise<Response> {
  return fetch(base + p, { headers: data ? { [INIT_DATA_HEADER]: data } : {} });
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
    expect(csp).toContain('https://telegram.org');
  });

  // Scripts are bundled now; nothing inline should be permitted to run.
  it('does not allow inline scripts', async () => {
    const csp = (await get('/')).headers.get('content-security-policy') || '';
    expect(csp).toContain("script-src 'self' https://telegram.org");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('answers health checks without auth and without leaking state', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });
});

describe('authentication', () => {
  const reads = [
    '/api/overview',
    '/api/links',
    '/api/tasks',
    '/api/history?q=x',
    '/api/brain',
    '/api/notes',
  ];
  const writes = [
    '/api/links/read',
    '/api/links/update',
    '/api/links/delete',
    '/api/tasks/delete',
    '/api/notes/save',
    '/api/notes/create',
    '/api/notes/delete',
    '/api/rules/forget',
    '/api/skills/install',
    '/api/skills/discard',
  ];

  it('rejects every read route with no initData at all', async () => {
    for (const route of reads) {
      expect((await get(route)).status).toBe(401);
    }
  });

  // The routes that change things matter most, and are the easiest to add
  // without remembering the guard.
  it('rejects every write route with no initData at all', async () => {
    for (const route of writes) {
      const res = await fetch(base + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 1, text: 'hi' }),
      });
      expect(res.status, route).toBe(401);
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
    expect(await json(await get('/api/links', initData(999)))).toEqual({
      error: 'unauthorized',
    });
  });
});

describe('overview', () => {
  it('counts links, unread links and tasks', async () => {
    const body = await json(await get('/api/overview', initData()));
    expect(body.linkCount).toBe(2);
    expect(body.unreadLinkCount).toBe(1);
    expect(body.taskCount).toBe(2);
    expect(body.lastRefreshAgeMs).toBe(60_000);
  });

  // A paused task keeps the next_run it had when it was paused, so it can sit
  // in the past and still sort first. Seen for real on the live install.
  it('leaves paused and past-due tasks out of "upcoming"', async () => {
    tasks = [
      task({ id: 'paused-1', status: 'paused', next_run: '2020-01-01T00:00:00.000Z' }),
      task({ id: 'past-1', next_run: '2020-01-02T00:00:00.000Z' }),
      task({ id: 'future-1', next_run: '2099-01-01T00:00:00.000Z' }),
    ];
    const body = await json(await get('/api/overview', initData()));
    expect(body.upcoming.map((t: { id: string }) => t.id)).toEqual(['future-1']);
    expect(body.taskCount).toBe(3);
  });
});

describe('links', () => {
  it('shows unread by default — the archive exists to be worked through', async () => {
    const body = await json(await get('/api/links', initData()));
    expect(body.links.map((l: { id: number }) => l.id)).toEqual([1]);
  });

  it('can show read and all', async () => {
    const read = await json(await get('/api/links?filter=read', initData()));
    expect(read.links.map((l: { id: number }) => l.id)).toEqual([2]);
    const all = await json(await get('/api/links?filter=all', initData()));
    expect(all.links).toHaveLength(2);
  });

  it('falls back to the default for a filter it does not recognise', async () => {
    const body = await json(await get('/api/links?filter=nonsense', initData()));
    expect(body.links.map((l: { id: number }) => l.id)).toEqual([1]);
  });

  // Otherwise the tag list empties as soon as a tag is picked, with no way back.
  it('offers every tag in use, not just those matching the current filter', async () => {
    const body = await json(await get('/api/links?filter=read', initData()));
    expect(body.tags).toContain('rust');
  });

  it('splits tags into a list', async () => {
    const body = await json(await get('/api/links', initData()));
    expect(body.links[0].tags).toEqual(['rust']);
  });

  it('marks a link read and unread', async () => {
    expect(await json(await post('/api/links/read', { id: 1 }))).toEqual({
      updated: true,
    });
    expect(links.find((l) => l.id === 1)?.read).toBe(1);
    await post('/api/links/read', { id: 1, read: false });
    expect(links.find((l) => l.id === 1)?.read).toBe(0);
  });

  it('sets tags and a note', async () => {
    await post('/api/links/update', { id: 1, tags: 'rust, async', note: 'later' });
    const row = links.find((l) => l.id === 1);
    expect(row?.tags).toBe('rust, async');
    expect(row?.note).toBe('later');
  });

  it('ignores an update carrying no recognised field', async () => {
    expect(await json(await post('/api/links/update', { id: 1, bogus: 'x' }))).toEqual({
      updated: false,
    });
  });

  it('deletes a link', async () => {
    expect(await json(await post('/api/links/delete', { id: 2 }))).toEqual({
      deleted: true,
    });
    expect(links.map((l) => l.id)).toEqual([1]);
  });

  it('rejects a non-numeric id rather than coercing it', async () => {
    expect(await json(await post('/api/links/read', { id: 'abc' }))).toEqual({
      updated: false,
    });
  });

  // The app speaks for one group and must never be able to name another.
  it('scopes every link query to its own group', async () => {
    scopes.length = 0;
    await get('/api/links?filter=all', initData());
    await post('/api/links/read', { id: 1 });
    await post('/api/links/delete', { id: 1 });
    expect(scopes.length).toBeGreaterThan(0);
    expect(new Set(scopes)).toEqual(new Set([FOLDER]));
  });
});

describe('history', () => {
  // The app must not hardcode what the assistant is called.
  it('says who the assistant is, so the app can label its half', async () => {
    const body = await json(await get('/api/history?q=деплой', initData()));
    expect(body.assistantName).toBe('ConClaw');
  });

  it('searches both halves of the conversation', async () => {
    const body = await json(await get('/api/history?q=деплой', initData()));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text).toContain('Деплой');
  });

  // A one-character query matches nearly everything and is never intentional.
  it('returns nothing for a query too short to mean anything', async () => {
    const body = await json(await get('/api/history?q=д', initData()));
    expect(body.messages).toEqual([]);
  });

  it('returns nothing rather than erroring with no query at all', async () => {
    const body = await json(await get('/api/history', initData()));
    expect(body.messages).toEqual([]);
  });
});

describe('tasks', () => {
  it('marks schedule-derived tasks so the app can refuse to delete them', async () => {
    const body = await json(await get('/api/tasks', initData()));
    const derived = body.tasks.find((t: { id: string }) => t.id === 'sched-morning');
    expect(derived.derived).toBe(true);
  });

  // Deleting it would appear to work and then undo itself within the minute.
  it('refuses to delete a task derived from schedule.md', async () => {
    const body = await json(await post('/api/tasks/delete', { id: 'sched-morning' }));
    expect(body.deleted).toBe(false);
    expect(body.reason).toMatch(/schedule\.md/);
    expect(deleted).not.toContain('sched-morning');
  });

  it('deletes an ordinary task', async () => {
    expect(await json(await post('/api/tasks/delete', { id: 'task-1' }))).toEqual({
      deleted: true,
    });
    expect(deleted).toContain('task-1');
  });
});

describe('assets', () => {
  // The only route that turns part of a URL into a filesystem path.
  it('refuses to escape the assets directory', async () => {
    for (const attempt of [
      '/assets/../index.html',
      '/assets/..%2f..%2fpackage.json',
      '/assets/../../../../etc/passwd',
      '/assets/',
    ]) {
      expect((await get(attempt)).status, attempt).toBe(404);
    }
  });

  it('refuses an extension the bundler never emits', async () => {
    expect((await get('/assets/anything.ts')).status).toBe(404);
    expect((await get('/assets/anything.json')).status).toBe(404);
  });

  it('404s a hashed name that does not exist', async () => {
    expect((await get('/assets/index-deadbeef.js')).status).toBe(404);
  });

  it('serves the real bundle the shell asks for, cacheable forever', async () => {
    const shell = await (await get('/')).text();
    const name = /\/assets\/([\w.-]+\.js)/.exec(shell)?.[1];
    expect(name, 'shell should reference a built bundle').toBeTruthy();

    const res = await get(`/assets/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    // Content-hashed, so the file at this name can never change.
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('does not accept writes to an asset path', async () => {
    const res = await fetch(base + '/assets/x.js', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('request handling', () => {
  it('404s an unknown route rather than falling through', async () => {
    expect((await get('/api/nope', initData())).status).toBe(404);
    expect((await get('/../etc/passwd')).status).toBe(404);
  });

  it('refuses an oversized body instead of buffering it', async () => {
    const res = await post('/api/notes/save', { id: 'a', body: 'x'.repeat(20_000) });
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

/**
 * The only window onto what the assistant taught itself. Before this existed
 * a learned rule could not be removed from a phone at all, and a proposed
 * skill was approved on the strength of a single line of description.
 */
describe('days', () => {
  it('returns the requested window', async () => {
    const body = await json(await get('/api/days?n=3', initData()));
    expect(body.days).toHaveLength(3);
    expect(body.days[0].day).toBe('2026-07-16');
  });

  it('defaults to a week when asked for nonsense', async () => {
    expect((await json(await get('/api/days?n=abc', initData()))).days).toHaveLength(7);
    expect((await json(await get('/api/days', initData()))).days).toHaveLength(7);
  });

  // Each call recomputes every bucket, including a walk of the vault.
  it('caps the window instead of accepting any number', async () => {
    const body = await json(await get('/api/days?n=9999', initData()));
    expect(body.days.length).toBeLessThanOrEqual(31);
  });

  it('needs auth like everything else', async () => {
    expect((await get('/api/days')).status).toBe(401);
  });
});

describe('brain', () => {
  it('returns rules, installed skills and pending proposals', async () => {
    const body = await json(await get('/api/brain', initData()));
    expect(body.rules.map((r: Rule) => r.text)).toContain('Не делегировать сабагенту');
    expect(body.skills.map((s: { name: string }) => s.name)).toContain('notes');
    expect(body.proposals[0].name).toBe('weather-jokes');
  });

  // Working out which skill an answer came from used to mean reading docker
  // logs, which is how this install found that a skill had never loaded.
  it('says which skills the last answers actually loaded', async () => {
    const body = await json(await get('/api/brain', initData()));
    expect(body.turns[0].skills).toEqual(['notes']);
    expect(body.turns[0].tools.Read).toBe(2);
    expect(body.turns[0].rules).toBe(3);
  });

  // Approving prose that instructs an agent, having read one line, is not a
  // decision — it is a formality.
  it('carries the whole proposed skill, not just its description', async () => {
    const body = await json(await get('/api/brain', initData()));
    expect(body.proposals[0].content).toContain('# Полный текст');
  });

  it('forgets a rule by its text', async () => {
    expect(
      await json(await post('/api/rules/forget', { text: 'Заметки в General' })),
    ).toEqual({ removed: true });
    const body = await json(await get('/api/brain', initData()));
    expect(body.rules.map((r: Rule) => r.text)).not.toContain('Заметки в General');
  });

  it('reports a rule that was not there rather than claiming success', async () => {
    expect(await json(await post('/api/rules/forget', { text: 'нет такого' }))).toEqual({
      removed: false,
    });
  });

  it('installs and discards a proposed skill', async () => {
    expect(await json(await post('/api/skills/install', { name: 'weather-jokes' })))
      .toEqual({ installed: true, reason: undefined });
    expect(installed).toEqual(['weather-jokes']);

    await post('/api/skills/discard', { name: 'weather-jokes' });
    expect(discarded).toEqual(['weather-jokes']);
  });

  it('refuses an empty name instead of acting on one', async () => {
    expect(await json(await post('/api/skills/install', { name: '' }))).toEqual({
      installed: false,
      reason: 'no name',
    });
    expect(installed).toEqual([]);
  });
});
