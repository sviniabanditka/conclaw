/**
 * Processing-reaction lifecycle.
 *
 * The 👀 reaction is the only signal that the bot picked a message up, so a
 * stranded one is indistinguishable from a dead bot. Two ways it used to get
 * stranded, both covered here:
 *
 *   1. Follow-ups sent while the container was busy got piped in and marked,
 *      but the finalizer only cleared the batch's last message.
 *   2. An error *after* output had already been sent skipped the 💔 entirely.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { markProcessing, finalizeReactions } from './index.js';
import { Channel } from './types.js';

function fakeChannel(): Channel & { setReaction: ReturnType<typeof vi.fn> } {
  return {
    name: 'fake',
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendMessage: vi.fn(),
    ownsJid: () => true,
    setReaction: vi.fn().mockResolvedValue(undefined),
  } as unknown as Channel & { setReaction: ReturnType<typeof vi.fn> };
}

const CHAT = 'tg:100200300';

function reactionsFor(channel: { setReaction: ReturnType<typeof vi.fn> }) {
  return channel.setReaction.mock.calls.map(([, id, emoji]) => [id, emoji]);
}

beforeEach(async () => {
  // Drain any state left by a previous test.
  await finalizeReactions(undefined, CHAT, '👍');
});

describe('processing reactions', () => {
  it('marks a message with 👀', () => {
    const channel = fakeChannel();
    markProcessing(channel, CHAT, '11');
    expect(reactionsFor(channel)).toEqual([['11', '👀']]);
  });

  // The piped-follow-up case: several messages marked in one run.
  it('clears every marked message, not just the last', async () => {
    const channel = fakeChannel();
    markProcessing(channel, CHAT, '11');
    markProcessing(channel, CHAT, '12');
    markProcessing(channel, CHAT, '13');
    channel.setReaction.mockClear();

    await finalizeReactions(channel, CHAT, '👍');

    expect(reactionsFor(channel).sort()).toEqual([
      ['11', '👍'],
      ['12', '👍'],
      ['13', '👍'],
    ]);
  });

  it('settles on 💔 when the run failed', async () => {
    const channel = fakeChannel();
    markProcessing(channel, CHAT, '11');
    channel.setReaction.mockClear();

    await finalizeReactions(channel, CHAT, '💔');

    expect(reactionsFor(channel)).toEqual([['11', '💔']]);
  });

  it('keeps chats independent', async () => {
    const channel = fakeChannel();
    markProcessing(channel, CHAT, '11');
    markProcessing(channel, 'tg:999', '99');
    channel.setReaction.mockClear();

    await finalizeReactions(channel, CHAT, '👍');

    expect(reactionsFor(channel)).toEqual([['11', '👍']]);
    await finalizeReactions(channel, 'tg:999', '👍');
  });

  // A second finalize must be a no-op, or a later run's verdict would repaint
  // messages belonging to an earlier one.
  it('does not re-touch messages after finalizing', async () => {
    const channel = fakeChannel();
    markProcessing(channel, CHAT, '11');
    await finalizeReactions(channel, CHAT, '👍');
    channel.setReaction.mockClear();

    await finalizeReactions(channel, CHAT, '💔');

    expect(channel.setReaction).not.toHaveBeenCalled();
  });

  it('survives a channel that cannot react', async () => {
    const channel = fakeChannel();
    delete (channel as { setReaction?: unknown }).setReaction;

    expect(() => markProcessing(channel, CHAT, '11')).not.toThrow();
    await expect(
      finalizeReactions(channel, CHAT, '👍'),
    ).resolves.toBeUndefined();
  });

  // Telegram rejects reactions on old messages; that must not abort the run.
  it('swallows reaction API failures', async () => {
    const channel = fakeChannel();
    markProcessing(channel, CHAT, '11');
    channel.setReaction.mockRejectedValue(new Error('message too old'));

    await expect(
      finalizeReactions(channel, CHAT, '👍'),
    ).resolves.toBeUndefined();
  });
});
