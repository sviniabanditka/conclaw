/**
 * Derive reminder tasks from a group's `schedule.md`.
 *
 * The file is the schedule people actually edit. Hand-copying each row into its
 * own cron task means the two drift the moment a time changes — silently, since
 * nothing compares them. This keeps the file authoritative and rebuilds the
 * tasks from it.
 *
 * Only tasks it created are ever touched (see TASK_ID_PREFIX); anything the user
 * or the agent scheduled is left alone.
 */
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import { ScheduledTask } from './types.js';

/** Marks a task as owned by this sync. Never touch a task without it. */
export const TASK_ID_PREFIX = 'sched-';

/** Minutes of warning before the event. */
export const DEFAULT_LEAD_MINUTES = 5;

/** Mon–Fri. The schedule these are generated from is a weekday routine. */
export const WEEKDAYS = [1, 2, 3, 4, 5];

export interface ScheduleEntry {
  /** "HH:MM", as written in the file. */
  time: string;
  label: string;
  /**
   * 0 for the day the schedule starts on, 1 once it has crossed midnight.
   *
   * A routine that runs 09:00 → 01:00 spans two calendar days, and the rows
   * after midnight belong to the second one. Without this a 01:00 reminder
   * fires at 00:55 on the wrong day — the tail of the *previous* night.
   */
  dayOffset: number;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Parse the markdown table. Rows that are not `| HH:MM | label |` are ignored. */
export function parseSchedule(text: string): ScheduleEntry[] {
  const rows: { time: string; label: string }[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\|\s*(\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) continue;
    const [h, min] = m[1].split(':');
    rows.push({
      time: `${h.padStart(2, '0')}:${min}`,
      label: m[2].trim(),
    });
  }

  // Times are listed in the order they happen, so a decrease means midnight.
  let dayOffset = 0;
  let previous = -1;
  return rows.map((row) => {
    const minutes = toMinutes(row.time);
    if (previous >= 0 && minutes < previous) dayOffset++;
    previous = minutes;
    return { ...row, dayOffset };
  });
}

function shiftDays(days: number[], offset: number): number[] {
  return days
    .map((d) => (((d + offset) % 7) + 7) % 7)
    .sort((a, b) => a - b);
}

function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return contiguous && sorted.length > 1
    ? `${sorted[0]}-${sorted[sorted.length - 1]}`
    : sorted.join(',');
}

/**
 * Cron expression for the reminder that precedes an entry.
 *
 * Subtracting the lead time can pull the reminder back across midnight, in
 * which case it belongs to the previous day — a 00:00 event is reminded at
 * 23:55 the evening before, so its days shift back while the event's do not.
 */
export function reminderCron(
  entry: ScheduleEntry,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
  baseDays: number[] = WEEKDAYS,
): string {
  let minutes = toMinutes(entry.time) - leadMinutes;
  let dayOffset = entry.dayOffset;
  if (minutes < 0) {
    minutes += 24 * 60;
    dayOffset -= 1;
  }
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${mm} ${hh} * * ${formatDays(shiftDays(baseDays, dayOffset))}`;
}

export function reminderText(entry: ScheduleEntry, leadMinutes: number): string {
  return `⏰ Через ${leadMinutes} минут — *${entry.label}* (${entry.time})`;
}

/**
 * The morning rundown, rendered from the same rows the reminders come from.
 * `extra` is appended when there is something else worth knowing at that hour,
 * such as the day's weather.
 */
export function digestText(entries: ScheduleEntry[], extra?: string): string {
  const lines = entries.map((e) => `${e.time} — ${e.label}`);
  const body = `☀️ Доброе утро! Расписание на сегодня:\n\n${lines.join('\n')}`;
  return extra ? `${body}\n\n${extra}` : body;
}

/**
 * Cron for the daily rundown: the first row's own time, on the same days.
 *
 * Deriving it rather than configuring it keeps the file the only place a time
 * is written down. Shift the start of the day and the rundown follows, instead
 * of announcing a schedule that no longer begins then.
 */
export function digestCron(
  entries: ScheduleEntry[],
  baseDays: number[] = WEEKDAYS,
): string | null {
  const first = entries[0];
  if (!first) return null;
  const [hh, mm] = first.time.split(':').map(Number);
  return `${mm} ${hh} * * ${formatDays(shiftDays(baseDays, first.dayOffset))}`;
}

export function digestTaskId(groupFolder: string): string {
  return `${TASK_ID_PREFIX}${groupFolder}-digest`;
}

export function taskIdFor(groupFolder: string, entry: ScheduleEntry): string {
  return `${TASK_ID_PREFIX}${groupFolder}-${entry.time.replace(':', '')}`;
}

export interface SyncPlan {
  create: { id: string; prompt: string; cron: string }[];
  update: { id: string; prompt: string; cron: string }[];
  remove: string[];
}

/**
 * Diff the file against the tasks currently derived from it.
 *
 * Returned as a plan rather than applied directly so the decision is testable
 * without a database, and so a caller can log exactly what will change.
 */
export function planSync(
  groupFolder: string,
  entries: ScheduleEntry[],
  existing: ScheduledTask[],
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
  digestExtra?: string,
): SyncPlan {
  const owned = existing.filter((t) => t.id.startsWith(TASK_ID_PREFIX));
  const byId = new Map(owned.map((t) => [t.id, t]));
  const plan: SyncPlan = { create: [], update: [], remove: [] };

  const wanted = new Set<string>();

  const digestSchedule = digestCron(entries);
  if (digestSchedule) {
    const id = digestTaskId(groupFolder);
    wanted.add(id);
    const prompt = digestText(entries, digestExtra);
    const current = byId.get(id);
    if (!current) {
      plan.create.push({ id, prompt, cron: digestSchedule });
    } else if (
      current.prompt !== prompt ||
      current.schedule_value !== digestSchedule
    ) {
      plan.update.push({ id, prompt, cron: digestSchedule });
    }
  }

  for (const entry of entries) {
    const id = taskIdFor(groupFolder, entry);
    wanted.add(id);
    const prompt = reminderText(entry, leadMinutes);
    const cron = reminderCron(entry, leadMinutes);
    const current = byId.get(id);
    if (!current) {
      plan.create.push({ id, prompt, cron });
    } else if (current.prompt !== prompt || current.schedule_value !== cron) {
      plan.update.push({ id, prompt, cron });
    }
  }

  for (const task of owned) {
    if (!wanted.has(task.id)) plan.remove.push(task.id);
  }

  return plan;
}

export interface ScheduleSyncDeps {
  groupFolder: string;
  chatJid: string;
  scheduleFile: string;
  getTasks: (groupFolder: string) => ScheduledTask[];
  createTask: (task: Omit<ScheduledTask, 'last_run' | 'last_result'>) => void;
  updateTask: (
    id: string,
    updates: Partial<Pick<ScheduledTask, 'prompt' | 'schedule_value' | 'next_run'>>,
  ) => void;
  deleteTask: (id: string) => void;
  nextRunFor: (cron: string) => string | null;
  leadMinutes?: number;
  /** Appended to the rundown — the weather line, when available. */
  digestExtra?: string;
}

/** Apply one sync pass. Returns the plan that was applied, for logging/tests. */
export function syncScheduleFile(deps: ScheduleSyncDeps): SyncPlan | null {
  let text: string;
  try {
    text = fs.readFileSync(deps.scheduleFile, 'utf-8');
  } catch {
    // No schedule.md — this group simply does not use the feature.
    return null;
  }

  const lead = deps.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  const entries = parseSchedule(text);
  const plan = planSync(
    deps.groupFolder,
    entries,
    deps.getTasks(deps.groupFolder),
    lead,
    deps.digestExtra,
  );

  for (const item of plan.create) {
    deps.createTask({
      id: item.id,
      group_folder: deps.groupFolder,
      chat_jid: deps.chatJid,
      prompt: item.prompt,
      script: null,
      schedule_type: 'cron',
      schedule_value: item.cron,
      context_mode: 'isolated',
      kind: 'notify',
      next_run: deps.nextRunFor(item.cron),
      status: 'active',
      created_at: new Date().toISOString(),
    });
  }
  for (const item of plan.update) {
    deps.updateTask(item.id, {
      prompt: item.prompt,
      schedule_value: item.cron,
      next_run: deps.nextRunFor(item.cron),
    });
  }
  for (const id of plan.remove) {
    deps.deleteTask(id);
  }

  const changed =
    plan.create.length + plan.update.length + plan.remove.length;
  if (changed > 0) {
    logger.info(
      {
        group: deps.groupFolder,
        created: plan.create.length,
        updated: plan.update.length,
        removed: plan.remove.length,
      },
      'Schedule reminders synced from schedule.md',
    );
  }
  return plan;
}

/** Path of a group's schedule file. */
export function scheduleFilePath(groupDir: string): string {
  return path.join(groupDir, 'schedule.md');
}
