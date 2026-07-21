/**
 * Dead-man's switch to an external monitor.
 *
 * Every other health check in this process shares its fate: if the pod dies,
 * whatever was watching from inside dies with it, and the failure looks exactly
 * like a quiet day. The only observer that survives is one somewhere else, so
 * this pings out on a timer and lets a service alert when the pings stop.
 *
 * The ping is *conditional*. A timer that fires regardless would confirm only
 * that the process is running — it would keep reporting healthy while the chat
 * channel sat disconnected and the bot answered nobody. Skipping the ping is
 * also the one failure signal every heartbeat service understands, so no
 * vendor-specific "fail" endpoint is needed.
 */
import { logger } from './logger.js';

export interface HeartbeatDeps {
  /** Ping URL from the monitoring service. */
  url: string;
  /** Whether the bot is actually able to serve right now. */
  isHealthy: () => { ok: boolean; reason?: string };
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Default cadence. Monitoring services expect a period plus grace; a few
 * minutes detects an outage quickly without generating pointless traffic.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export class Heartbeat {
  private deps: HeartbeatDeps;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastOk = true;

  constructor(deps: HeartbeatDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    logger.info({ intervalMs: this.intervalMs }, 'Heartbeat started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One beat. Never throws — a monitoring failure must not affect the bot. */
  async tick(): Promise<void> {
    const health = this.deps.isHealthy();

    if (!health.ok) {
      // Log the transition only; an outage lasting hours should not fill the log.
      if (this.lastOk) {
        logger.warn(
          { reason: health.reason },
          'Heartbeat withheld — bot is not healthy',
        );
      }
      this.lastOk = false;
      return;
    }

    if (!this.lastOk) {
      logger.info('Heartbeat resumed — bot is healthy again');
    }
    this.lastOk = true;

    const doFetch = this.deps.fetchImpl ?? fetch;
    try {
      await doFetch(this.deps.url, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      // A missed ping is what the monitor is for; nothing to do but note it.
      logger.debug({ err }, 'Heartbeat ping failed');
    }
  }
}
