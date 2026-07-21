/**
 * A chat message that updates while the agent works.
 *
 * Progress events arrive per token, but chat platforms rate-limit edits hard,
 * so events only ever mutate local state — a repaint timer is the single thing
 * that talks to the network, at a fixed cadence no matter how fast tokens land.
 */
import { ProgressEvent } from './container-runner.js';
import { logger } from './logger.js';

/** Frames cycle so the message visibly changes even while text is unchanged. */
const SPINNER = ['✳', '✻', '✽', '✻'];

/** Platform hard limit is 4096; stay clear of it and let the final message carry everything. */
const MAX_LIVE_LENGTH = 3500;

export interface LiveMessageDeps {
  /** Send the first version, returning an id to edit. Null disables the live message. */
  send(text: string): Promise<string | null>;
  edit(messageId: string, text: string): Promise<void>;
  /** Repaint cadence in ms. */
  intervalMs?: number;
  /** Cadence to fall back to after a rate-limit response. */
  backoffMs?: number;
}

/** Recognise a rate-limit rejection across the shapes grammY/HTTP can produce. */
function isRateLimit(err: unknown): boolean {
  const e = err as { error_code?: number; parameters?: { retry_after?: number } };
  if (e?.error_code === 429 || e?.parameters?.retry_after) return true;
  return /429|too many requests|retry.?after/i.test(String(err));
}

/** "message is not modified" is a success for our purposes — content already matches. */
function isNotModified(err: unknown): boolean {
  return /not modified/i.test(String(err));
}

export class LiveMessage {
  private deps: LiveMessageDeps;
  private intervalMs: number;
  private backoffMs: number;

  private messageId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<void> | null = null;

  private text = '';
  private activity = 'Thinking…';
  private frame = 0;
  private lastPainted = '';
  private painting = false;
  private finished = false;

  constructor(deps: LiveMessageDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? 1000;
    this.backoffMs = deps.backoffMs ?? 2000;
  }

  /**
   * Show the message now, before any progress arrives.
   *
   * Waiting for the first token meant waiting out container start, the
   * entrypoint's compile step and SDK init — many seconds of silence. The
   * spinner is most useful exactly then.
   */
  start(): void {
    this.ensureStarted();
  }

  /** Feed a progress event. Cheap and synchronous — never touches the network. */
  onProgress(event: ProgressEvent): void {
    if (this.finished) return;
    if (event.kind === 'delta') {
      if (this.text.length < MAX_LIVE_LENGTH) this.text += event.text;
      this.activity = 'Writing…';
    } else if (event.kind === 'tool') {
      this.activity = `Using ${event.tool}…`;
    }
    this.ensureStarted();
  }

  private ensureStarted(): void {
    if (this.messageId || this.starting || this.finished) return;
    this.starting = (async () => {
      try {
        const id = await this.deps.send(this.render());
        // A null id means the channel cannot edit; stay silent rather than
        // spamming a new message per tick.
        if (id && !this.finished) {
          this.messageId = id;
          this.startTimer(this.intervalMs);
        }
      } catch (err) {
        logger.debug({ err }, 'Live message could not be started');
      }
    })();
  }

  private startTimer(ms: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.paint(), ms);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private render(): string {
    const head = `${SPINNER[this.frame % SPINNER.length]} ${this.activity}`;
    const body = this.text.trim();
    if (!body) return head;
    const shown =
      this.text.length >= MAX_LIVE_LENGTH ? `${body}\n…` : body;
    return `${head}\n\n${shown}`;
  }

  /** One repaint tick. Overlapping ticks are skipped, never queued. */
  private async paint(): Promise<void> {
    if (!this.messageId || this.painting || this.finished) return;
    this.frame++;
    const next = this.render();
    if (next === this.lastPainted) return;
    this.painting = true;
    try {
      await this.deps.edit(this.messageId, next);
      this.lastPainted = next;
    } catch (err) {
      if (isNotModified(err)) {
        this.lastPainted = next;
      } else if (isRateLimit(err)) {
        // Slow down rather than keep hammering; the ceiling only ever rises.
        this.intervalMs = Math.max(this.intervalMs, this.backoffMs);
        this.startTimer(this.intervalMs);
        logger.debug({ intervalMs: this.intervalMs }, 'Live message rate-limited, backing off');
      }
    } finally {
      this.painting = false;
    }
  }

  /**
   * Stop updating and settle the message.
   *
   * Returns the id if a live message exists and the caller should render the
   * final answer into it, or null if there is nothing to reuse and the answer
   * should be sent as a normal message.
   */
  async finish(): Promise<string | null> {
    this.finished = true;
    this.stopTimer();
    // A send started on the last tick may still be in flight.
    if (this.starting) await this.starting.catch(() => {});
    return this.messageId;
  }

  /** Text streamed so far — used to decide whether anything was shown at all. */
  get streamedText(): string {
    return this.text;
  }
}
