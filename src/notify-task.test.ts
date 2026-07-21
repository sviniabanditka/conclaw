/**
 * Fixed-text scheduled reminders.
 *
 * A 'notify' task exists to avoid a container start and a model call for text
 * that is already known. That shortcut skips two things the agent path does at
 * the end of its run — advancing next_run, and going through the per-chat queue
 * — and both have teeth, so they are what these tests pin down.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { _initTestDatabase, createTask, getTaskById } from './db.js';
import { runNotifyTask } from './task-scheduler.js';
import { ScheduledTask } from './types.js';

function makeTask(over: Partial<ScheduledTask> = {}): ScheduledTask {
  const task: ScheduledTask = {
    id: 'task-1',
    group_folder: 'telegram_main',
    chat_jid: 'tg:1',
    prompt: 'in 5 minutes — standup',
    schedule_type: 'cron',
    schedule_value: '*/5 * * * *',
    context_mode: 'isolated',
    kind: 'notify',
    next_run: new Date(Date.now() - 1000).toISOString(),
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: new Date().toISOString(),
    ...over,
  };
  createTask(task);
  return task;
}

beforeEach(() => _initTestDatabase());

describe('notify tasks', () => {
  it('sends the prompt verbatim', async () => {
    const task = makeTask();
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await runNotifyTask(task, { sendMessage });

    expect(sendMessage).toHaveBeenCalledWith('tg:1', 'in 5 minutes — standup');
  });

  // The agent path advances next_run at the end of its run. Skipping that on
  // this path would leave the task permanently due — re-selected on every
  // scheduler tick and fired in a tight loop.
  it('advances next_run so it does not fire in a loop', async () => {
    const task = makeTask();
    const before = getTaskById(task.id)!.next_run!;

    await runNotifyTask(task, { sendMessage: vi.fn().mockResolvedValue(undefined) });

    const after = getTaskById(task.id)!.next_run!;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  // Same hazard, worse: a send that keeps failing would spin forever.
  it('advances next_run even when sending fails', async () => {
    const task = makeTask();
    const before = getTaskById(task.id)!.next_run!;

    await runNotifyTask(task, {
      sendMessage: vi.fn().mockRejectedValue(new Error('telegram down')),
    });

    const after = getTaskById(task.id)!.next_run!;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  // last_result is what `list_tasks` shows the user, so a failed send has to
  // be visible there rather than looking like a clean run.
  it('records a failed send rather than reporting success', async () => {
    const task = makeTask();
    await runNotifyTask(task, {
      sendMessage: vi.fn().mockRejectedValue(new Error('telegram down')),
    });

    expect(getTaskById(task.id)!.last_result).toContain('telegram down');
  });

  it('records the delivered text on success', async () => {
    const task = makeTask();
    await runNotifyTask(task, { sendMessage: vi.fn().mockResolvedValue(undefined) });

    const after = getTaskById(task.id)!;
    expect(after.last_result).toContain('standup');
    expect(after.last_run).not.toBeNull();
  });

  it('completes a one-off instead of leaving it active', async () => {
    const task = makeTask({
      schedule_type: 'once',
      schedule_value: new Date().toISOString(),
    });

    await runNotifyTask(task, { sendMessage: vi.fn().mockResolvedValue(undefined) });

    const after = getTaskById(task.id)!;
    expect(after.status).toBe('completed');
    expect(after.next_run).toBeNull();
  });

  // Existing rows predate the column; they must keep running as agents.
  it('defaults to the agent kind when unspecified', () => {
    const task = makeTask({ id: 'task-legacy', kind: undefined });
    expect(getTaskById(task.id)!.kind).toBe('agent');
  });
});
