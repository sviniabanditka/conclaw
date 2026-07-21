/**
 * Capturing bare links.
 *
 * Everything hinges on one distinction: a message that is only links is
 * something to read later, while a link sent with a question is a question.
 * Getting that wrong means the bot silently swallows things people asked it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  extractBareLinks,
  appendLinks,
  readLinks,
  linksFilePath,
} from './link-capture.js';

describe('extractBareLinks', () => {
  it('captures a lone link', () => {
    expect(extractBareLinks('https://example.com/a')).toEqual([
      'https://example.com/a',
    ]);
  });

  it('captures several links in one message', () => {
    expect(
      extractBareLinks('https://a.com  https://b.com/x?y=1'),
    ).toEqual(['https://a.com', 'https://b.com/x?y=1']);
  });

  // The case that must never be swallowed.
  it('ignores a link sent with a question', () => {
    expect(extractBareLinks('что думаешь про https://example.com ?')).toBeNull();
    expect(extractBareLinks('https://example.com — почитай')).toBeNull();
    expect(extractBareLinks('summarize https://example.com')).toBeNull();
  });

  it('tolerates punctuation and emoji around links', () => {
    expect(extractBareLinks('https://example.com 👀')).toEqual([
      'https://example.com',
    ]);
    expect(extractBareLinks('(https://example.com)')).toEqual([
      'https://example.com',
    ]);
  });

  it('trims trailing punctuation from the url itself', () => {
    expect(extractBareLinks('https://example.com/page.')).toEqual([
      'https://example.com/page',
    ]);
  });

  it('ignores messages with no link', () => {
    expect(extractBareLinks('привет')).toBeNull();
    expect(extractBareLinks('')).toBeNull();
    expect(extractBareLinks('   ')).toBeNull();
  });

  it('ignores a bare domain without a scheme', () => {
    // Too easy to confuse with ordinary prose containing a dot.
    expect(extractBareLinks('example.com')).toBeNull();
  });
});

describe('link storage', () => {
  const dirs: string[] = [];
  function tmpFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'));
    dirs.push(dir);
    return linksFilePath(dir);
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('round-trips captured links', () => {
    const file = tmpFile();
    appendLinks(file, ['https://a.com', 'https://b.com'], 1_700_000_000_000);
    const got = readLinks(file);
    expect(got.map((l) => l.url)).toEqual(['https://a.com', 'https://b.com']);
    expect(got[0].at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('accumulates across messages', () => {
    const file = tmpFile();
    appendLinks(file, ['https://a.com'], 1);
    appendLinks(file, ['https://b.com'], 2);
    expect(readLinks(file)).toHaveLength(2);
  });

  it('is empty rather than failing when nothing was captured', () => {
    expect(readLinks(tmpFile())).toEqual([]);
  });

  it('writes nothing for an empty list', () => {
    const file = tmpFile();
    appendLinks(file, [], 1);
    expect(fs.existsSync(file)).toBe(false);
  });

  // One bad line should cost one link, not the whole day's collection.
  it('skips a corrupt line and keeps the rest', () => {
    const file = tmpFile();
    appendLinks(file, ['https://a.com'], 1);
    fs.appendFileSync(file, 'not json\n');
    appendLinks(file, ['https://b.com'], 2);
    expect(readLinks(file).map((l) => l.url)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});
