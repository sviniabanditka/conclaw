/**
 * The HTTP surface for the Telegram Mini App.
 *
 * This is the only part of ConClaw reachable from outside the pod, so the
 * shape is conservative: a fixed route table, no route parameters, no proxying,
 * and every `/api/` request re-verified against Telegram's signature. There is
 * no session and no cookie — the client resends `initData` each time, so
 * nothing to steal, fixate, or expire on the server.
 *
 * The server refuses to start unless an allowlist is configured. A clean
 * install therefore exposes nothing until someone deliberately names the
 * Telegram accounts allowed in.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from '../logger.js';
import { verifyInitData } from './auth.js';
import {
  ApiDeps,
  brain,
  days,
  deleteTask,
  discardSkill,
  forgetRule,
  installSkill,
  listLinks,
  listTasks,
  overview,
  removeLink,
  searchHistory,
  sendMessage,
  setLinkFields,
  setLinkRead,
} from './api.js';

/** Telegram sends initData in this header; the name is ours, the value is theirs. */
export const INIT_DATA_HEADER = 'x-telegram-init-data';

/** Refuse bodies larger than this — nothing we accept is remotely this big. */
const MAX_BODY_BYTES = 8 * 1024;

export interface MiniAppServerOptions {
  port: number;
  botToken: string;
  allowedUserIds: number[];
  api: ApiDeps;
  /** Bind address. Defaults to all interfaces, which is what a k8s Service needs. */
  host?: string;
}

/**
 * Content-Security-Policy for the app shell.
 *
 * `frame-ancestors` has to name Telegram's web clients: on desktop and mobile
 * the Mini App runs in a native webview, but Telegram Web loads it in an
 * iframe, and a blanket `DENY` shows an empty box there with no error.
 * `script-src` allows telegram.org because the Mini App SDK is served from it.
 *
 * Scripts are bundled files served from this origin, so no inline script is
 * permitted. Styles still need `unsafe-inline`: React and Radix set element
 * styles directly for measured layout and transitions.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  'frame-ancestors https://web.telegram.org https://webk.telegram.org https://webz.telegram.org',
].join('; ');

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Stop reading rather than buffering an unbounded upload.
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

/** Anything unrecognised falls back to the default rather than erroring. */
function asFilter(raw: string | null): 'unread' | 'read' | 'all' | undefined {
  return raw === 'read' || raw === 'all' || raw === 'unread' ? raw : undefined;
}

/** Resolved from this module so it works the same in dist/ and under vitest. */
function publicDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
}

function appShellPath(): string {
  return path.join(publicDir(), 'index.html');
}

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

/**
 * Serve one of the bundler's output files.
 *
 * Two independent guards, because this is the only route that turns part of a
 * URL into a filesystem path: the resolved path must stay inside the assets
 * directory, and the extension must be one the bundle actually emits. Either
 * alone would do; together a mistake in one is not a traversal.
 *
 * Names are content-hashed, so a hit can be cached forever — the file at a
 * given name never changes, and a new build produces a new name.
 */
function serveAsset(res: http.ServerResponse, name: string): void {
  const dir = path.join(publicDir(), 'assets');
  const file = path.resolve(dir, name);
  const type = ASSET_TYPES[path.extname(file)];

  if (!file.startsWith(dir + path.sep) || !type) {
    send(res, 404, { error: 'not found' });
    return;
  }

  let body: Buffer;
  try {
    body = fs.readFileSync(file);
  } catch {
    send(res, 404, { error: 'not found' });
    return;
  }

  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * Build the request handler. Exported separately from {@link startMiniAppServer}
 * so tests can drive it without binding a port.
 */
export function createHandler(
  opts: MiniAppServerOptions,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    void handle(req, res, opts).catch((err) => {
      logger.debug({ err }, 'Mini App request failed');
      if (!res.headersSent) send(res, 500, { error: 'server error' });
    });
  };
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: MiniAppServerOptions,
): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const route = url.pathname.replace(/\/+$/, '') || '/';

  // Unauthenticated, and deliberately says nothing about the app's state — it
  // exists so Kubernetes can tell the process is alive.
  if (route === '/healthz') {
    send(res, 200, { ok: true });
    return;
  }

  if (route === '/') {
    if (req.method !== 'GET') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }
    // The shell itself carries no data — everything comes from /api/ once
    // Telegram has handed the page its initData — so it needs no auth.
    let html: string;
    try {
      html = fs.readFileSync(appShellPath(), 'utf-8');
    } catch (err) {
      logger.error({ err }, 'Mini App shell missing');
      send(res, 500, { error: 'server error' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(html);
    return;
  }

  if (route.startsWith('/assets/')) {
    if (req.method !== 'GET') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }
    serveAsset(res, route.slice('/assets/'.length));
    return;
  }

  if (!route.startsWith('/api/')) {
    send(res, 404, { error: 'not found' });
    return;
  }

  const initData = req.headers[INIT_DATA_HEADER];
  const verified = verifyInitData(
    typeof initData === 'string' ? initData : '',
    opts.botToken,
    { allowedUserIds: opts.allowedUserIds },
  );
  if (!verified.ok) {
    // The reason goes to the log, never to the client: a prober should not
    // learn which half of the check turned them away.
    logger.warn({ route, reason: verified.reason }, 'Mini App request rejected');
    send(res, 401, { error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    switch (route) {
      case '/api/overview':
        send(res, 200, overview(opts.api));
        return;
      case '/api/links':
        send(
          res,
          200,
          listLinks(opts.api, {
            q: url.searchParams.get('q') ?? undefined,
            tag: url.searchParams.get('tag') ?? undefined,
            filter: asFilter(url.searchParams.get('filter')),
          }),
        );
        return;
      case '/api/tasks':
        send(res, 200, { tasks: listTasks(opts.api) });
        return;
      case '/api/history':
        send(res, 200, searchHistory(opts.api, url.searchParams.get('q') ?? ''));
        return;
      case '/api/brain':
        send(res, 200, brain(opts.api));
        return;
      case '/api/days':
        send(res, 200, days(opts.api, Number(url.searchParams.get('n') ?? 7)));
        return;
    }
  }

  if (req.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) as Record<string, unknown>;
    } catch {
      send(res, 400, { error: 'bad request' });
      return;
    }
    switch (route) {
      case '/api/links/read':
        send(
          res,
          200,
          setLinkRead(opts.api, Number(body.id), body.read !== false),
        );
        return;
      case '/api/links/update':
        send(res, 200, setLinkFields(opts.api, Number(body.id), body));
        return;
      case '/api/links/delete':
        send(res, 200, removeLink(opts.api, Number(body.id)));
        return;
      case '/api/tasks/delete':
        send(res, 200, deleteTask(opts.api, String(body.id ?? '')));
        return;
      case '/api/message':
        send(res, 200, sendMessage(opts.api, String(body.text ?? '')));
        return;
      case '/api/rules/forget':
        send(res, 200, forgetRule(opts.api, String(body.text ?? '')));
        return;
      case '/api/skills/install':
        send(res, 200, installSkill(opts.api, String(body.name ?? '')));
        return;
      case '/api/skills/discard':
        send(res, 200, discardSkill(opts.api, String(body.name ?? '')));
        return;
    }
  }

  send(res, 404, { error: 'not found' });
}

/**
 * Start the server, or don't.
 *
 * Returns null when the app is not configured — no allowlist, no token, no
 * port. Silence is the right outcome there: an unconfigured install should not
 * open a port at all, and the caller logs the reason.
 */
export function startMiniAppServer(
  opts: MiniAppServerOptions,
): http.Server | null {
  if (!opts.port) return null;
  if (!opts.botToken) {
    logger.warn('Mini App not started: no Telegram bot token to verify against');
    return null;
  }
  if (opts.allowedUserIds.length === 0) {
    logger.warn(
      'Mini App not started: MINIAPP_ALLOWED_USER_IDS is empty, which would expose it to every Telegram user',
    );
    return null;
  }

  const server = http.createServer(createHandler(opts));
  server.on('error', (err) => logger.error({ err }, 'Mini App server error'));
  server.listen(opts.port, opts.host ?? '0.0.0.0', () => {
    logger.info(
      { port: opts.port, allowedUsers: opts.allowedUserIds.length },
      'Mini App server listening',
    );
  });
  return server;
}
