/**
 * The record of what went into an answer.
 *
 * It exists because working that out meant reading `docker logs` — which is
 * how this install eventually discovered that a skill it had been debugging
 * for hours had never loaded at all.
 */
import { describe, it, expect } from 'vitest';

import { MAX_TRACES, TraceStore, TurnRecorder } from './turn-trace.js';

describe('TurnRecorder', () => {
  it('records skills, tool counts, rules and duration', () => {
    const r = new TurnRecorder(3, 1000);
    r.skill('notes');
    r.tool('Read');
    r.tool('Read');
    r.tool('Write');
    const trace = r.finish(5200);

    expect(trace.skills).toEqual(['notes']);
    expect(trace.tools).toEqual({ Read: 2, Write: 1 });
    expect(trace.rules).toBe(3);
    expect(trace.durationMs).toBe(4200);
    expect(trace.startedAt).toBe(new Date(1000).toISOString());
  });

  // Loading the same skill twice in a turn says nothing extra.
  it('lists each skill once, in the order it was loaded', () => {
    const r = new TurnRecorder(0);
    r.skill('photos');
    r.skill('notes');
    r.skill('photos');
    expect(r.finish().skills).toEqual(['photos', 'notes']);
  });

  // An empty list is the answer to "which skill did it use", not missing data.
  it('records a turn that loaded nothing at all', () => {
    const trace = new TurnRecorder(0).finish();
    expect(trace.skills).toEqual([]);
    expect(trace.tools).toEqual({});
  });

  it('does not share state between turns', () => {
    const first = new TurnRecorder(0);
    first.skill('notes');
    expect(new TurnRecorder(0).finish().skills).toEqual([]);
  });
});

describe('TraceStore', () => {
  const trace = (n: number) => new TurnRecorder(n).finish();

  it('returns the newest turn first', () => {
    const store = new TraceStore();
    store.record('tg:1', trace(1));
    store.record('tg:1', trace(2));
    expect(store.recent('tg:1').map((t) => t.rules)).toEqual([2, 1]);
  });

  // In memory and unbounded would grow for the life of the process.
  it('keeps only the most recent turns', () => {
    const store = new TraceStore();
    for (let i = 0; i < MAX_TRACES + 3; i++) store.record('tg:1', trace(i));
    const kept = store.recent('tg:1');
    expect(kept).toHaveLength(MAX_TRACES);
    expect(kept[0].rules).toBe(MAX_TRACES + 2);
  });

  it('keeps chats apart', () => {
    const store = new TraceStore();
    store.record('tg:1', trace(1));
    expect(store.recent('tg:2')).toEqual([]);
  });

  it('is empty for a chat that has not answered yet', () => {
    expect(new TraceStore().recent('tg:1')).toEqual([]);
  });
});
