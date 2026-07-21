/**
 * Calendar events → reminder tasks.
 *
 * This replaces a five-minute poll, so the cases that matter are the ones the
 * poll handled implicitly by re-deciding constantly: a meeting that moves, one
 * that is cancelled, and one whose reminder time has already passed.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  parseEvents,
  planCalendarSync,
  eventTaskId,
  reminderText,
  syncCalendarEvents,
  TASK_ID_PREFIX,
  CalendarEvent,
} from './calendar-sync.js';
import { ScheduledTask } from './types.js';

const TZ = 'Europe/Kyiv';
const NOW = Date.parse('2026-07-21T12:00:00Z');

function rawEvent(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-abc',
    summary: 'Daily HMD standup',
    start: { dateTime: '2026-07-21T19:00:00+03:00' },
    end: { dateTime: '2026-07-21T19:15:00+03:00' },
    location: 'https://us06web.zoom.us/j/815',
    ...over,
  };
}

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-abc',
    summary: 'Standup',
    startMs: NOW + 60 * 60_000,
    endMs: NOW + 75 * 60_000,
    ...over,
  };
}

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'x',
    group_folder: 'g',
    chat_jid: 'tg:1',
    prompt: 'p',
    schedule_type: 'once',
    schedule_value: '',
    context_mode: 'isolated',
    kind: 'notify',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '',
    ...over,
  };
}

describe('parseEvents', () => {
  it('reads timed events', () => {
    const [e] = parseEvents(JSON.stringify([rawEvent()]));
    expect(e.summary).toBe('Daily HMD standup');
    expect(e.startMs).toBe(Date.parse('2026-07-21T19:00:00+03:00'));
    expect(e.link).toBe('https://us06web.zoom.us/j/815');
  });

  // "In 5 minutes" means nothing for an entry that has a date but no time.
  it('skips all-day events', () => {
    const allDay = { id: 'a', summary: 'Holiday', start: { date: '2026-07-21' } };
    expect(parseEvents(JSON.stringify([allDay]))).toEqual([]);
  });

  it('prefers a real conference link over a non-URL location', () => {
    const [e] = parseEvents(
      JSON.stringify([
        rawEvent({ location: 'Room 3', hangoutLink: 'https://meet.google.com/x' }),
      ]),
    );
    expect(e.link).toBe('https://meet.google.com/x');
  });

  it('omits a location that is not a link', () => {
    const [e] = parseEvents(JSON.stringify([rawEvent({ location: 'Room 3' })]));
    expect(e.link).toBeUndefined();
  });

  // The cache is written by an agent; it must not be able to crash the host.
  it('survives malformed cache contents', () => {
    expect(parseEvents('not json')).toEqual([]);
    expect(parseEvents('{}')).toEqual([]);
    expect(parseEvents('[{"id":"x"}]')).toEqual([]);
  });
});

describe('eventTaskId', () => {
  it('is stable for the same event', () => {
    expect(eventTaskId('g', 'evt-abc')).toBe(eventTaskId('g', 'evt-abc'));
  });

  it('differs between events', () => {
    expect(eventTaskId('g', 'a')).not.toBe(eventTaskId('g', 'b'));
  });

  // The id ends up inside a Snooze/Stop callback payload, capped at 64 bytes.
  it('stays short enough for a button payload', () => {
    const long = '_8lb4ajikd1hmec9g755m4kj7d5o4kti7ckoncp1n71jk0ujfdtmistbj_20260721T160000Z';
    expect(Buffer.byteLength(`sn:${eventTaskId('telegram_main', long)}`)).toBeLessThanOrEqual(64);
  });
});

describe('reminderText', () => {
  it('shows the time span and the link', () => {
    const text = reminderText(
      { id: 'e', summary: 'Standup', startMs: Date.parse('2026-07-21T16:00:00Z'), endMs: Date.parse('2026-07-21T16:15:00Z'), link: 'https://z' },
      5,
      TZ,
    );
    expect(text).toContain('Standup');
    expect(text).toContain('19:00 – 19:15');
    expect(text).toContain('https://z');
  });
});

describe('planCalendarSync', () => {
  const opts = { now: NOW, leadMinutes: 5, timeZone: TZ };

  it('schedules a reminder before each event', () => {
    const plan = planCalendarSync('g', [event()], [], opts);
    expect(plan.create).toHaveLength(1);
    expect(Date.parse(plan.create[0].runAt)).toBe(event().startMs - 5 * 60_000);
  });

  // Firing "in 5 minutes" for a meeting already under way is worse than silence.
  it('skips an event whose reminder time has passed', () => {
    const plan = planCalendarSync(
      'g',
      [event({ startMs: NOW + 60_000 })],
      [],
      opts,
    );
    expect(plan.create).toEqual([]);
  });

  it('does nothing when the reminder already matches', () => {
    const e = event();
    const id = eventTaskId('g', e.id);
    const runAt = new Date(e.startMs - 5 * 60_000).toISOString();
    const existing = task({
      id,
      prompt: reminderText(e, 5, TZ),
      next_run: runAt,
    });
    expect(planCalendarSync('g', [e], [existing], opts)).toEqual({
      create: [],
      update: [],
      remove: [],
    });
  });

  it('reschedules a meeting that moved', () => {
    const e = event();
    const id = eventTaskId('g', e.id);
    const existing = task({
      id,
      prompt: reminderText(e, 5, TZ),
      next_run: new Date(e.startMs - 5 * 60_000).toISOString(),
    });
    const moved = event({ startMs: e.startMs + 30 * 60_000 });
    const plan = planCalendarSync('g', [moved], [existing], opts);
    expect(plan.update).toHaveLength(1);
    expect(Date.parse(plan.update[0].runAt)).toBe(moved.startMs - 5 * 60_000);
  });

  it('drops the reminder for a cancelled meeting', () => {
    const existing = task({ id: `${TASK_ID_PREFIX}g-zzz` });
    const plan = planCalendarSync('g', [], [existing], opts);
    expect(plan.remove).toEqual([existing.id]);
  });

  // History is not rewritten: a reminder that already fired stays as a record.
  it('leaves already-fired reminders alone', () => {
    const done = task({ id: `${TASK_ID_PREFIX}g-zzz`, status: 'completed' });
    expect(planCalendarSync('g', [], [done], opts).remove).toEqual([]);
  });

  it('never touches tasks it does not own', () => {
    const other = task({ id: 'sched-g-0900' });
    const plan = planCalendarSync('g', [], [other], opts);
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([]);
  });
});

describe('syncCalendarEvents', () => {
  it('is a no-op when there is no cache file', () => {
    const createTask = vi.fn();
    const result = syncCalendarEvents({
      groupFolder: 'g',
      chatJid: 'tg:1',
      eventsFile: '/nonexistent/today_events.json',
      timeZone: TZ,
      getTasks: () => [],
      createTask,
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
    });
    expect(result).toBeNull();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('creates notify tasks', () => {
    const fs = require('fs');
    const file = `${process.cwd()}/src/calendar-sync.test.fixture.json`;
    fs.writeFileSync(
      file,
      JSON.stringify([
        rawEvent({ start: { dateTime: '2026-07-21T14:00:00Z' } }),
      ]),
    );
    try {
      const createTask = vi.fn();
      syncCalendarEvents({
        groupFolder: 'g',
        chatJid: 'tg:1',
        eventsFile: file,
        timeZone: TZ,
        getTasks: () => [],
        createTask,
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        now: () => NOW,
      });
      const created = createTask.mock.calls[0][0];
      expect(created.kind).toBe('notify');
      expect(created.schedule_type).toBe('once');
    } finally {
      fs.unlinkSync(file);
    }
  });
});
