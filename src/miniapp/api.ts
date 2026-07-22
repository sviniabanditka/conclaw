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
import { LinkQuery, LinkRow, LinkUpdate, splitTags } from '../db.js';
import type { Rule } from '../rules.js';
import type { InstalledSkill, SkillProposal } from '../skill-proposals.js';
import { NewMessage, ScheduledTask } from '../types.js';

export interface ApiDeps {
  /** The group the app speaks for. */
  groupFolder: string;
  /** That group's chat, for history and for sending. */
  chatJid: string;
  getTasks: (groupFolder: string) => ScheduledTask[];
  deleteTask: (id: string) => void;

  getLinks: (groupFolder: string, query?: LinkQuery) => LinkRow[];
  updateLink: (groupFolder: string, id: number, fields: LinkUpdate) => boolean;
  deleteLink: (groupFolder: string, id: number) => boolean;
  countLinks: (groupFolder: string, read?: boolean) => number;

  searchHistory: (chatJid: string, query: string, limit?: number) => NewMessage[];
  /** Hand text to the agent as though it had arrived in the chat. */
  sendToAgent: (chatJid: string, text: string) => void;

  /**
   * What the assistant taught itself: rules it learned, skills it has, and
   * skills it wrote and is waiting on. The app is the only place these can be
   * read and removed — the files live on the host, out of reach from a phone.
   */
  readRules: () => Rule[];
  removeRule: (text: string) => boolean;
  listSkills: () => InstalledSkill[];
  listProposals: () => SkillProposal[];
  readProposal: (name: string) => string | null;
  promoteSkill: (name: string) => { promoted: boolean; reason?: string };
  rejectSkill: (name: string) => boolean;

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

export interface LinkView {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  domain: string | null;
  tags: string[];
  note: string | null;
  read: boolean;
  addedAt: string;
}

export interface MessageView {
  at: string;
  fromBot: boolean;
  text: string;
}

export interface Overview {
  linkCount: number;
  unreadLinkCount: number;
  taskCount: number;
  /** The next few things due, soonest first. */
  upcoming: TaskView[];
  lastRefreshAgeMs: number | null;
  generatedAt: string;
}

/** Prefixes owned by a sync loop — tasks under them come back after deletion. */
const DERIVED_PREFIXES = ['sched-', 'cal-', 'sum-'];

/** Long enough for anything worth saying to the agent, short enough to bound. */
export const MAX_MESSAGE_LENGTH = 4000;

function toTaskView(task: ScheduledTask): TaskView {
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
  return deps.getTasks(deps.groupFolder).map(toTaskView).sort(byNextRun);
}

function byNextRun(a: TaskView, b: TaskView): number {
  // Tasks with no next run sort last — they are not waiting for anything.
  if (!a.nextRun) return b.nextRun ? 1 : 0;
  if (!b.nextRun) return -1;
  return a.nextRun.localeCompare(b.nextRun);
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

// --- links -----------------------------------------------------------------

function toLinkView(row: LinkRow): LinkView {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    domain: row.domain,
    tags: splitTags(row.tags),
    note: row.note,
    read: row.read === 1,
    addedAt: row.added_at,
  };
}

export interface LinkListQuery {
  q?: string;
  tag?: string;
  /** 'unread' is the default: the archive exists to be worked through. */
  filter?: 'unread' | 'read' | 'all';
}

export function listLinks(
  deps: ApiDeps,
  query: LinkListQuery = {},
): { links: LinkView[]; tags: string[] } {
  const filter = query.filter ?? 'unread';
  const links = deps
    .getLinks(deps.groupFolder, {
      q: query.q,
      tag: query.tag,
      read: filter === 'all' ? undefined : filter === 'read',
    })
    .map(toLinkView);

  // Every tag in use, not just the ones surviving the current filter —
  // otherwise the tag list empties out as soon as you pick one and there is
  // no way back.
  const tags = new Set<string>();
  for (const row of deps.getLinks(deps.groupFolder)) {
    for (const tag of splitTags(row.tags)) tags.add(tag);
  }

  return { links, tags: [...tags].sort() };
}

export function setLinkRead(
  deps: ApiDeps,
  id: number,
  read: boolean,
): { updated: boolean } {
  if (!Number.isInteger(id)) return { updated: false };
  return { updated: deps.updateLink(deps.groupFolder, id, { read }) };
}

export function setLinkFields(
  deps: ApiDeps,
  id: number,
  fields: { tags?: string; note?: string },
): { updated: boolean } {
  if (!Number.isInteger(id)) return { updated: false };
  const update: LinkUpdate = {};
  if (typeof fields.tags === 'string') update.tags = fields.tags.slice(0, 500);
  if (typeof fields.note === 'string') update.note = fields.note.slice(0, 2000);
  if (Object.keys(update).length === 0) return { updated: false };
  return { updated: deps.updateLink(deps.groupFolder, id, update) };
}

export function removeLink(deps: ApiDeps, id: number): { deleted: boolean } {
  if (!Number.isInteger(id)) return { deleted: false };
  return { deleted: deps.deleteLink(deps.groupFolder, id) };
}

// --- history ---------------------------------------------------------------

export function searchHistory(
  deps: ApiDeps,
  query: string,
  limit = 50,
): { messages: MessageView[] } {
  const q = (query || '').trim();
  if (q.length < 2) return { messages: [] };
  const messages = deps
    .searchHistory(deps.chatJid, q, Math.min(limit, 100))
    .map((m) => ({
      at: m.timestamp,
      fromBot: Boolean(m.is_bot_message),
      text: String(m.content),
    }));
  return { messages };
}

// --- writing back ----------------------------------------------------------

/**
 * Say something to the agent from the app.
 *
 * The text is handed to the same queue an incoming chat message goes through,
 * so the reply arrives in Telegram rather than here. That is the honest
 * behaviour: the agent answers where the conversation lives, and the app does
 * not need to reimplement streaming, buttons or history to show it.
 */
export function sendMessage(
  deps: ApiDeps,
  text: string,
): { sent: boolean; reason?: string } {
  const trimmed = (text || '').trim();
  if (!trimmed) return { sent: false, reason: 'empty' };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { sent: false, reason: 'too long' };
  }
  deps.sendToAgent(deps.chatJid, trimmed);
  return { sent: true };
}

// --- overview --------------------------------------------------------------

export function overview(deps: ApiDeps, upcomingLimit = 5): Overview {
  const tasks = listTasks(deps);
  const nowMs = (deps.now ?? Date.now)();
  const nowIso = new Date(nowMs).toISOString();
  return {
    linkCount: deps.countLinks(deps.groupFolder),
    unreadLinkCount: deps.countLinks(deps.groupFolder, false),
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

// --- what the assistant taught itself ------------------------------------

export interface ProposalView {
  name: string;
  description: string;
  replaces: boolean;
  /** The whole SKILL.md — approving prose unread is approving it blind. */
  content: string;
}

export interface Brain {
  rules: Rule[];
  skills: InstalledSkill[];
  proposals: ProposalView[];
}

export function brain(deps: ApiDeps): Brain {
  return {
    rules: deps.readRules(),
    skills: deps.listSkills(),
    proposals: deps.listProposals().map((p) => ({
      name: p.name,
      description: p.description,
      replaces: p.replaces,
      content: deps.readProposal(p.name) ?? '',
    })),
  };
}

/**
 * Forget a rule.
 *
 * Matched on text rather than an index: the list is read on a phone and acted
 * on later, and an index would silently point at a different rule once
 * anything above it changed.
 */
export function forgetRule(deps: ApiDeps, text: string): { removed: boolean } {
  if (!text) return { removed: false };
  return { removed: deps.removeRule(text) };
}

export function installSkill(
  deps: ApiDeps,
  name: string,
): { installed: boolean; reason?: string } {
  if (!name) return { installed: false, reason: 'no name' };
  const result = deps.promoteSkill(name);
  return { installed: result.promoted, reason: result.reason };
}

export function discardSkill(deps: ApiDeps, name: string): { discarded: boolean } {
  if (!name) return { discarded: false };
  return { discarded: deps.rejectSkill(name) };
}
