/**
 * Live message throttling.
 *
 * Progress events fire per token while chat platforms rate-limit edits hard, so
 * the invariant under test is that event volume never reaches the network:
 * edits happen on the repaint timer alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { LiveMessage } from './live-message.js';

function deps(overrides: Partial<Parameters<typeof makeDeps>[0]> = {}) {
  return makeDeps(overrides);
}

function makeDeps(overrides: {
  sendResult?: string | null;
  editImpl?: (id: string, text: string) => Promise<void>;
} = {}) {
  const send = vi.fn().mockResolvedValue(
    overrides.sendResult === undefined ? '42' : overrides.sendResult,
  );
  const edit = vi.fn(overrides.editImpl ?? (() => Promise.resolve()));
  return { send, edit, intervalMs: 1000, backoffMs: 2000 };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('LiveMessage', () => {
  it('sends nothing until the first progress event', async () => {
    const d = deps();
    new LiveMessage(d);
    await vi.advanceTimersByTimeAsync(5000);
    expect(d.send).not.toHaveBeenCalled();
  });

  // Container start plus the entrypoint's compile step is many seconds of
  // silence; waiting for the first token to show the spinner defeats it.
  it('shows the spinner on start(), before any progress', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send.mock.calls[0][0]).toContain('Thinking');
  });

  it('does not send a second message when progress follows start()', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    live.onProgress({ kind: 'delta', text: 'hi' });
    await vi.advanceTimersByTimeAsync(0);

    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('sends exactly one message however many events arrive', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    for (let i = 0; i < 50; i++) live.onProgress({ kind: 'delta', text: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  // The core protection: 200 tokens in one second must not mean 200 edits.
  it('edits on the timer, not per event', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'start' });
    await vi.advanceTimersByTimeAsync(0);

    for (let i = 0; i < 200; i++) live.onProgress({ kind: 'delta', text: 'y' });
    expect(d.edit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(d.edit).toHaveBeenCalledTimes(1);
  });

  it('shows streamed text in the painted message', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'hello world' });
    await vi.advanceTimersByTimeAsync(1000);

    const painted = d.edit.mock.calls.at(-1)?.[1] as string;
    expect(painted).toContain('hello world');
  });

  it('reports the tool the agent is using', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'tool', tool: 'Read' });
    await vi.advanceTimersByTimeAsync(0);

    expect(d.send.mock.calls[0][0]).toContain('Read');
  });

  it('keeps repainting while only the spinner changes', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'static' });
    await vi.advanceTimersByTimeAsync(4000);
    // Spinner advances each tick, so content differs and edits keep landing.
    expect(d.edit.mock.calls.length).toBeGreaterThan(1);
  });

  it('backs off after a rate limit and never speeds up again', async () => {
    const d = makeDeps({
      editImpl: () => Promise.reject({ error_code: 429, parameters: { retry_after: 3 } }),
    });
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'a' });
    await vi.advanceTimersByTimeAsync(1000);
    const afterFirst = d.edit.mock.calls.length;

    // At the slower cadence, a second interval yields at most one more edit.
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.edit.mock.calls.length).toBe(afterFirst);
  });

  // "not modified" means the content already matches — it must not be treated
  // as a rate limit, which would needlessly halve the update rate.
  it('treats "not modified" as painted, without backing off', async () => {
    const d = makeDeps({
      editImpl: () => Promise.reject(new Error('Bad Request: message is not modified')),
    });
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'a' });

    await vi.advanceTimersByTimeAsync(3000);

    // Still ticking at the fast cadence: roughly one edit per interval.
    expect(d.edit.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stops editing once finished', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'a' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await live.finish()).toBe('42');
    d.edit.mockClear();
    live.onProgress({ kind: 'delta', text: 'ignored' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(d.edit).not.toHaveBeenCalled();
  });

  // Channels that cannot edit return null; the run must proceed silently.
  it('degrades to nothing when the channel cannot edit', async () => {
    const d = makeDeps({ sendResult: null });
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'a' });
    await vi.advanceTimersByTimeAsync(3000);

    expect(d.edit).not.toHaveBeenCalled();
    expect(await live.finish()).toBeNull();
  });

  it('caps live text so an edit can never exceed the platform limit', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    for (let i = 0; i < 200; i++) {
      live.onProgress({ kind: 'delta', text: 'x'.repeat(100) });
    }
    await vi.advanceTimersByTimeAsync(1000);

    const painted = d.edit.mock.calls.at(-1)?.[1] as string;
    expect(painted.length).toBeLessThan(4096);
  });

  it('exposes streamed text for the caller to fall back on', async () => {
    const d = deps();
    const live = new LiveMessage(d);
    live.onProgress({ kind: 'delta', text: 'partial answer' });
    expect(live.streamedText).toBe('partial answer');
  });
});
