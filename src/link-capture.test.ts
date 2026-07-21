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
  linksFilePath,
  migrateLinksFile,
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

describe('migrateLinksFile', () => {
  const dirs: string[] = [];
  function tmpFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'));
    dirs.push(dir);
    return linksFilePath(dir);
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function write(file: string, entries: { url: string; at: string }[]): void {
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  it('imports every link with the time it was saved', () => {
    const file = tmpFile();
    write(file, [
      { url: 'https://a.com', at: '2026-07-21T10:00:00.000Z' },
      { url: 'https://b.com', at: '2026-07-21T11:00:00.000Z' },
    ]);
    const seen: string[][] = [];
    expect(migrateLinksFile(file, (url, at) => seen.push([url, at]))).toBe(2);
    expect(seen).toEqual([
      ['https://a.com', '2026-07-21T10:00:00.000Z'],
      ['https://b.com', '2026-07-21T11:00:00.000Z'],
    ]);
  });

  // The import runs on every start, so "already done" has to be unambiguous.
  it('moves the file aside so a restart does not import it twice', () => {
    const file = tmpFile();
    write(file, [{ url: 'https://a.com', at: '2026-07-21T10:00:00.000Z' }]);
    migrateLinksFile(file, () => {});
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(file + '.imported')).toBe(true);

    const second: string[] = [];
    expect(migrateLinksFile(file, (url) => second.push(url))).toBe(0);
    expect(second).toEqual([]);
  });

  // Keeping the original means a botched import can be redone by hand.
  it('keeps the original contents in the renamed file', () => {
    const file = tmpFile();
    write(file, [{ url: 'https://a.com', at: '2026-07-21T10:00:00.000Z' }]);
    migrateLinksFile(file, () => {});
    expect(fs.readFileSync(file + '.imported', 'utf-8')).toContain('https://a.com');
  });

  it('does nothing at all when there is no file', () => {
    expect(migrateLinksFile(tmpFile(), () => {})).toBe(0);
  });

  it('skips a corrupt line and still imports the rest', () => {
    const file = tmpFile();
    fs.writeFileSync(
      file,
      JSON.stringify({ url: 'https://a.com', at: '1' }) + '\nnot json\n' +
        JSON.stringify({ url: 'https://b.com', at: '2' }) + '\n',
    );
    const seen: string[] = [];
    expect(migrateLinksFile(file, (url) => seen.push(url))).toBe(2);
    expect(seen).toEqual(['https://a.com', 'https://b.com']);
  });
});
