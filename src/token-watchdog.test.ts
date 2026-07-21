/**
 * Credential watchdog.
 *
 * The failure it exists to prevent is silent: a tmux-hosted refresh loop dies,
 * nothing notices, and hours later every reply fails with 401. So the tests
 * that matter are the ones where things are broken — a healthy path proves
 * nothing here.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  TokenWatchdog,
  STALE_AFTER_MS,
  MIN_ATTEMPT_GAP_MS,
  FAILURES_BEFORE_ALERT,
} from './token-watchdog.js';

const MINUTE = 60_000;

function setup(opts: {
  ageMs?: number | null;
  scriptExists?: boolean;
  runImpl?: () => Promise<void>;
} = {}) {
  let clock = 1_000_000_000;
  const run = vi.fn(opts.runImpl ?? (() => Promise.resolve()));
  const notify = vi.fn().mockResolvedValue(undefined);
  const age = opts.ageMs === undefined ? 10 * MINUTE : opts.ageMs;

  const watchdog = new TokenWatchdog({
    logPath: '/logs/refresh-token.log',
    scriptPath: '/scripts/refresh-token.sh',
    notify,
    now: () => clock,
    exists: () => opts.scriptExists !== false,
    mtime: () => (age === null ? null : clock - age),
    run,
  });

  return {
    watchdog,
    run,
    notify,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('TokenWatchdog', () => {
  it('does nothing while the refresher is running normally', async () => {
    const { watchdog, run } = setup({ ageMs: 20 * MINUTE });
    await watchdog.tick();
    expect(run).not.toHaveBeenCalled();
  });

  it('refreshes once the log has gone stale', async () => {
    const { watchdog, run } = setup({ ageMs: STALE_AFTER_MS + MINUTE });
    await watchdog.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  // Script present but no log at all means it has never run.
  it('refreshes when the log does not exist yet', async () => {
    const { watchdog, run } = setup({ ageMs: null });
    await watchdog.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  // An install with no refresh script (API key rather than OAuth) must stay quiet.
  it('stays silent when refresh is not configured', async () => {
    const { watchdog, run, notify } = setup({
      ageMs: null,
      scriptExists: false,
    });
    await watchdog.tick();
    expect(run).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not retry faster than the minimum gap', async () => {
    const { watchdog, run, advance } = setup({ ageMs: STALE_AFTER_MS + MINUTE });
    await watchdog.tick();
    advance(MIN_ATTEMPT_GAP_MS - MINUTE);
    await watchdog.tick();
    expect(run).toHaveBeenCalledTimes(1);

    advance(2 * MINUTE);
    await watchdog.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('alerts only after repeated failures', async () => {
    const { watchdog, notify, advance } = setup({
      ageMs: STALE_AFTER_MS + MINUTE,
      runImpl: () => Promise.reject(new Error('claude not authenticated')),
    });

    for (let i = 0; i < FAILURES_BEFORE_ALERT - 1; i++) {
      await watchdog.tick();
      advance(MIN_ATTEMPT_GAP_MS + MINUTE);
    }
    expect(notify).not.toHaveBeenCalled();

    await watchdog.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/401|refresh/i);
  });

  // A broken credential must not turn into a message every tick.
  it('alerts once, not on every subsequent failure', async () => {
    const { watchdog, notify, advance } = setup({
      ageMs: STALE_AFTER_MS + MINUTE,
      runImpl: () => Promise.reject(new Error('nope')),
    });

    for (let i = 0; i < FAILURES_BEFORE_ALERT + 3; i++) {
      await watchdog.tick();
      advance(MIN_ATTEMPT_GAP_MS + MINUTE);
    }
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('re-arms the alert after a recovery', async () => {
    let failing = true;
    let clock = 1_000_000_000;
    let age = STALE_AFTER_MS + MINUTE;
    const notify = vi.fn().mockResolvedValue(undefined);
    const watchdog = new TokenWatchdog({
      logPath: '/l',
      scriptPath: '/s',
      notify,
      now: () => clock,
      exists: () => true,
      mtime: () => clock - age,
      run: () =>
        failing ? Promise.reject(new Error('x')) : Promise.resolve(),
    });

    for (let i = 0; i < FAILURES_BEFORE_ALERT; i++) {
      await watchdog.tick();
      clock += MIN_ATTEMPT_GAP_MS + MINUTE;
    }
    expect(notify).toHaveBeenCalledTimes(1);

    // Refresher comes back to life, then dies again.
    failing = false;
    age = MINUTE;
    await watchdog.tick();

    failing = true;
    age = STALE_AFTER_MS + MINUTE;
    for (let i = 0; i < FAILURES_BEFORE_ALERT; i++) {
      await watchdog.tick();
      clock += MIN_ATTEMPT_GAP_MS + MINUTE;
    }
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does not start a second refresh while one is in flight', async () => {
    let release: (() => void) | null = null;
    const { watchdog, run, advance } = setup({
      ageMs: STALE_AFTER_MS + MINUTE,
      runImpl: () => new Promise<void>((r) => { release = () => r(); }),
    });

    const first = watchdog.tick();
    advance(MIN_ATTEMPT_GAP_MS + MINUTE);
    await watchdog.tick();
    expect(run).toHaveBeenCalledTimes(1);

    release!();
    await first;
  });

  it('clears the failure count after a successful refresh', async () => {
    let failing = true;
    let clock = 1_000_000_000;
    const notify = vi.fn().mockResolvedValue(undefined);
    const watchdog = new TokenWatchdog({
      logPath: '/l',
      scriptPath: '/s',
      notify,
      now: () => clock,
      exists: () => true,
      mtime: () => clock - (STALE_AFTER_MS + MINUTE),
      run: () => (failing ? Promise.reject(new Error('x')) : Promise.resolve()),
    });

    await watchdog.tick();
    clock += MIN_ATTEMPT_GAP_MS + MINUTE;
    failing = false;
    await watchdog.tick();

    // Two more failures must not reach the alert threshold on their own.
    failing = true;
    clock += MIN_ATTEMPT_GAP_MS + MINUTE;
    await watchdog.tick();
    clock += MIN_ATTEMPT_GAP_MS + MINUTE;
    await watchdog.tick();
    expect(notify).not.toHaveBeenCalled();
  });
});
