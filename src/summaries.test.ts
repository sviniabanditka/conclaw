/**
 * Evening rundown and Friday summary.
 *
 * Two things carry the weight: the day boundary must be the user's, not the
 * host's — a bot in UTC would report "tomorrow" wrongly for anyone east of it —
 * and an empty summary must not be sent at all, since a daily message that
 * usually says "nothing" is one you stop reading.
 */
import { describe, it, expect } from 'vitest';

import { CalendarEvent } from './calendar-sync.js';
import {
  daySummaryText,
  weekSummaryText,
  planSummaries,
  dayTaskId,
  weekTaskId,
  TASK_ID_PREFIX,
} from './summaries.js';
import { ScheduledTask } from './types.js';

const TZ = 'Europe/Kyiv';
/** Tuesday 21 July 2026, 22:00 Kyiv. */
const NOW = Date.parse('2026-07-21T19:00:00Z');

function ev(startISO: string, summary: string, minutes = 60): CalendarEvent {
  const startMs = Date.parse(startISO);
  return {
    id: `${summary}-${startISO}`,
    summary,
    startMs,
    endMs: startMs + minutes * 60_000,
  };
}

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'x',
    group_folder: 'g',
    chat_jid: 'tg:1',
    prompt: 'p',
    schedule_type: 'cron',
    schedule_value: '0 22 * * *',
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

describe('daySummaryText', () => {
  it('lists today and tomorrow separately', () => {
    const text = daySummaryText(
      [
        ev('2026-07-21T13:00:00Z', 'Standup'),
        ev('2026-07-22T08:00:00Z', 'Планёрка'),
      ],
      NOW,
      TZ,
    )!;
    expect(text).toContain('Сегодня встреч: 1');
    expect(text).toContain('Standup');
    expect(text).toContain('*Завтра:* 1');
    expect(text).toContain('Планёрка');
  });

  // Times are rendered in the user's zone, not the host's.
  it('renders local times', () => {
    const text = daySummaryText([ev('2026-07-21T13:00:00Z', 'Standup')], NOW, TZ)!;
    expect(text).toContain('16:00');
  });

  // An event late on 21 July UTC is still 21 July in Kyiv, not the 22nd.
  it('uses the user timezone for the day boundary', () => {
    const text = daySummaryText([ev('2026-07-21T20:30:00Z', 'Поздняя')], NOW, TZ)!;
    expect(text).toContain('Сегодня встреч: 1');
    expect(text).toContain('*Завтра:* встреч нет');
  });

  it('warns when tomorrow starts early', () => {
    const text = daySummaryText([ev('2026-07-22T05:00:00Z', 'Ранняя')], NOW, TZ)!;
    // 08:00 Kyiv.
    expect(text).toContain('Раннее начало');
    expect(text).toContain('08:00');
  });

  it('does not warn about a normal start', () => {
    const text = daySummaryText([ev('2026-07-22T09:00:00Z', 'Обычная')], NOW, TZ)!;
    expect(text).not.toContain('Раннее начало');
  });

  it('sums the hours booked today', () => {
    const text = daySummaryText(
      [ev('2026-07-21T10:00:00Z', 'A', 30), ev('2026-07-21T12:00:00Z', 'B', 90)],
      NOW,
      TZ,
    )!;
    expect(text).toContain('(2 ч)');
  });

  // The whole point of the null: no message beats an empty one.
  it('returns null when both days are empty', () => {
    expect(daySummaryText([], NOW, TZ)).toBeNull();
    expect(daySummaryText([ev('2026-07-28T10:00:00Z', 'Далеко')], NOW, TZ)).toBeNull();
  });
});

describe('weekSummaryText', () => {
  const week = [
    ev('2026-07-20T09:00:00Z', 'Standup', 15),
    ev('2026-07-21T09:00:00Z', 'Standup', 15),
    ev('2026-07-22T12:00:00Z', 'Ретро', 120),
    ev('2026-07-27T08:00:00Z', 'Следующий понедельник'),
  ];

  it('counts this week and the next separately', () => {
    const text = weekSummaryText(week, NOW, TZ)!;
    expect(text).toContain('Встреч за неделю: 3');
    expect(text).toContain('*Следующая неделя:* 1');
  });

  it('names where the time went', () => {
    const text = weekSummaryText(week, NOW, TZ)!;
    expect(text).toContain('Ретро — 2 ч');
  });

  it('points at the first meeting of next week', () => {
    expect(weekSummaryText(week, NOW, TZ)!).toContain('Следующий понедельник');
  });

  it('returns null for an empty fortnight', () => {
    expect(weekSummaryText([], NOW, TZ)).toBeNull();
  });
});

describe('planSummaries', () => {
  const events = [ev('2026-07-21T13:00:00Z', 'Standup')];
  const opts = { now: NOW, timeZone: TZ };

  it('creates both summaries when there is something to say', () => {
    const plan = planSummaries('g', events, [], opts);
    expect(plan.upsert.map((u) => u.id).sort()).toEqual(
      [dayTaskId('g'), weekTaskId('g')].sort(),
    );
  });

  // Re-rendered every tick, so an unchanged summary must not churn the task.
  it('does nothing when the rendered text is unchanged', () => {
    const first = planSummaries('g', events, [], opts);
    const existing = first.upsert.map((u) =>
      task({ id: u.id, prompt: u.prompt, schedule_value: u.cron }),
    );
    expect(planSummaries('g', events, existing, opts).upsert).toEqual([]);
  });

  it('rewrites a summary when the calendar changed', () => {
    const first = planSummaries('g', events, [], opts);
    const existing = first.upsert.map((u) =>
      task({ id: u.id, prompt: u.prompt, schedule_value: u.cron }),
    );
    const more = [...events, ev('2026-07-21T15:00:00Z', 'Ещё одна')];
    const plan = planSummaries('g', more, existing, opts);
    expect(plan.upsert.map((u) => u.id)).toContain(dayTaskId('g'));
  });

  it('removes a summary that has nothing left to report', () => {
    const existing = [task({ id: dayTaskId('g') }), task({ id: weekTaskId('g') })];
    const plan = planSummaries('g', [], existing, opts);
    expect(plan.remove.sort()).toEqual([dayTaskId('g'), weekTaskId('g')].sort());
    expect(plan.upsert).toEqual([]);
  });

  it('never touches tasks it does not own', () => {
    const other = task({ id: 'sched-g-0900' });
    const plan = planSummaries('g', [], [other], opts);
    expect(plan.remove).toEqual([]);
    expect(plan.upsert.every((u) => u.id.startsWith(TASK_ID_PREFIX))).toBe(true);
  });
});
