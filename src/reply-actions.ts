/**
 * "Remind me later" buttons under the assistant's own replies.
 *
 * An answer often matters at a different time than when it was asked for. This
 * turns any reply into a reminder without retyping it or writing a task by hand.
 *
 * The reply text cannot travel in the button: Telegram caps callback payloads at
 * 64 bytes. It is kept in a small in-memory index keyed by message id, so a
 * restart forgets it — the button then says so rather than resurfacing nothing.
 * Persisting it would mean a schema and a retention policy for something whose
 * whole value expires within hours.
 */
import { MessageButton, ScheduledTask } from './types.js';

const PREFIX = 'rl:';

/** Beyond this the index is trimmed oldest-first; only recent replies stay actionable. */
export const MAX_TRACKED_REPLIES = 200;

export function replyButtons(): MessageButton[] {
  return [
    { label: 'Remind 1h', action: `${PREFIX}60` },
    { label: 'Remind 3h', action: `${PREFIX}180` },
  ];
}

export function parseReplyAction(action: string): { minutes: number } | null {
  if (!action.startsWith(PREFIX)) return null;
  const minutes = parseInt(action.slice(PREFIX.length), 10);
  return Number.isFinite(minutes) && minutes > 0 ? { minutes } : null;
}

/** Bounded map of recent reply texts, keyed by the chat message they were sent as. */
export class ReplyIndex {
  private entries = new Map<string, string>();
  private limit: number;

  constructor(limit: number = MAX_TRACKED_REPLIES) {
    this.limit = limit;
  }

  remember(chatJid: string, messageId: string, text: string): void {
    const key = `${chatJid}:${messageId}`;
    // Re-inserting moves it to the end, so an edited reply stays fresh.
    this.entries.delete(key);
    this.entries.set(key, text);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(chatJid: string, messageId: string): string | undefined {
    return this.entries.get(`${chatJid}:${messageId}`);
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface ReplyActionDeps {
  groupFolder: string;
  getText: (chatJid: string, messageId: string) => string | undefined;
  createTask: (task: Omit<ScheduledTask, 'last_run' | 'last_result'>) => void;
  editMessage: (chatJid: string, messageId: string, text: string) => Promise<void>;
  now?: () => number;
}

function describe(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}ч` : `${minutes}м`;
}

/** Apply a reply action. Returns the toast, or null if the action is not ours. */
export async function applyReplyAction(
  chatJid: string,
  messageId: string,
  action: string,
  deps: ReplyActionDeps,
): Promise<string | null> {
  const parsed = parseReplyAction(action);
  if (!parsed) return null;

  const text = deps.getText(chatJid, messageId);
  if (!text) {
    return 'Reply no longer tracked';
  }

  const now = (deps.now ?? (() => Date.now()))();
  const when = new Date(now + parsed.minutes * 60_000);
  // Unique per press: asking to be reminded again should add a reminder rather
  // than silently replace the one already pending.
  const id = `reply-${messageId}-${parsed.minutes}`;

  deps.createTask({
    id,
    group_folder: deps.groupFolder,
    chat_jid: chatJid,
    prompt: `🔔 Напоминание:\n\n${text}`,
    script: null,
    schedule_type: 'once',
    schedule_value: when.toISOString(),
    context_mode: 'isolated',
    kind: 'notify',
    next_run: when.toISOString(),
    status: 'active',
    created_at: new Date(now).toISOString(),
  });

  const marker = `\n\n⏰ Напомню через ${describe(parsed.minutes)}`;
  // Editing also drops the keyboard, so the state is visible and the same
  // reminder cannot be queued twice by accident.
  await deps.editMessage(chatJid, messageId, text + marker);

  return `Reminder in ${describe(parsed.minutes)}`;
}
