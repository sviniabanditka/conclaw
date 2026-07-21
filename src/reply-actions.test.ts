/**
 * "Remind me later" under a reply.
 *
 * The text cannot ride in the 64-byte callback payload, so it lives in a
 * bounded in-memory index. That bound and the miss it eventually causes are the
 * interesting behaviour — everything else is bookkeeping.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  ReplyIndex,
  applyReplyAction,
  parseReplyAction,
  replyButtons,
  ReplyActionDeps,
} from './reply-actions.js';
import { ScheduledTask } from './types.js';

const CHAT = 'tg:1';
const MSG = '4242';
const NOW = 1_700_000_000_000;

function deps(over: Partial<ReplyActionDeps> = {}): ReplyActionDeps {
  return {
    groupFolder: 'telegram_main',
    getText: () => 'Завтра у тебя две встречи',
    createTask: vi.fn(),
    editMessage: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...over,
  };
}

function calls(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('ReplyIndex', () => {
  it('returns what was stored', () => {
    const idx = new ReplyIndex();
    idx.remember(CHAT, MSG, 'hello');
    expect(idx.get(CHAT, MSG)).toBe('hello');
  });

  it('keeps chats and messages apart', () => {
    const idx = new ReplyIndex();
    idx.remember(CHAT, MSG, 'a');
    expect(idx.get('tg:2', MSG)).toBeUndefined();
    expect(idx.get(CHAT, '9999')).toBeUndefined();
  });

  // Unbounded, this would grow for the life of the process.
  it('evicts the oldest entries past its limit', () => {
    const idx = new ReplyIndex(3);
    for (let i = 1; i <= 5; i++) idx.remember(CHAT, String(i), `t${i}`);
    expect(idx.size).toBe(3);
    expect(idx.get(CHAT, '1')).toBeUndefined();
    expect(idx.get(CHAT, '5')).toBe('t5');
  });

  it('refreshes an entry that is rewritten', () => {
    const idx = new ReplyIndex(2);
    idx.remember(CHAT, '1', 'a');
    idx.remember(CHAT, '2', 'b');
    idx.remember(CHAT, '1', 'a2');
    idx.remember(CHAT, '3', 'c');
    // '2' was the least recently touched, so it goes rather than '1'.
    expect(idx.get(CHAT, '1')).toBe('a2');
    expect(idx.get(CHAT, '2')).toBeUndefined();
  });
});

describe('parseReplyAction', () => {
  it('round-trips the buttons', () => {
    for (const b of replyButtons()) {
      expect(parseReplyAction(b.action)?.minutes).toBeGreaterThan(0);
    }
  });

  it('ignores actions that are not ours', () => {
    expect(parseReplyAction('sn:task-1')).toBeNull();
    expect(parseReplyAction('rl:abc')).toBeNull();
    expect(parseReplyAction('rl:0')).toBeNull();
  });

  it('keeps payloads inside the Telegram limit', () => {
    for (const b of replyButtons()) {
      expect(Buffer.byteLength(b.action)).toBeLessThanOrEqual(64);
    }
  });
});

describe('applyReplyAction', () => {
  it('schedules the reply as a one-off reminder', async () => {
    const d = deps();
    const toast = await applyReplyAction(CHAT, MSG, 'rl:60', d);

    expect(toast).toBe('Reminder in 1ч');
    const created = calls(d.createTask)[0][0] as ScheduledTask;
    expect(created.kind).toBe('notify');
    expect(created.schedule_type).toBe('once');
    expect(created.prompt).toContain('Завтра у тебя две встречи');
    expect(Date.parse(created.next_run!)).toBe(NOW + 60 * 60_000);
  });

  it('marks the reply so the pending reminder is visible', async () => {
    const d = deps();
    await applyReplyAction(CHAT, MSG, 'rl:180', d);
    const [, , text] = calls(d.editMessage)[0] as [string, string, string];
    expect(text).toContain('Завтра у тебя две встречи');
    expect(text).toContain('Напомню через 3ч');
  });

  // After a restart the index is empty; say so rather than scheduling nothing.
  it('reports a reply it no longer has', async () => {
    const d = deps({ getText: () => undefined });
    const toast = await applyReplyAction(CHAT, MSG, 'rl:60', d);

    expect(toast).toBe('Reply no longer tracked');
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.editMessage).not.toHaveBeenCalled();
  });

  // Two durations are two separate reminders, not one replacing the other.
  it('keeps reminders for different durations apart', async () => {
    const d = deps();
    await applyReplyAction(CHAT, MSG, 'rl:60', d);
    await applyReplyAction(CHAT, MSG, 'rl:180', d);
    const ids = calls(d.createTask).map((c) => (c[0] as ScheduledTask).id);
    expect(new Set(ids).size).toBe(2);
  });

  it('returns null for a callback belonging to something else', async () => {
    const d = deps();
    expect(await applyReplyAction(CHAT, MSG, 'sn:task-1', d)).toBeNull();
    expect(d.createTask).not.toHaveBeenCalled();
  });
});

// --- undo ---

describe('undo', () => {
  function undoDeps(over: Partial<ReplyActionDeps> = {}): ReplyActionDeps {
    return deps({
      getCreatedTasks: () => ['task-a', 'task-b'],
      deleteTask: vi.fn(),
      ...over,
    });
  }

  it('appears only when the turn created something', () => {
    expect(replyButtons().map((b) => b.label)).not.toContain('Undo');
    expect(replyButtons(true).map((b) => b.label)).toContain('Undo');
  });

  it('deletes every task the turn created', async () => {
    const d = undoDeps();
    const toast = await applyReplyAction(CHAT, MSG, 'un:1', d);

    expect(toast).toBe('Undone (2)');
    expect(calls(d.deleteTask).map((c) => c[0])).toEqual(['task-a', 'task-b']);
  });

  it('marks the reply so the undo is visible', async () => {
    const d = undoDeps();
    await applyReplyAction(CHAT, MSG, 'un:1', d);
    const [, , text] = calls(d.editMessage)[0] as [string, string, string];
    expect(text).toContain('Отменено: 2');
  });

  // After a restart the association is gone; say so rather than claiming success.
  it('reports when there is nothing recorded to undo', async () => {
    const d = undoDeps({ getCreatedTasks: () => [] });
    const toast = await applyReplyAction(CHAT, MSG, 'un:1', d);

    expect(toast).toBe('Nothing to undo');
    expect(d.deleteTask).not.toHaveBeenCalled();
  });

  it('does not treat undo as a remind action', async () => {
    const d = undoDeps();
    await applyReplyAction(CHAT, MSG, 'un:1', d);
    expect(d.createTask).not.toHaveBeenCalled();
  });
});
