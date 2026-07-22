/**
 * The last few days, reconstructed from what the assistant already stores.
 *
 * Nothing here is new instrumentation — it counts traces that exist anyway:
 * meetings in the calendar cache, links as they were saved and read, notes in
 * the vault, messages either way, tasks that fired. The point is that none of
 * it required remembering to log anything at the time.
 *
 * What it deliberately does **not** include is work done outside this box.
 * Commits live on the machine the user actually codes on; counting the two
 * repositories that happen to sit on this pod would produce a number that
 * looks like their day's output and is not.
 *
 * Days are bucketed in the user's timezone, not UTC. Every timestamp involved
 * is stored in UTC, so a day boundary drawn in the wrong zone quietly moves
 * three hours of every evening into tomorrow.
 */
import fs from 'fs';
import path from 'path';

import { dayKey } from './summaries.js';

export interface DayStats {
  /** `YYYY-MM-DD` in the user's timezone. */
  day: string;
  meetings: number;
  meetingMinutes: number;
  linksSaved: number;
  linksRead: number;
  notesTouched: number;
  messagesFromUser: number;
  messagesFromBot: number;
  tasksRun: number;
}

export interface DayStatsDeps {
  timeZone: string;
  /** Calendar cache for the group, as written by the refresher. */
  eventsFile: string;
  /** Vault folder holding this assistant's notes. */
  notesDir: string;
  /** Rows of `{ added_at, read_at }` for the group's links. */
  linkTimestamps: () => { added_at: string; read_at: string | null }[];
  /** Rows of `{ timestamp, is_bot_message }` for the chat. */
  messageTimestamps: () => { timestamp: string; is_bot_message: number }[];
  /** ISO timestamps of task runs. */
  taskRuns: () => string[];
  now?: () => number;
}

/** Calendar events, ignoring all-day entries — they are not time spent. */
function readMeetings(file: string): { startMs: number; minutes: number }[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  let items: unknown;
  try {
    items = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];

  const out: { startMs: number; minutes: number }[] = [];
  for (const item of items) {
    const ev = item as {
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      status?: string;
    };
    // An all-day event has `date`, not `dateTime`; a cancelled one is not time
    // anybody spent.
    if (!ev.start?.dateTime || ev.status === 'cancelled') continue;
    const startMs = Date.parse(ev.start.dateTime);
    const endMs = ev.end?.dateTime ? Date.parse(ev.end.dateTime) : NaN;
    if (!Number.isFinite(startMs)) continue;
    const minutes = Number.isFinite(endMs)
      ? Math.max(0, Math.round((endMs - startMs) / 60_000))
      : 0;
    out.push({ startMs, minutes });
  }
  return out;
}

/**
 * Notes touched per day, from the vault's frontmatter.
 *
 * `updated` rather than `created`: revisiting a note is the day's activity as
 * much as writing one, and a note written today has both set to today anyway.
 *
 * Files starting with `_` are skipped. In this vault that prefix marks indexes
 * — `_MOC.md`, `_index.md` — which are rewritten every time a real note is
 * added, so counting them would double every entry.
 */
function readNoteDays(dir: string): string[] {
  const days: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name.startsWith('_')) continue;
    const full = path.join(entry.parentPath ?? dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(full, 'utf-8').slice(0, 400);
    } catch {
      continue;
    }
    const m = /^updated:\s*(\d{4}-\d{2}-\d{2})/m.exec(content);
    if (m) days.push(m[1]);
  }
  return days;
}

function emptyDay(day: string): DayStats {
  return {
    day,
    meetings: 0,
    meetingMinutes: 0,
    linksSaved: 0,
    linksRead: 0,
    notesTouched: 0,
    messagesFromUser: 0,
    messagesFromBot: 0,
    tasksRun: 0,
  };
}

/**
 * Stats for the last `days` days, oldest first.
 *
 * Days with nothing in them are present and zeroed rather than absent: a gap
 * in a chart reads as missing data, and "you did nothing on Sunday" is the
 * actual answer.
 */
export function dayStats(deps: DayStatsDeps, days = 7): DayStats[] {
  const now = (deps.now ?? Date.now)();
  const buckets = new Map<string, DayStats>();
  const order: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(now - i * 86_400_000, deps.timeZone);
    buckets.set(key, emptyDay(key));
    order.push(key);
  }

  const bucket = (iso: string | number | null): DayStats | undefined => {
    if (iso === null) return undefined;
    const ms = typeof iso === 'number' ? iso : Date.parse(iso);
    if (!Number.isFinite(ms)) return undefined;
    return buckets.get(dayKey(ms, deps.timeZone));
  };

  for (const meeting of readMeetings(deps.eventsFile)) {
    const b = bucket(meeting.startMs);
    if (!b) continue;
    b.meetings += 1;
    b.meetingMinutes += meeting.minutes;
  }

  for (const link of deps.linkTimestamps()) {
    const added = bucket(link.added_at);
    if (added) added.linksSaved += 1;
    const read = bucket(link.read_at);
    if (read) read.linksRead += 1;
  }

  for (const day of readNoteDays(deps.notesDir)) {
    const b = buckets.get(day);
    if (b) b.notesTouched += 1;
  }

  for (const msg of deps.messageTimestamps()) {
    const b = bucket(msg.timestamp);
    if (!b) continue;
    if (msg.is_bot_message) b.messagesFromBot += 1;
    else b.messagesFromUser += 1;
  }

  for (const run of deps.taskRuns()) {
    const b = bucket(run);
    if (b) b.tasksRun += 1;
  }

  return order.map((key) => buckets.get(key)!);
}
