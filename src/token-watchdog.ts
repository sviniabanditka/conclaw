/**
 * Keeps the Claude OAuth credential from going stale.
 *
 * The refresher is scheduled outside this process — cron, or a
 * `refresh-token-loop.sh` in tmux where there is no cron. A tmux loop dies with
 * its session and never restarts, and nothing reports that: the first symptom is
 * every reply failing with 401 several hours later, which reads like a broken
 * credential rather than a stopped scheduler.
 *
 * The watchdog lives inside the orchestrator on purpose. A separate supervisor
 * process would need supervising in turn, whereas if this process is down there
 * is no bot to keep working — nothing left to guard.
 *
 * It supervises rather than schedules: it acts only once the log has gone stale,
 * so it sits harmlessly alongside a healthy cron or loop and never doubles up.
 */
import { spawn } from 'child_process';
import fs from 'fs';

import { logger } from './logger.js';

export interface TokenWatchdogDeps {
  /** Log the refresher appends to; its mtime is the liveness signal. */
  logPath: string;
  /** Refresh script to run when the log has gone stale. */
  scriptPath: string;
  /** Tell the operator something needs hands. */
  notify: (message: string) => Promise<void>;
  /** Injected for tests. */
  now?: () => number;
  mtime?: (path: string) => number | null;
  exists?: (path: string) => boolean;
  run?: (scriptPath: string) => Promise<void>;
}

/** How often to look. Cheap — one stat call unless something is wrong. */
export const WATCHDOG_INTERVAL_MS = 10 * 60_000;
/**
 * Treat the refresher as dead past this age. The refresher runs hourly and the
 * token lives ~7h, so 90 min tolerates a missed cycle while leaving hours of
 * margin to recover.
 */
export const STALE_AFTER_MS = 90 * 60_000;
/** Never retry faster than this, so a persistently failing refresh cannot spin. */
export const MIN_ATTEMPT_GAP_MS = 15 * 60_000;
/** Escalate to the operator only after the automatic fix has genuinely failed. */
export const FAILURES_BEFORE_ALERT = 3;

function defaultMtime(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

function defaultRun(scriptPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Detached from the message loop: the script runs `claude -p` and takes
    // tens of seconds.
    const proc = spawn(scriptPath, [], { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
    );
  });
}

export class TokenWatchdog {
  private deps: Required<TokenWatchdogDeps>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAttempt = 0;
  private inFlight = false;
  private failures = 0;
  private alerted = false;

  constructor(deps: TokenWatchdogDeps) {
    this.deps = {
      now: () => Date.now(),
      mtime: defaultMtime,
      exists: (p: string) => fs.existsSync(p),
      run: defaultRun,
      ...deps,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), WATCHDOG_INTERVAL_MS);
    this.timer.unref?.();
    logger.info('Token refresh watchdog started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check. Exported behaviour is here so tests need no timers. */
  async tick(): Promise<void> {
    const { scriptPath, logPath, exists, mtime, now } = this.deps;

    // No script means token refresh was never set up for this install — an
    // API-key deployment, say. Staying quiet is correct.
    if (!exists(scriptPath)) return;

    const stamp = mtime(logPath);
    // A missing log with the script present means it has never run.
    const age = stamp === null ? Infinity : now() - stamp;
    if (age <= STALE_AFTER_MS) {
      this.failures = 0;
      this.alerted = false;
      return;
    }

    if (this.inFlight) return;
    if (now() - this.lastAttempt < MIN_ATTEMPT_GAP_MS) return;

    this.lastAttempt = now();
    this.inFlight = true;
    logger.warn(
      { ageMinutes: age === Infinity ? null : Math.round(age / 60_000) },
      'Token refresh looks stale, running it',
    );

    try {
      await this.deps.run(scriptPath);
      this.failures = 0;
      this.alerted = false;
      logger.info('Token refresh watchdog ran the refresher successfully');
    } catch (err) {
      this.failures++;
      logger.error(
        { err, failures: this.failures },
        'Token refresh watchdog failed to refresh',
      );
      if (this.failures >= FAILURES_BEFORE_ALERT && !this.alerted) {
        // Once, not every tick — a broken credential must not become a
        // notification loop.
        this.alerted = true;
        await this.deps
          .notify(
            '🚨 Token refresh is failing.\n\n' +
              `Tried ${this.failures} times and the credential is still stale, ` +
              'so replies will start failing with 401 once it expires.\n\n' +
              'Check `logs/refresh-token.log` and re-authenticate if needed.',
          )
          .catch(() => {});
      }
    } finally {
      this.inFlight = false;
    }
  }
}
