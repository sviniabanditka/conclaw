/**
 * Reconstructing the last few days from traces that already exist.
 *
 * The bug worth guarding is the timezone one: every timestamp is stored in
 * UTC, and a day boundary drawn in the wrong zone silently moves three hours
 * of every Kyiv evening into tomorrow — producing a chart that is wrong in a
 * way nobody notices, because it still looks like a chart.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { dayStats, type DayStatsDeps } from './day-stats.js';

const TZ = 'Europe/Kyiv';
/** 2026-07-22T12:00:00Z — 15:00 in Kyiv. */
const NOW = Date.parse('2026-07-22T12:00:00.000Z');

let dir: string;
let eventsFile: string;
let notesDir: string;

function deps(over: Partial<DayStatsDeps> = {}): DayStatsDeps {
  return {
    timeZone: TZ,
    eventsFile,
    notesDir,
    linkTimestamps: () => [],
    messageTimestamps: () => [],
    taskRuns: () => [],
    now: () => NOW,
    ...over,
  };
}

function writeEvents(events: unknown[]) {
  fs.writeFileSync(eventsFile, JSON.stringify(events));
}

function writeNote(name: string, updated: string) {
  fs.writeFileSync(
    path.join(notesDir, name),
    `---\ncreated: 2026-07-01\nupdated: ${updated}\ntype: knowledge\n---\n\n# ${name}\n`,
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daystats-'));
  eventsFile = path.join(dir, 'calendar_events.json');
  notesDir = path.join(dir, 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the window', () => {
  it('returns the requested number of days, oldest first, ending today', () => {
    const days = dayStats(deps(), 7);
    expect(days).toHaveLength(7);
    expect(days[0].day).toBe('2026-07-16');
    expect(days[6].day).toBe('2026-07-22');
  });

  // A gap in a chart reads as missing data; "nothing happened" is an answer.
  it('includes empty days rather than omitting them', () => {
    const days = dayStats(deps(), 3);
    expect(days.every((d) => d.messagesFromUser === 0)).toBe(true);
    expect(days.map((d) => d.day)).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
    ]);
  });

  it('ignores anything outside the window', () => {
    const days = dayStats(
      deps({ messageTimestamps: () => [{ timestamp: '2020-01-01T10:00:00Z', is_bot_message: 0 }] }),
      7,
    );
    expect(days.reduce((n, d) => n + d.messagesFromUser, 0)).toBe(0);
  });
});

describe('timezone', () => {
  // 22:30 UTC is already 01:30 the next day in Kyiv. Bucketing in UTC would
  // put a late-evening message on the wrong day, every day.
  it('buckets a late-evening event by the local day, not the UTC one', () => {
    const local = dayStats(
      deps({
        messageTimestamps: () => [
          { timestamp: '2026-07-21T22:30:00.000Z', is_bot_message: 0 },
        ],
      }),
      7,
    );
    const byDay = Object.fromEntries(local.map((d) => [d.day, d.messagesFromUser]));
    expect(byDay['2026-07-22']).toBe(1);
    expect(byDay['2026-07-21']).toBe(0);
  });
});

describe('meetings', () => {
  it('counts timed events and their minutes', () => {
    writeEvents([
      {
        start: { dateTime: '2026-07-22T09:00:00+03:00' },
        end: { dateTime: '2026-07-22T09:30:00+03:00' },
      },
      {
        start: { dateTime: '2026-07-22T14:00:00+03:00' },
        end: { dateTime: '2026-07-22T15:00:00+03:00' },
      },
    ]);
    const today = dayStats(deps(), 7).at(-1)!;
    expect(today.meetings).toBe(2);
    expect(today.meetingMinutes).toBe(90);
  });

  // An all-day entry is not time anybody spent, and a cancelled one is not
  // time anybody spent either.
  it('ignores all-day and cancelled events', () => {
    writeEvents([
      { start: { date: '2026-07-22' }, end: { date: '2026-07-23' } },
      {
        status: 'cancelled',
        start: { dateTime: '2026-07-22T09:00:00+03:00' },
        end: { dateTime: '2026-07-22T10:00:00+03:00' },
      },
    ]);
    expect(dayStats(deps(), 7).at(-1)!.meetings).toBe(0);
  });

  it('survives a missing or corrupt calendar cache', () => {
    expect(dayStats(deps(), 3).at(-1)!.meetings).toBe(0);
    fs.writeFileSync(eventsFile, 'not json');
    expect(dayStats(deps(), 3).at(-1)!.meetings).toBe(0);
  });
});

describe('links', () => {
  it('counts saving and reading on their own days', () => {
    const days = dayStats(
      deps({
        linkTimestamps: () => [
          { added_at: '2026-07-20T10:00:00Z', read_at: '2026-07-22T10:00:00Z' },
          { added_at: '2026-07-22T08:00:00Z', read_at: null },
        ],
      }),
      7,
    );
    const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
    expect(byDay['2026-07-20'].linksSaved).toBe(1);
    expect(byDay['2026-07-20'].linksRead).toBe(0);
    expect(byDay['2026-07-22'].linksSaved).toBe(1);
    expect(byDay['2026-07-22'].linksRead).toBe(1);
  });
});

describe('notes', () => {
  it('counts notes by when they were last updated', () => {
    writeNote('a.md', '2026-07-22');
    writeNote('b.md', '2026-07-22');
    writeNote('old.md', '2026-01-01');
    expect(dayStats(deps(), 7).at(-1)!.notesTouched).toBe(2);
  });

  it('looks inside subfolders', () => {
    fs.mkdirSync(path.join(notesDir, 'General'), { recursive: true });
    writeNote(path.join('General', 'deep.md'), '2026-07-22');
    expect(dayStats(deps(), 7).at(-1)!.notesTouched).toBe(1);
  });

  // `_MOC.md` is rewritten whenever a real note is added, so counting it
  // would double every entry.
  it('ignores index files', () => {
    writeNote('_MOC.md', '2026-07-22');
    writeNote('real.md', '2026-07-22');
    expect(dayStats(deps(), 7).at(-1)!.notesTouched).toBe(1);
  });

  it('ignores files with no frontmatter and a missing folder', () => {
    fs.writeFileSync(path.join(notesDir, 'plain.md'), '# no frontmatter');
    expect(dayStats(deps(), 7).at(-1)!.notesTouched).toBe(0);
    fs.rmSync(notesDir, { recursive: true });
    expect(dayStats(deps(), 7).at(-1)!.notesTouched).toBe(0);
  });
});

describe('messages and tasks', () => {
  it('keeps the two halves of the conversation apart', () => {
    const today = dayStats(
      deps({
        messageTimestamps: () => [
          { timestamp: '2026-07-22T09:00:00Z', is_bot_message: 0 },
          { timestamp: '2026-07-22T09:01:00Z', is_bot_message: 1 },
          { timestamp: '2026-07-22T09:02:00Z', is_bot_message: 1 },
        ],
      }),
      7,
    ).at(-1)!;
    expect(today.messagesFromUser).toBe(1);
    expect(today.messagesFromBot).toBe(2);
  });

  it('counts task runs', () => {
    const today = dayStats(
      deps({ taskRuns: () => ['2026-07-22T06:00:00Z', '2026-07-22T09:00:00Z'] }),
      7,
    ).at(-1)!;
    expect(today.tasksRun).toBe(2);
  });

  it('ignores an unparseable timestamp instead of throwing', () => {
    expect(() =>
      dayStats(deps({ taskRuns: () => ['not a date'] }), 7),
    ).not.toThrow();
  });
});
