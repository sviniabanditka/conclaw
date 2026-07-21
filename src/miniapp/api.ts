/**
 * What the Mini App is allowed to see and change.
 *
 * Deliberately narrow: this is the one place in ConClaw reachable from outside
 * the pod, so it exposes a fixed set of shapes rather than proxying the
 * database. Everything here is scoped to a single group — the app has no
 * concept of other groups and cannot name one.
 *
 * Dependencies come in as functions so the surface can be tested without a
 * database, a filesystem, or a running orchestrator.
 */
import path from 'path';

import { CapturedLink, linksFilePath, readLinks, removeLink } from '../link-capture.js';
import { ScheduledTask } from '../types.js';

export interface ApiDeps {
  /** The group the app speaks for. */
  groupFolder: string;
  groupsDir: string;
  getTasks: (groupFolder: string) => ScheduledTask[];
  deleteTask: (id: string) => void;
  /** Age of the last successful token refresh, in ms, or null if never. */
  lastRefreshAgeMs?: () => number | null;
  now?: () => number;
}

export interface TaskView {
  id: string;
  title: string;
  nextRun: string | null;
  scheduleType: string;
  kind: string;
  status: string;
  /** A schedule.md-derived reminder is regenerated, so deleting it is pointless. */
  derived: boolean;
}

export interface Overview {
  linkCount: number;
  taskCount: number;
  /** The next few things due, soonest first. */
  upcoming: TaskView[];
  lastRefreshAgeMs: number | null;
  generatedAt: string;
}

/** Prefixes owned by a sync loop — tasks under them come back after deletion. */
const DERIVED_PREFIXES = ['sched-', 'cal-', 'sum-'];

function linksFileFor(deps: ApiDeps): string {
  return linksFilePath(path.join(deps.groupsDir, deps.groupFolder));
}

function toView(task: ScheduledTask): TaskView {
  return {
    id: task.id,
    title: firstLine(task.prompt),
    nextRun: task.next_run ?? null,
    scheduleType: task.schedule_type,
    kind: task.kind ?? 'agent',
    status: task.status ?? 'active',
    derived: DERIVED_PREFIXES.some((p) => task.id.startsWith(p)),
  };
}

/** Reminder prompts carry their whole message; the app lists them, so one line. */
function firstLine(prompt: string): string {
  const line = (prompt || '').split('\n').find((l) => l.trim()) ?? '';
  return line.trim().slice(0, 200);
}

export function listTasks(deps: ApiDeps): TaskView[] {
  return deps
    .getTasks(deps.groupFolder)
    .map(toView)
    .sort(byNextRun);
}

function byNextRun(a: TaskView, b: TaskView): number {
  // Tasks with no next run sort last — they are not waiting for anything.
  if (!a.nextRun) return b.nextRun ? 1 : 0;
  if (!b.nextRun) return -1;
  return a.nextRun.localeCompare(b.nextRun);
}

export function listLinks(deps: ApiDeps): CapturedLink[] {
  // Newest first: the app is read top-down and a link saved minutes ago is the
  // one most likely being looked for.
  return readLinks(linksFileFor(deps)).reverse();
}

export function archiveLink(deps: ApiDeps, url: string): { removed: number } {
  if (!url) return { removed: 0 };
  return { removed: removeLink(linksFileFor(deps), url) };
}

/**
 * Delete a scheduled task.
 *
 * Refuses the sync-owned ones. Deleting a `sched-` reminder appears to work and
 * then silently undoes itself within the minute, because schedule.md is the
 * source of truth — better to say so than to let the app lie.
 */
export function deleteTask(
  deps: ApiDeps,
  id: string,
): { deleted: boolean; reason?: string } {
  if (!id) return { deleted: false, reason: 'no id' };
  if (DERIVED_PREFIXES.some((p) => id.startsWith(p))) {
    return { deleted: false, reason: 'derived from schedule.md — edit the file' };
  }
  const exists = deps.getTasks(deps.groupFolder).some((t) => t.id === id);
  if (!exists) return { deleted: false, reason: 'not found' };
  deps.deleteTask(id);
  return { deleted: true };
}

export function overview(deps: ApiDeps, upcomingLimit = 5): Overview {
  const tasks = listTasks(deps);
  const nowMs = (deps.now ?? Date.now)();
  const nowIso = new Date(nowMs).toISOString();
  return {
    linkCount: readLinks(linksFileFor(deps)).length,
    taskCount: tasks.length,
    // "Upcoming" has to mean it — a paused task keeps whatever next_run it had
    // when it was paused, so without both filters the list leads with something
    // that is neither next nor going to happen.
    upcoming: tasks
      .filter((t) => t.status === 'active' && t.nextRun && t.nextRun > nowIso)
      .slice(0, upcomingLimit),
    lastRefreshAgeMs: deps.lastRefreshAgeMs?.() ?? null,
    generatedAt: new Date(nowMs).toISOString(),
  };
}
