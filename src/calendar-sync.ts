/**
 * Turn cached calendar events into reminder tasks.
 *
 * The alternative was a task that woke every five minutes to ask "is anything
 * coming up?". Its script correctly avoided calling the model when the answer
 * was no, but the task itself still started a container each time — roughly 190
 * cold starts a day, at 5–9 seconds each, to usually decide there was nothing to
 * do. Scheduling the reminder for the moment it is actually due costs nothing in
 * between, and lands on time instead of within a five-minute window.
 *
 * The cache is still refreshed by an agent task, because reading Google Calendar
 * needs the MCP tools. That runs a handful of times a day rather than constantly.
 */
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import { ScheduledTask } from './types.js';

/** Marks a task as owned by this sync. Never touch a task without it. */
export const TASK_ID_PREFIX = 'cal-';

export const DEFAULT_LEAD_MINUTES = 5;

export interface CalendarEvent {
  id: string;
  summary: string;
  startMs: number;
  endMs: number | null;
  link?: string;
}

interface RawEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { uri?: string; entryPointType?: string }[];
  };
}

function firstUrl(...candidates: (string | undefined)[]): string | undefined {
  for (const c of candidates) {
    if (c && /^https?:\/\//.test(c)) return c;
  }
  return undefined;
}

/**
 * Read the cache written by the calendar refresh task.
 *
 * All-day entries are skipped: they have a date but no time, so "in 5 minutes"
 * is meaningless for them.
 */
export function parseEvents(json: string): CalendarEvent[] {
  let raw: RawEvent[];
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const events: CalendarEvent[] = [];
  for (const e of raw) {
    if (!e?.id || !e.start?.dateTime) continue;
    const startMs = Date.parse(e.start.dateTime);
    if (Number.isNaN(startMs)) continue;
    const endMs = e.end?.dateTime ? Date.parse(e.end.dateTime) : null;
    events.push({
      id: e.id,
      summary: e.summary || '(без названия)',
      startMs,
      endMs: endMs !== null && !Number.isNaN(endMs) ? endMs : null,
      link: firstUrl(
        e.hangoutLink,
        e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')
          ?.uri,
        e.location,
      ),
    });
  }
  return events;
}

/**
 * Short, stable id derived from the event id.
 *
 * Google event ids run to 60+ characters, and the task id ends up inside a
 * button's callback payload, which Telegram caps at 64 bytes.
 */
export function eventTaskId(groupFolder: string, eventId: string): string {
  let hash = 0;
  for (let i = 0; i < eventId.length; i++) {
    hash = (hash * 31 + eventId.charCodeAt(i)) | 0;
  }
  return `${TASK_ID_PREFIX}${groupFolder}-${(hash >>> 0).toString(36)}`;
}

function formatTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(ms));
}

export function reminderText(
  event: CalendarEvent,
  leadMinutes: number,
  timeZone: string,
): string {
  const span = event.endMs
    ? `${formatTime(event.startMs, timeZone)} – ${formatTime(event.endMs, timeZone)}`
    : formatTime(event.startMs, timeZone);
  const head = `🗓 Через ${leadMinutes} мин: *${event.summary}* (${span})`;
  return event.link ? `${head}\n${event.link}` : head;
}

export interface CalendarSyncPlan {
  create: { id: string; prompt: string; runAt: string }[];
  update: { id: string; prompt: string; runAt: string }[];
  remove: string[];
}

export function planCalendarSync(
  groupFolder: string,
  events: CalendarEvent[],
  existing: ScheduledTask[],
  opts: { now: number; leadMinutes: number; timeZone: string },
): CalendarSyncPlan {
  const owned = existing.filter((t) => t.id.startsWith(TASK_ID_PREFIX));
  const byId = new Map(owned.map((t) => [t.id, t]));
  const plan: CalendarSyncPlan = { create: [], update: [], remove: [] };
  const wanted = new Set<string>();

  for (const event of events) {
    const fireAt = event.startMs - opts.leadMinutes * 60_000;
    // A reminder for a moment that has passed would fire immediately and be
    // worse than useless — the meeting already started.
    if (fireAt <= opts.now) continue;

    const id = eventTaskId(groupFolder, event.id);
    wanted.add(id);
    const prompt = reminderText(event, opts.leadMinutes, opts.timeZone);
    const runAt = new Date(fireAt).toISOString();
    const current = byId.get(id);

    if (!current) {
      plan.create.push({ id, prompt, runAt });
    } else if (current.prompt !== prompt || current.next_run !== runAt) {
      // Covers a moved meeting and a renamed one alike.
      plan.update.push({ id, prompt, runAt });
    }
  }

  for (const task of owned) {
    // Leave already-fired reminders alone; removing only pending ones means a
    // cancelled meeting stops nagging while history stays intact.
    if (!wanted.has(task.id) && task.status === 'active') {
      plan.remove.push(task.id);
    }
  }

  return plan;
}

export interface CalendarSyncDeps {
  groupFolder: string;
  chatJid: string;
  eventsFile: string;
  timeZone: string;
  getTasks: (groupFolder: string) => ScheduledTask[];
  createTask: (task: Omit<ScheduledTask, 'last_run' | 'last_result'>) => void;
  updateTask: (
    id: string,
    updates: Partial<Pick<ScheduledTask, 'prompt' | 'schedule_value' | 'next_run'>>,
  ) => void;
  deleteTask: (id: string) => void;
  now?: () => number;
  leadMinutes?: number;
}

export function syncCalendarEvents(
  deps: CalendarSyncDeps,
): CalendarSyncPlan | null {
  let json: string;
  try {
    json = fs.readFileSync(deps.eventsFile, 'utf-8');
  } catch {
    // No cache — this group does not use calendar reminders.
    return null;
  }

  const now = (deps.now ?? (() => Date.now()))();
  const leadMinutes = deps.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  const events = parseEvents(json);
  const plan = planCalendarSync(
    deps.groupFolder,
    events,
    deps.getTasks(deps.groupFolder),
    { now, leadMinutes, timeZone: deps.timeZone },
  );

  for (const item of plan.create) {
    deps.createTask({
      id: item.id,
      group_folder: deps.groupFolder,
      chat_jid: deps.chatJid,
      prompt: item.prompt,
      script: null,
      schedule_type: 'once',
      schedule_value: item.runAt,
      context_mode: 'isolated',
      kind: 'notify',
      next_run: item.runAt,
      status: 'active',
      created_at: new Date(now).toISOString(),
    });
  }
  for (const item of plan.update) {
    deps.updateTask(item.id, {
      prompt: item.prompt,
      schedule_value: item.runAt,
      next_run: item.runAt,
    });
  }
  for (const id of plan.remove) {
    deps.deleteTask(id);
  }

  const changed = plan.create.length + plan.update.length + plan.remove.length;
  if (changed > 0) {
    logger.info(
      {
        group: deps.groupFolder,
        created: plan.create.length,
        updated: plan.update.length,
        removed: plan.remove.length,
      },
      'Calendar reminders synced from cached events',
    );
  }
  return plan;
}

export function eventsFilePath(groupDir: string): string {
  return path.join(groupDir, 'today_events.json');
}
