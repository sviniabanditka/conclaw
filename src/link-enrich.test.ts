/**
 * Link previews.
 *
 * Two things matter beyond parsing: a link that cannot be reached must still
 * end up marked as tried — otherwise a dead host is refetched forever — and a
 * title someone wrote by hand must survive, because a fetched one is only a
 * stand-in until then.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  LinkEnricher,
  MAX_ICON_BYTES,
  extractTitle,
  fetchPreview,
  iconCandidates,
  type LinkEnricherDeps,
} from './link-enrich.js';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function html(body: string): string {
  return `<!doctype html><html><head>${body}</head><body></body></html>`;
}

/** A fetch that answers from a map of url → [status, contentType, body]. */
function fakeFetch(
  routes: Record<string, [number, string, string | Uint8Array]>,
): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, url, headers: new Headers() } as Response;
    const [status, type, body] = hit;
    const bytes =
      typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return {
      ok: status >= 200 && status < 300,
      status,
      url,
      headers: new Headers({ 'content-type': type }),
      arrayBuffer: async () => bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    } as unknown as Response;
  }) as typeof fetch;
}

describe('extractTitle', () => {
  it('reads a plain <title>', () => {
    expect(extractTitle(html('<title>Hello world</title>'))).toBe('Hello world');
  });

  // og:title is what the author chose for a link preview — exactly this use —
  // and usually lacks the " | Site Name" tail.
  it('prefers og:title over <title>', () => {
    const page = html(
      '<title>Post | Blog | Company</title>' +
        '<meta property="og:title" content="Post">',
    );
    expect(extractTitle(page)).toBe('Post');
  });

  it('decodes entities and collapses whitespace', () => {
    expect(extractTitle(html('<title>Rock &amp;\n  Roll</title>'))).toBe('Rock & Roll');
    expect(extractTitle(html('<title>caf&#233;</title>'))).toBe('café');
  });

  it('is null when there is no title at all', () => {
    expect(extractTitle(html(''))).toBeNull();
    expect(extractTitle(html('<title>   </title>'))).toBeNull();
  });
});

describe('iconCandidates', () => {
  it('resolves relative hrefs against the page', () => {
    const got = iconCandidates(
      html('<link rel="icon" href="/static/fav.png">'),
      'https://example.com/blog/post',
    );
    expect(got[0]).toBe('https://example.com/static/fav.png');
  });

  // Every site is meant to answer there even with no <link> tag.
  it('always falls back to /favicon.ico', () => {
    expect(iconCandidates(html(''), 'https://example.com/x')).toEqual([
      'https://example.com/favicon.ico',
    ]);
  });

  it('takes apple-touch-icon and shortcut icon too, without duplicates', () => {
    const got = iconCandidates(
      html(
        '<link rel="shortcut icon" href="/a.ico">' +
          '<link rel="apple-touch-icon" href="/b.png">' +
          '<link rel="icon" href="/a.ico">',
      ),
      'https://example.com/',
    );
    expect(got).toEqual([
      'https://example.com/a.ico',
      'https://example.com/b.png',
      'https://example.com/favicon.ico',
    ]);
  });

  it('ignores stylesheets and unresolvable hrefs', () => {
    const got = iconCandidates(
      html('<link rel="stylesheet" href="/s.css"><link rel="icon" href="http://">'),
      'https://example.com/',
    );
    expect(got).toEqual(['https://example.com/favicon.ico']);
  });

  // A page can put anything in href, and all of these resolve happily.
  it('refuses schemes that should never be fetched', () => {
    const got = iconCandidates(
      html(
        '<link rel="icon" href="javascript:void(0)">' +
          '<link rel="icon" href="file:///etc/passwd">',
      ),
      'https://example.com/',
    );
    expect(got).toEqual(['https://example.com/favicon.ico']);
  });
});

describe('fetchPreview', () => {
  const PAGE = 'https://example.com/post';

  it('returns a title and the icon as a data URI', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const preview = await fetchPreview(PAGE, {
      fetchImpl: fakeFetch({
        [PAGE]: [200, 'text/html; charset=utf-8', html('<title>Post</title><link rel="icon" href="/f.png">')],
        'https://example.com/f.png': [200, 'image/png', png],
      }),
    });
    expect(preview.title).toBe('Post');
    // External image hosts are blocked by the app's CSP, so it has to be inline.
    expect(preview.icon).toMatch(/^data:image\/png;base64,/);
  });

  it('keeps the title when no icon can be had', async () => {
    const preview = await fetchPreview(PAGE, {
      fetchImpl: fakeFetch({ [PAGE]: [200, 'text/html', html('<title>Post</title>')] }),
    });
    expect(preview.title).toBe('Post');
    expect(preview.icon).toBeNull();
  });

  it('skips an icon that is too large to be one', async () => {
    const huge = new Uint8Array(MAX_ICON_BYTES + 1);
    const preview = await fetchPreview(PAGE, {
      fetchImpl: fakeFetch({
        [PAGE]: [200, 'text/html', html('<title>P</title><link rel="icon" href="/f.png">')],
        'https://example.com/f.png': [200, 'image/png', huge],
      }),
    });
    expect(preview.icon).toBeNull();
  });

  it('refuses a candidate that is not an image', async () => {
    const preview = await fetchPreview(PAGE, {
      fetchImpl: fakeFetch({
        [PAGE]: [200, 'text/html', html('<link rel="icon" href="/f.png">')],
        'https://example.com/f.png': [200, 'text/html', '<html>404 page</html>'],
      }),
    });
    expect(preview.icon).toBeNull();
  });

  // A link that cannot be reached still belongs in the archive.
  it('returns empty rather than throwing on a dead host', async () => {
    const dead = (async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    expect(await fetchPreview(PAGE, { fetchImpl: dead })).toEqual({
      title: null,
      icon: null,
    });
  });

  it('ignores a response that is not HTML', async () => {
    const preview = await fetchPreview(PAGE, {
      fetchImpl: fakeFetch({ [PAGE]: [200, 'application/pdf', 'binary'] }),
    });
    expect(preview).toEqual({ title: null, icon: null });
  });
});

describe('LinkEnricher', () => {
  function deps(over: Partial<LinkEnricherDeps> = {}): LinkEnricherDeps {
    return {
      pending: () => [{ id: 1, url: 'https://a.com', title: null }],
      update: vi.fn(),
      intervalMs: 60_000,
      preview: async () => ({ title: 'Fetched', icon: 'data:image/png;base64,AA' }),
      now: () => 1_700_000_000_000,
      ...over,
    };
  }

  function calls(fn: unknown): unknown[][] {
    return (fn as { mock: { calls: unknown[][] } }).mock.calls;
  }

  it('writes the title, the icon and the time it was tried', async () => {
    const d = deps();
    expect(await new LinkEnricher(d).runOnce()).toBe(1);
    const [id, fields] = calls(d.update)[0] as [number, Record<string, unknown>];
    expect(id).toBe(1);
    expect(fields.title).toBe('Fetched');
    expect(fields.icon).toBe('data:image/png;base64,AA');
    expect(fields.enriched_at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  // A title someone wrote deliberately outranks one scraped from a <title> tag.
  it('does not overwrite a title that is already there', async () => {
    const d = deps({
      pending: () => [{ id: 1, url: 'https://a.com', title: 'Written by hand' }],
    });
    await new LinkEnricher(d).runOnce();
    expect((calls(d.update)[0][1] as Record<string, unknown>).title).toBeUndefined();
  });

  // Otherwise a dead host is refetched on every pass, forever.
  it('marks a link tried even when nothing could be fetched', async () => {
    const d = deps({ preview: async () => ({ title: null, icon: null }) });
    await new LinkEnricher(d).runOnce();
    const fields = calls(d.update)[0][1] as Record<string, unknown>;
    expect(fields.enriched_at).toBeTruthy();
    expect(fields.icon).toBeNull();
  });

  it('does nothing when there is nothing pending', async () => {
    const d = deps({ pending: () => [] });
    expect(await new LinkEnricher(d).runOnce()).toBe(0);
    expect(d.update).not.toHaveBeenCalled();
  });

  // One small box also running the bot: a burst of pasted links must not
  // become a burst of simultaneous fetches.
  it('will not start a second pass while one is running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const d = deps({
      preview: async () => {
        await gate;
        return { title: 'x', icon: null };
      },
    });
    const enricher = new LinkEnricher(d);
    const first = enricher.runOnce();
    expect(await enricher.runOnce()).toBe(0);
    release();
    expect(await first).toBe(1);
  });
});
