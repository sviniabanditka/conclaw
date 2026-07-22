/**
 * Making a saved link legible before anyone has described it.
 *
 * A list of bare URLs is no better than the chat scrollback — you have to open
 * each one to find out what it is. The evening digest eventually writes a real
 * description, but that needs a model and happens hours later; a title and a
 * favicon need neither and can be had the moment the link arrives.
 *
 * The icon is stored as a data URI rather than a URL. The Mini App's CSP allows
 * `img-src 'self' data:` and nothing else, so an external favicon host would be
 * blocked — and relaxing the policy to let arbitrary sites load images inside
 * the app is a poor trade for a 16×16 picture.
 */
import { logger } from './logger.js';

/** Enough for a favicon; anything larger is a logo we do not need. */
export const MAX_ICON_BYTES = 32 * 1024;
/** Titles are for a list row, not for storage. */
export const MAX_TITLE_LENGTH = 200;
const FETCH_TIMEOUT_MS = 12_000;
/** Only ever read the head of a page — titles live there and pages can be huge. */
const MAX_HTML_BYTES = 256 * 1024;

export interface LinkPreview {
  title: string | null;
  icon: string | null;
}

export interface EnrichDeps {
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith('#x')) {
      return String.fromCodePoint(parseInt(key.slice(2), 16));
    }
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return whole;
  });
}

/**
 * The page's title.
 *
 * `og:title` first: it is what the author chose for a link preview, which is
 * exactly this use, and it is usually free of the " | Site Name" tail.
 */
export function extractTitle(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html);
  const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = og?.[1] ?? tag?.[1];
  if (!raw) return null;
  const clean = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, MAX_TITLE_LENGTH) : null;
}

/** Candidate icon URLs, best first, resolved against the page. */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (href: string) => {
    try {
      const url = new URL(href, pageUrl);
      // A page can put anything in href — `javascript:`, `data:`, `file:` all
      // resolve happily. Only the two schemes worth fetching get through.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      const resolved = url.toString();
      if (!seen.has(resolved)) {
        seen.add(resolved);
        out.push(resolved);
      }
    } catch {
      // A malformed href is one candidate lost, not a failure.
    }
  };

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["'][^"']*icon/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) push(href);
  }
  // Every site is meant to answer here even with no <link> tag at all.
  push('/favicon.ico');
  return out;
}

async function fetchWithTimeout(
  impl: typeof fetch,
  url: string,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await impl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'ConClaw/1.0 (+link preview)' },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a title and an icon for one link.
 *
 * Never throws: a link that cannot be reached still belongs in the archive,
 * and the caller marks it fetched either way so a dead host is not retried
 * forever.
 */
export async function fetchPreview(
  url: string,
  deps: EnrichDeps = {},
): Promise<LinkPreview> {
  const impl = deps.fetchImpl ?? fetch;
  const empty: LinkPreview = { title: null, icon: null };

  const res = await fetchWithTimeout(impl, url);
  if (!res || !res.ok) return empty;

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('html')) return empty;

  const buf = await res.arrayBuffer().catch(() => null);
  if (!buf) return empty;
  const html = Buffer.from(buf.slice(0, MAX_HTML_BYTES)).toString('utf-8');

  const title = extractTitle(html);
  const finalUrl = res.url || url;

  for (const candidate of iconCandidates(html, finalUrl)) {
    const iconRes = await fetchWithTimeout(impl, candidate);
    if (!iconRes || !iconRes.ok) continue;
    const iconType = iconRes.headers.get('content-type') ?? '';
    if (!iconType.startsWith('image/')) continue;
    const bytes = await iconRes.arrayBuffer().catch(() => null);
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) {
      continue;
    }
    const base64 = Buffer.from(bytes).toString('base64');
    return { title, icon: `data:${iconType.split(';')[0]};base64,${base64}` };
  }

  return { title, icon: null };
}

export interface EnrichRow {
  id: number;
  url: string;
  title: string | null;
}

export interface LinkEnricherDeps {
  pending: () => EnrichRow[];
  update: (
    id: number,
    fields: { title?: string; icon?: string | null; enriched_at: string },
  ) => void;
  intervalMs: number;
  preview?: (url: string) => Promise<LinkPreview>;
  now?: () => number;
}

/**
 * Fills in previews in the background, a few at a time.
 *
 * Sequential on purpose: this runs beside the bot on one small box, and a
 * burst of pasted links should not turn into twenty simultaneous fetches.
 */
export class LinkEnricher {
  private deps: LinkEnricherDeps;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(deps: LinkEnricherDeps) {
    this.deps = deps;
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      for (const row of this.deps.pending()) {
        const preview = await (this.deps.preview ?? fetchPreview)(row.url);
        const at = new Date((this.deps.now ?? Date.now)()).toISOString();
        this.deps.update(row.id, {
          // A title the agent already wrote is a considered one; the fetched
          // title is only a stand-in until then.
          ...(preview.title && !row.title ? { title: preview.title } : {}),
          icon: preview.icon,
          enriched_at: at,
        });
        done += 1;
      }
    } finally {
      this.running = false;
    }
    return done;
  }

  start(): void {
    const tick = () => {
      this.runOnce().then(
        (n) => {
          if (n > 0) logger.info({ enriched: n }, 'Link previews fetched');
        },
        (err) => logger.debug({ err }, 'Link enrichment failed'),
      );
    };
    tick();
    this.timer = setInterval(tick, this.deps.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
