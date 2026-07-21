/**
 * Snooze / Stop buttons on reminders.
 *
 * Reminders are otherwise one-way: they fire whether or not the moment suits,
 * and the only way to quieten one is to go and edit its schedule. These two
 * actions handle the common cases in a tap — postpone it, or acknowledge it.
 *
 * "Stop" dismisses *this* occurrence only. Cancelling the recurring task would
 * be a destructive reading of a button pressed half-awake, and the schedule is
 * derived from schedule.md anyway, so the honest place to stop it for good is
 * that file.
 */
import { ScheduledTask } from './types.js';

/** Kept short: Telegram caps callback payloads at 64 bytes. */
const SNOOZE_PREFIX = 'sn:';
const STOP_PREFIX = 'st:';

export const DEFAULT_SNOOZE_MINUTES = 10;

/** Buttons attached to a reminder. Labels are the user-facing English UI. */
export function reminderButtons(taskId: string): {
  label: string;
  action: string;
}[] {
  return [
    { label: 'Snooze', action: `${SNOOZE_PREFIX}${taskId}` },
    { label: 'Stop', action: `${STOP_PREFIX}${taskId}` },
  ];
}

export type ReminderAction =
  | { type: 'snooze'; taskId: string }
  | { type: 'stop'; taskId: string };

export function parseAction(action: string): ReminderAction | null {
  if (action.startsWith(SNOOZE_PREFIX)) {
    const taskId = action.slice(SNOOZE_PREFIX.length);
    return taskId ? { type: 'snooze', taskId } : null;
  }
  if (action.startsWith(STOP_PREFIX)) {
    const taskId = action.slice(STOP_PREFIX.length);
    return taskId ? { type: 'stop', taskId } : null;
  }
  return null;
}

/** Id of the one-off task a snooze creates. Deterministic, so a second tap replaces the first. */
export function snoozeTaskId(taskId: string): string {
  return `snooze-${taskId}`;
}

export interface ReminderActionDeps {
  getTask: (id: string) => ScheduledTask | undefined;
  createTask: (task: Omit<ScheduledTask, 'last_run' | 'last_result'>) => void;
  deleteTask: (id: string) => void;
  /** Rewrite the reminder message to show what happened. */
  editMessage: (chatJid: string, messageId: string, text: string) => Promise<void>;
  now?: () => number;
  snoozeMinutes?: number;
}

/**
 * Apply a tapped action. Returns the toast to show, or null if the action was
 * not one of ours.
 */
export async function applyReminderAction(
  chatJid: string,
  messageId: string,
  action: string,
  deps: ReminderActionDeps,
): Promise<string | null> {
  const parsed = parseAction(action);
  if (!parsed) return null;

  const now = deps.now ?? (() => Date.now());
  const minutes = deps.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES;
  const task = deps.getTask(parsed.taskId);

  if (parsed.type === 'stop') {
    // Drop a pending snooze too, otherwise "Stop" silently leaves one queued.
    deps.deleteTask(snoozeTaskId(parsed.taskId));
    const text = task ? `✅ ${stripLead(task.prompt)}` : '✅ Done';
    await deps.editMessage(chatJid, messageId, text);
    return 'Stopped';
  }

  if (!task) {
    // The schedule changed under us — the row this came from no longer exists.
    await deps.editMessage(chatJid, messageId, '⚠️ Reminder no longer exists');
    return 'Gone';
  }

  const when = new Date(now() + minutes * 60_000);
  const id = snoozeTaskId(parsed.taskId);
  // Replace rather than stack: tapping Snooze twice should postpone once more,
  // not queue two copies.
  deps.deleteTask(id);
  deps.createTask({
    id,
    group_folder: task.group_folder,
    chat_jid: task.chat_jid,
    prompt: task.prompt,
    script: null,
    schedule_type: 'once',
    schedule_value: when.toISOString(),
    context_mode: 'isolated',
    kind: 'notify',
    next_run: when.toISOString(),
    status: 'active',
    created_at: new Date(now()).toISOString(),
  });

  await deps.editMessage(
    chatJid,
    messageId,
    `😴 Snoozed ${minutes}m — ${stripLead(task.prompt)}`,
  );
  return `Snoozed ${minutes}m`;
}

/** Drop a leading emoji so the rewritten line does not carry two of them. */
function stripLead(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]*/u, '').trim();
}
