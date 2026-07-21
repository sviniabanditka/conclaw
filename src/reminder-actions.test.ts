/**
 * Snooze / Stop button behaviour.
 *
 * These run on a half-awake tap, so the risky cases are the ones tested: a
 * double tap must not queue two reminders, Stop must not leave a snooze behind,
 * and a button pressed after the schedule changed must not throw.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  applyReminderAction,
  ReminderActionDeps,
  parseAction,
  reminderButtons,
  snoozeTaskId,
  DEFAULT_SNOOZE_MINUTES,
} from './reminder-actions.js';
import { ScheduledTask } from './types.js';

const TASK_ID = 'sched-telegram_main-0900';

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: TASK_ID,
    group_folder: 'telegram_main',
    chat_jid: 'tg:1',
    prompt: '⏰ Через 5 минут — *Подъем* (09:00)',
    schedule_type: 'cron',
    schedule_value: '55 8 * * 1-5',
    context_mode: 'isolated',
    kind: 'notify',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '',
    ...over,
  };
}

/** Reach the call log of a dependency that was stubbed with vi.fn(). */
function calls(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

function deps(over: Partial<ReminderActionDeps> = {}): ReminderActionDeps {
  return {
    getTask: vi.fn(() => task()),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    editMessage: vi.fn().mockResolvedValue(undefined),
    now: () => 1_700_000_000_000,
    ...over,
  };
}

describe('callback payloads', () => {
  it('round-trips a snooze action', () => {
    const [snooze] = reminderButtons(TASK_ID);
    expect(parseAction(snooze.action)).toEqual({
      type: 'snooze',
      taskId: TASK_ID,
    });
  });

  it('round-trips a stop action', () => {
    const [, stop] = reminderButtons(TASK_ID);
    expect(parseAction(stop.action)).toEqual({ type: 'stop', taskId: TASK_ID });
  });

  it('labels the buttons with emoji', () => {
    expect(reminderButtons(TASK_ID).map((b) => b.label)).toEqual(['😴 10m', '✅']);
  });

  // The label promises a delay the action has to keep, so it cannot be
  // hardcoded independently of the duration actually used.
  it('shows the snooze duration it will actually use', () => {
    expect(reminderButtons(TASK_ID, 25)[0].label).toBe('😴 25m');
  });

  // Telegram rejects callback_data over 64 bytes, which would break the button
  // silently at send time.
  it('keeps payloads inside the Telegram limit', () => {
    for (const b of reminderButtons(TASK_ID)) {
      expect(Buffer.byteLength(b.action)).toBeLessThanOrEqual(64);
    }
  });

  it('ignores actions that are not ours', () => {
    expect(parseAction('something-else')).toBeNull();
    expect(parseAction('sn:')).toBeNull();
  });
});

describe('applyReminderAction', () => {
  it('schedules a one-off reminder when snoozed', async () => {
    const d = deps();
    const toast = await applyReminderAction('tg:1', '55', `sn:${TASK_ID}`, d);

    expect(toast).toBe(`Snoozed ${DEFAULT_SNOOZE_MINUTES}m`);
    const created = calls(d.createTask)[0][0] as ScheduledTask;
    expect(created.kind).toBe('notify');
    expect(created.schedule_type).toBe('once');
    expect(new Date(created.next_run!).getTime()).toBe(
      1_700_000_000_000 + DEFAULT_SNOOZE_MINUTES * 60_000,
    );
  });

  // Two taps should postpone once more, not queue a second reminder.
  it('replaces a pending snooze rather than stacking one', async () => {
    const d = deps();
    await applyReminderAction('tg:1', '55', `sn:${TASK_ID}`, d);
    expect(d.deleteTask).toHaveBeenCalledWith(snoozeTaskId(TASK_ID));
    expect((calls(d.createTask)[0][0] as ScheduledTask).id).toBe(
      snoozeTaskId(TASK_ID),
    );
  });

  it('rewrites the message so the state is visible', async () => {
    const d = deps();
    await applyReminderAction('tg:1', '55', `sn:${TASK_ID}`, d);
    expect(d.editMessage).toHaveBeenCalledWith(
      'tg:1',
      '55',
      expect.stringContaining('Snoozed'),
    );
  });

  // Otherwise "Stop" looks obeyed while a snooze is still queued to fire.
  it('cancels a pending snooze on stop', async () => {
    const d = deps();
    const toast = await applyReminderAction('tg:1', '55', `st:${TASK_ID}`, d);

    expect(toast).toBe('Stopped');
    expect(d.deleteTask).toHaveBeenCalledWith(snoozeTaskId(TASK_ID));
    expect(d.createTask).not.toHaveBeenCalled();
  });

  // Stop is about this occurrence; the recurring task must survive.
  it('does not delete the recurring task on stop', async () => {
    const d = deps();
    await applyReminderAction('tg:1', '55', `st:${TASK_ID}`, d);
    expect(d.deleteTask).not.toHaveBeenCalledWith(TASK_ID);
  });

  // schedule.md may have changed since the reminder was sent.
  it('handles snoozing a reminder that no longer exists', async () => {
    const d = deps({ getTask: vi.fn(() => undefined) });
    const toast = await applyReminderAction('tg:1', '55', `sn:${TASK_ID}`, d);

    expect(toast).toBe('Gone');
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.editMessage).toHaveBeenCalledWith(
      'tg:1',
      '55',
      expect.stringContaining('no longer exists'),
    );
  });

  it('stops cleanly even if the task is gone', async () => {
    const d = deps({ getTask: vi.fn(() => undefined) });
    await expect(
      applyReminderAction('tg:1', '55', `st:${TASK_ID}`, d),
    ).resolves.toBe('Stopped');
  });

  it('returns null for an unrelated callback', async () => {
    const d = deps();
    expect(await applyReminderAction('tg:1', '55', 'other', d)).toBeNull();
    expect(d.editMessage).not.toHaveBeenCalled();
  });

  it('honours a custom snooze duration', async () => {
    const d = deps({ snoozeMinutes: 25 });
    const toast = await applyReminderAction('tg:1', '55', `sn:${TASK_ID}`, d);
    expect(toast).toBe('Snoozed 25m');
  });
});
