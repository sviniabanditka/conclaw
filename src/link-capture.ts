/**
 * Collect links thrown into the chat without answering each one.
 *
 * Links get sent to be "looked at later" and then never are. Answering each
 * immediately is worse than useless — it interrupts, costs a container, and the
 * reply is read even less than the link would have been.
 *
 * So a message that is *only* links is captured silently and acknowledged with a
 * reaction; the archive lives in the database and an evening task reports on it
 * once. A link sent with a question is not this — that is a question, and goes
 * to the agent as normal.
 *
 * What remains here is the recognising, plus the one-time import of the JSONL
 * file the archive used to be.
 */
import fs from 'fs';
import path from 'path';

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/**
 * URLs from a message that carries nothing else, or null if it does.
 *
 * The distinction is the whole feature: "https://…" is a link to read later,
 * while "что думаешь про https://… ?" is a question and must not be swallowed.
 * Punctuation and emoji around the links are tolerated; words are not.
 */
export function extractBareLinks(content: string): string[] | null {
  const text = content.trim();
  if (!text) return null;

  const urls = text.match(URL_PATTERN);
  if (!urls || urls.length === 0) return null;

  // Strip the URLs and see whether anything meaningful is left.
  let rest = text;
  for (const url of urls) rest = rest.replace(url, ' ');
  // Letters or digits left over mean the user wrote something.
  if (/[\p{L}\p{N}]/u.test(rest)) return null;

  return urls.map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
}

export interface CapturedLink {
  url: string;
  at: string;
}

export function linksFilePath(groupDir: string): string {
  return path.join(groupDir, 'links.jsonl');
}

/**
 * Import a pre-database `links.jsonl` and take it out of the way.
 *
 * Links used to live in this file with only a URL and a timestamp. The archive
 * now lives in SQLite, where it can carry a title, tags and a read flag — but
 * an install that ran before the move still has a file, and dropping it would
 * lose links its owner deliberately saved.
 *
 * The file is renamed rather than deleted: the import runs on every start, so
 * it needs an unambiguous "already done", and keeping the original means a
 * botched import is recoverable by hand.
 */
export function migrateLinksFile(
  file: string,
  importLink: (url: string, at: string) => void,
): number {
  if (!fs.existsSync(file)) return 0;
  const links = readLinks(file);
  for (const link of links) importLink(link.url, link.at);
  fs.renameSync(file, `${file}.imported`);
  return links.length;
}

export function readLinks(file: string): CapturedLink[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const out: CapturedLink[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as CapturedLink;
      if (parsed?.url) out.push(parsed);
    } catch {
      // A corrupt line loses one link, not the file.
    }
  }
  return out;
}
