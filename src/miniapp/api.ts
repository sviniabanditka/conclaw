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
import type { DayStats } from '../day-stats.js';
import type { Note, NoteInput, SaveResult } from '../notes-store.js';
import type { TurnTrace } from '../turn-trace.js';
import { NewMessage, ScheduledTask } from '../types.js';

export interface ApiDeps {
  /** What the assistant is called — the app must not hardcode a name. */
  assistantName: string;
  /** The group the app speaks for. */
  groupFolder: string;
  /** That group's chat, for history and for sending. */
  chatJid: string;
  getTasks: (groupFolder: string) => ScheduledTask[];
  deleteTask: (id: string) => void;
  setTaskStatus: (id: string, status: 'active' | 'paused') => void;

  getLinks: (groupFolder: string, query?: LinkQuery) => LinkRow[];
  updateLink: (groupFolder: string, id: number, fields: LinkUpdate) => boolean;
  deleteLink: (groupFolder: string, id: number) => boolean;
  countLinks: (groupFolder: string, read?: boolean) => number;

  searchHistory: (chatJid: string, query: string, limit?: number) => NewMessage[];

  /**
   * The vault. Notes are the one memory the user owns, so the app edits the
   * files in place rather than keeping a copy; the vault's git daemon gives
   * those edits a history.
   */
  listNotes: () => Note[];
  saveNote: (id: string, input: NoteInput) => SaveResult;
  createNote: (input: NoteInput, folder?: string) => SaveResult;
  deleteNote: (id: string) => boolean;

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
  /** What went into the last few answers. */
  recentTurns: (chatJid: string) => TurnTrace[];
  /** The last week, reconstructed from traces that already exist. */
  days: (count: number) => DayStats[];

  /** Age of the last successful token refresh, in ms, or null if never. */
  lastRefreshAgeMs?: () => number | null;
  now?: () => number;
}

export interface TaskView {
  id: string;
  title: string;
  nextRun: string | null;
  scheduleType: string;
  /** The cron expression or the one-off time, as stored. */
  scheduleValue: string;
  kind: string;
  status: string;
  /** A schedule.md-derived reminder is regenerated, so deleting it is pointless. */
  derived: boolean;
}

export interface LinkView {
  id: number;
  url: string;
  title: string | null;
  /** Favicon as a data URI, or null while it is still being fetched. */
  icon: string | null;
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

function toTaskView(task: ScheduledTask): TaskView {
  return {
    id: task.id,
    title: firstLine(task.prompt),
    nextRun: task.next_run ?? null,
    scheduleType: task.schedule_type,
    scheduleValue: task.schedule_value,
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

/**
 * Pause or resume a task.
 *
 * Allowed on the sync-derived ones too, unlike deletion: pausing survives —
 * the syncs update a task's schedule and text, they do not resurrect its
 * status — so this is the honest way to silence a reminder you want back
 * later without editing schedule.md.
 */
export function setTaskPaused(
  deps: ApiDeps,
  id: string,
  paused: boolean,
): { updated: boolean; reason?: string } {
  if (!id) return { updated: false, reason: 'no id' };
  const task = deps.getTasks(deps.groupFolder).find((t) => t.id === id);
  if (!task) return { updated: false, reason: 'not found' };
  deps.setTaskStatus(id, paused ? 'paused' : 'active');
  return { updated: true };
}

// --- links -----------------------------------------------------------------

function toLinkView(row: LinkRow): LinkView {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    icon: row.icon,
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
  fields: { tags?: string; note?: string; title?: string },
): { updated: boolean } {
  if (!Number.isInteger(id)) return { updated: false };
  const update: LinkUpdate = {};
  if (typeof fields.tags === 'string') update.tags = fields.tags.slice(0, 500);
  if (typeof fields.note === 'string') update.note = fields.note.slice(0, 2000);
  if (typeof fields.title === 'string') {
    update.title = fields.title.slice(0, 200);
    // A hand-written title is the considered one, so the fetched preview is
    // re-run to pick up an icon for it rather than left as it was.
    update.enriched_at = null;
  }
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
): { messages: MessageView[]; assistantName: string } {
  const q = (query || '').trim();
  if (q.length < 2) return { messages: [], assistantName: deps.assistantName };
  const messages = deps
    .searchHistory(deps.chatJid, q, Math.min(limit, 100))
    .map((m) => ({
      at: m.timestamp,
      fromBot: Boolean(m.is_bot_message),
      text: String(m.content),
    }));
  return { messages, assistantName: deps.assistantName };
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
  /** Newest first — the answer being looked at is the one on top. */
  turns: TurnTrace[];
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
    turns: deps.recentTurns(deps.chatJid),
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

/**
 * The week so far.
 *
 * Capped rather than free: the window is a fixed set of buckets computed on
 * every call, and an unbounded one is a request that reads the whole vault.
 */
export const MAX_DAYS = 31;

export function days(deps: ApiDeps, count: number): { days: DayStats[] } {
  const n = Number.isFinite(count) && count > 0 ? Math.min(count, MAX_DAYS) : 7;
  return { days: deps.days(n) };
}

// --- notes ------------------------------------------------------------------

export interface NoteView {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updated: string | null;
}

function toNoteView(note: Note): NoteView {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    tags: note.tags,
    updated: note.updated,
  };
}

export function listNotes(
  deps: ApiDeps,
  query: { q?: string; tag?: string } = {},
): { notes: NoteView[]; tags: string[] } {
  const all = deps.listNotes();
  const tags = new Set<string>();
  for (const note of all) for (const tag of note.tags) tags.add(tag);

  // Filtering happens here rather than in the store so the tag list is always
  // every tag in use — narrowing it to the current filter empties the list as
  // soon as you pick one, with no way back.
  const q = (query.q ?? '').trim().toLocaleLowerCase();
  const tag = (query.tag ?? '').trim().toLocaleLowerCase();
  const notes = all
    .filter((n) => !tag || n.tags.some((t) => t.toLocaleLowerCase() === tag))
    .filter(
      (n) =>
        !q ||
        [n.title, n.body, n.tags.join(' ')].some((f) =>
          f.toLocaleLowerCase().includes(q),
        ),
    )
    .map(toNoteView);

  return { notes, tags: [...tags].sort() };
}

function noteInput(body: Record<string, unknown>): NoteInput {
  return {
    title: String(body.title ?? '').slice(0, 200),
    body: String(body.body ?? '').slice(0, 64_000),
    tags: String(body.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12),
  };
}

export function saveNote(
  deps: ApiDeps,
  id: string,
  body: Record<string, unknown>,
): SaveResult {
  if (!id) return { saved: false, reason: 'no id' };
  return deps.saveNote(id, noteInput(body));
}

export function createNote(
  deps: ApiDeps,
  body: Record<string, unknown>,
): SaveResult {
  return deps.createNote(noteInput(body), String(body.folder ?? 'General'));
}

export function deleteNote(deps: ApiDeps, id: string): { deleted: boolean } {
  if (!id) return { deleted: false };
  return { deleted: deps.deleteNote(id) };
}
