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
import { ApiDeps, archiveLink, deleteTask, listLinks, listTasks, overview } from './api.js';

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
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://telegram.org",
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

function appShellPath(): string {
  // Resolved from this module so it works the same in dist/ and under vitest.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'public', 'index.html');
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
        send(res, 200, { links: listLinks(opts.api) });
        return;
      case '/api/tasks':
        send(res, 200, { tasks: listTasks(opts.api) });
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
      case '/api/links/archive':
        send(res, 200, archiveLink(opts.api, String(body.url ?? '')));
        return;
      case '/api/tasks/delete':
        send(res, 200, deleteTask(opts.api, String(body.id ?? '')));
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
