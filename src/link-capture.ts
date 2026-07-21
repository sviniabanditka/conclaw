/**
 * Collect links thrown into the chat without answering each one.
 *
 * Links get sent to be "looked at later" and then never are. Answering each
 * immediately is worse than useless — it interrupts, costs a container, and the
 * reply is read even less than the link would have been.
 *
 * So a message that is *only* links is captured silently and acknowledged with a
 * reaction; an evening task reads the day's collection and reports once. A link
 * sent with a question is not this — that is a question, and goes to the agent
 * as normal.
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

/** Append captured links. One JSON object per line — cheap to append, easy to read. */
export function appendLinks(file: string, urls: string[], now: number): void {
  if (urls.length === 0) return;
  const at = new Date(now).toISOString();
  const lines = urls.map((url) => JSON.stringify({ url, at })).join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, lines + '\n');
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
