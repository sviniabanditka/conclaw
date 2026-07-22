/**
 * What went into one answer.
 *
 * With a dozen skills and a growing rules file, "why did it do that" stopped
 * being answerable. Working it out meant reading `docker logs` — which is how
 * this install discovered that its notes skill had never loaded at all, after
 * hours of assuming it had and that the instructions inside it were wrong.
 *
 * Kept in memory and bounded: it is a debugging aid for the last few answers,
 * not a record. Losing it on restart costs nothing that matters.
 */
export interface TurnTrace {
  /** Skills the agent actually loaded, in order, without duplicates. */
  skills: string[];
  /** Tool name to how many times it was used. */
  tools: Record<string, number>;
  /** How many learned rules were in the prompt. */
  rules: number;
  startedAt: string;
  durationMs: number;
}

/** Enough to explain the answer in front of you and the one before it. */
export const MAX_TRACES = 5;

export class TurnRecorder {
  private skills: string[] = [];
  private tools: Record<string, number> = {};
  private startedAtMs: number;
  readonly rules: number;

  constructor(rules: number, now: number = Date.now()) {
    this.rules = rules;
    this.startedAtMs = now;
  }

  skill(name: string): void {
    // Loading the same skill twice in a turn says nothing extra.
    if (!this.skills.includes(name)) this.skills.push(name);
  }

  tool(name: string): void {
    this.tools[name] = (this.tools[name] ?? 0) + 1;
  }

  finish(now: number = Date.now()): TurnTrace {
    return {
      skills: [...this.skills],
      tools: { ...this.tools },
      rules: this.rules,
      startedAt: new Date(this.startedAtMs).toISOString(),
      durationMs: now - this.startedAtMs,
    };
  }
}

/** The last few turns per chat, oldest dropped first. */
export class TraceStore {
  private traces = new Map<string, TurnTrace[]>();
  private limit: number;

  constructor(limit: number = MAX_TRACES) {
    this.limit = limit;
  }

  record(chatJid: string, trace: TurnTrace): void {
    const list = this.traces.get(chatJid) ?? [];
    list.push(trace);
    while (list.length > this.limit) list.shift();
    this.traces.set(chatJid, list);
  }

  /** Newest first, so the answer being looked at is the one on top. */
  recent(chatJid: string): TurnTrace[] {
    return [...(this.traces.get(chatJid) ?? [])].reverse();
  }
}
