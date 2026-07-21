/**
 * The link archive.
 *
 * Two things here are easy to get wrong and invisible when they are: the
 * upsert, which decides what happens when you send the same link twice, and
 * the search, which has to fold case in Cyrillic — SQLite's own `LIKE` and
 * `lower()` do not, which is why the filtering happens in JavaScript.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  addLink,
  countLinks,
  deleteLink,
  getLinks,
  linkDomain,
  searchMessages,
  splitTags,
  storeChatMetadata,
  storeMessage,
  updateLink,
} from './db.js';

const G = 'telegram_main';
const OTHER = 'telegram_other';

beforeEach(() => {
  _initTestDatabase();
});

describe('addLink', () => {
  it('stores a link with its domain', () => {
    addLink(G, 'https://www.example.com/a/b?c=1', '2026-07-21T10:00:00.000Z');
    const [row] = getLinks(G);
    expect(row.url).toBe('https://www.example.com/a/b?c=1');
    expect(row.domain).toBe('example.com');
    expect(row.read).toBe(0);
  });

  it('does not duplicate a link sent twice', () => {
    addLink(G, 'https://a.com', '2026-07-21T10:00:00.000Z');
    addLink(G, 'https://a.com', '2026-07-21T12:00:00.000Z');
    expect(getLinks(G)).toHaveLength(1);
  });

  // Sending it again is deliberate — it should come back, not be swallowed.
  it('brings a read link back as unread when it is sent again', () => {
    addLink(G, 'https://a.com', '2026-07-21T10:00:00.000Z');
    const [row] = getLinks(G);
    updateLink(G, row.id, { read: true });
    expect(countLinks(G, false)).toBe(0);

    addLink(G, 'https://a.com', '2026-07-22T10:00:00.000Z');
    expect(countLinks(G, false)).toBe(1);
    // But it is still the same link, saved when it was first saved.
    expect(getLinks(G)[0].added_at).toBe('2026-07-21T10:00:00.000Z');
    expect(getLinks(G)[0].read_at).toBeNull();
  });

  it('keeps groups separate', () => {
    addLink(G, 'https://a.com');
    addLink(OTHER, 'https://a.com');
    expect(getLinks(G)).toHaveLength(1);
    expect(getLinks(OTHER)).toHaveLength(1);
  });

  it('stores a link whose URL will not parse, without a domain', () => {
    addLink(G, 'https://');
    expect(getLinks(G)[0].domain).toBeNull();
  });
});

describe('getLinks', () => {
  beforeEach(() => {
    addLink(G, 'https://a.com', '2026-07-21T10:00:00.000Z');
    addLink(G, 'https://b.com', '2026-07-21T11:00:00.000Z');
    const [newest] = getLinks(G);
    updateLink(G, newest.id, {
      read: true,
      title: 'Про Деплой',
      tags: 'Rust, ops',
    });
  });

  it('returns newest first', () => {
    expect(getLinks(G).map((l) => l.url)).toEqual([
      'https://b.com',
      'https://a.com',
    ]);
  });

  it('filters by read state', () => {
    expect(getLinks(G, { read: false }).map((l) => l.url)).toEqual(['https://a.com']);
    expect(getLinks(G, { read: true }).map((l) => l.url)).toEqual(['https://b.com']);
  });

  // The reason the search is not SQL: SQLite folds case for ASCII only.
  it('searches case-insensitively in Cyrillic', () => {
    expect(getLinks(G, { q: 'деплой' })).toHaveLength(1);
    expect(getLinks(G, { q: 'ДЕПЛОЙ' })).toHaveLength(1);
  });

  it('searches the url as well as the title', () => {
    expect(getLinks(G, { q: 'a.com' }).map((l) => l.url)).toEqual(['https://a.com']);
  });

  it('matches tags regardless of case', () => {
    expect(getLinks(G, { tag: 'rust' })).toHaveLength(1);
    expect(getLinks(G, { tag: 'RUST' })).toHaveLength(1);
    expect(getLinks(G, { tag: 'nope' })).toHaveLength(0);
  });

  it('applies the limit last, after filtering', () => {
    expect(getLinks(G, { limit: 1 })).toHaveLength(1);
    expect(getLinks(G, { q: 'деплой', limit: 5 })).toHaveLength(1);
  });
});

describe('updateLink', () => {
  it('records when a link was marked read, and clears it when unread', () => {
    addLink(G, 'https://a.com');
    const [row] = getLinks(G);
    updateLink(G, row.id, { read: true }, '2026-07-22T09:00:00.000Z');
    expect(getLinks(G)[0].read_at).toBe('2026-07-22T09:00:00.000Z');
    updateLink(G, row.id, { read: false });
    expect(getLinks(G)[0].read_at).toBeNull();
  });

  it('refuses to touch another group\'s link', () => {
    addLink(OTHER, 'https://a.com');
    const [row] = getLinks(OTHER);
    expect(updateLink(G, row.id, { read: true })).toBe(false);
    expect(getLinks(OTHER)[0].read).toBe(0);
  });

  it('does nothing when given no fields', () => {
    addLink(G, 'https://a.com');
    expect(updateLink(G, getLinks(G)[0].id, {})).toBe(false);
  });
});

describe('deleteLink', () => {
  it('deletes only within the group', () => {
    addLink(OTHER, 'https://a.com');
    const [row] = getLinks(OTHER);
    expect(deleteLink(G, row.id)).toBe(false);
    expect(deleteLink(OTHER, row.id)).toBe(true);
    expect(getLinks(OTHER)).toHaveLength(0);
  });
});

describe('countLinks', () => {
  it('counts all, read and unread', () => {
    addLink(G, 'https://a.com');
    addLink(G, 'https://b.com');
    updateLink(G, getLinks(G)[0].id, { read: true });
    expect(countLinks(G)).toBe(2);
    expect(countLinks(G, true)).toBe(1);
    expect(countLinks(G, false)).toBe(1);
  });
});

describe('splitTags and linkDomain', () => {
  it('splits and trims, dropping empties', () => {
    expect(splitTags(' rust , , ops ')).toEqual(['rust', 'ops']);
    expect(splitTags(null)).toEqual([]);
  });

  it('strips www but keeps other subdomains', () => {
    expect(linkDomain('https://www.a.com/x')).toBe('a.com');
    expect(linkDomain('https://docs.a.com/x')).toBe('docs.a.com');
    expect(linkDomain('not a url')).toBeNull();
  });
});

describe('searchMessages', () => {
  beforeEach(() => {
    storeChatMetadata('tg:1', '2026-07-20T10:00:00.000Z');
    storeMessage({
      id: 'm1',
      chat_jid: 'tg:1',
      sender: 'u',
      sender_name: 'U',
      content: 'Когда мы говорили про Деплой?',
      timestamp: '2026-07-20T10:00:00.000Z',
      is_from_me: false,
    });
    storeMessage({
      id: 'm2',
      chat_jid: 'tg:1',
      sender: 'bot',
      sender_name: 'Andy',
      content: 'Мы обсуждали деплой во вторник.',
      timestamp: '2026-07-20T10:01:00.000Z',
      is_from_me: false,
      is_bot_message: true,
    });
  });

  // Both halves, or the search answers "what did I ask" but never "what was I told".
  it('finds messages from the user and from the bot', () => {
    const found = searchMessages('tg:1', 'деплой');
    expect(found).toHaveLength(2);
    expect(found.some((m) => m.is_bot_message)).toBe(true);
  });

  it('folds case in Cyrillic', () => {
    expect(searchMessages('tg:1', 'ДЕПЛОЙ')).toHaveLength(2);
  });

  it('returns newest first and respects the limit', () => {
    const found = searchMessages('tg:1', 'деплой', 1);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('m2');
  });

  it('is empty for a blank query rather than returning everything', () => {
    expect(searchMessages('tg:1', '   ')).toEqual([]);
  });

  it('does not reach into another chat', () => {
    expect(searchMessages('tg:2', 'деплой')).toEqual([]);
  });
});
