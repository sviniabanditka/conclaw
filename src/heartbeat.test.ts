/**
 * Dead-man's switch.
 *
 * The value is entirely in *not* pinging when things are broken — a heartbeat
 * that fires unconditionally reports a healthy bot right up until someone
 * notices it has been answering nobody for hours.
 */
import { describe, it, expect, vi } from 'vitest';

import { Heartbeat } from './heartbeat.js';

function setup(healthy: boolean | (() => boolean) = true) {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
  const isHealthy = () => {
    const ok = typeof healthy === 'function' ? healthy() : healthy;
    return ok ? { ok: true } : { ok: false, reason: 'channel disconnected' };
  };
  const heartbeat = new Heartbeat({
    url: 'https://hc.example/ping/abc',
    isHealthy,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { heartbeat, fetchImpl };
}

describe('Heartbeat', () => {
  it('pings when healthy', async () => {
    const { heartbeat, fetchImpl } = setup(true);
    await heartbeat.tick();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hc.example/ping/abc',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  // The whole point: silence is the alert.
  it('withholds the ping when unhealthy', async () => {
    const { heartbeat, fetchImpl } = setup(false);
    await heartbeat.tick();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resumes pinging once healthy again', async () => {
    let healthy = false;
    const { heartbeat, fetchImpl } = setup(() => healthy);

    await heartbeat.tick();
    expect(fetchImpl).not.toHaveBeenCalled();

    healthy = true;
    await heartbeat.tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // A monitoring outage must never take the bot with it.
  it('survives a failing ping', async () => {
    const { heartbeat, fetchImpl } = setup(true);
    fetchImpl.mockRejectedValue(new Error('network unreachable'));
    await expect(heartbeat.tick()).resolves.toBeUndefined();
  });

  it('beats immediately on start rather than waiting a full interval', async () => {
    const { heartbeat, fetchImpl } = setup(true);
    heartbeat.start();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    heartbeat.stop();
  });

  it('stops beating after stop()', async () => {
    vi.useFakeTimers();
    try {
      const { heartbeat, fetchImpl } = setup(true);
      heartbeat.start();
      await vi.advanceTimersByTimeAsync(0);
      heartbeat.stop();
      fetchImpl.mockClear();

      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
