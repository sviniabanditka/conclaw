/**
 * Evening rundown and Friday week summary, rendered from the calendar cache.
 *
 * Both are notify tasks, so they cost no model call — but a notify task carries
 * fixed text, and a summary written at creation time would be stale by the time
 * it fires. The sync re-renders them every minute, so what goes out was composed
 * moments earlier. Recurring content stays current without anything running in
 * between.
 *
 * Silence is a feature: with nothing to report they are removed rather than sent
 * empty. A daily message that is usually "nothing today" trains you to ignore it.
 */
import { CalendarEvent } from './calendar-sync.js';
import { ScheduledTask } from './types.js';

export const TASK_ID_PREFIX = 'sum-';

/** Evening rundown, and the Friday look back. Local time. */
export const DAY_SUMMARY_CRON = '0 22 * * *';
export const WEEK_SUMMARY_CRON = '0 21 * * 5';

/** A meeting before this hour is worth flagging the night before. */
export const EARLY_HOUR = 10;

interface Parts {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  weekday: number;
}

/** Calendar fields as seen in a given zone — Date's own getters are host-local. */
function partsIn(ms: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const got: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) got[p.type] = p.value;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    y: Number(got.year),
    m: Number(got.month),
    d: Number(got.day),
    hour: Number(got.hour === '24' ? '0' : got.hour),
    minute: Number(got.minute),
    weekday: weekdays.indexOf(got.weekday),
  };
}

export function dayKey(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function hhmm(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60_000;
}

function line(e: CalendarEvent, timeZone: string): string {
  return `• ${hhmm(e.startMs, timeZone)} ${e.summary}`;
}

function totalHours(events: CalendarEvent[]): number {
  const ms = events.reduce(
    (sum, e) => sum + (e.endMs ? e.endMs - e.startMs : 0),
    0,
  );
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/**
 * The evening rundown: what happened today, what is booked tomorrow.
 * Returns null when neither has anything — nothing to say, so say nothing.
 */
export function daySummaryText(
  events: CalendarEvent[],
  now: number,
  timeZone: string,
): string | null {
  const todayKey = dayKey(now, timeZone);
  const tomorrowKey = dayKey(addDays(now, 1), timeZone);

  const today = events
    .filter((e) => dayKey(e.startMs, timeZone) === todayKey)
    .sort((a, b) => a.startMs - b.startMs);
  const tomorrow = events
    .filter((e) => dayKey(e.startMs, timeZone) === tomorrowKey)
    .sort((a, b) => a.startMs - b.startMs);

  if (today.length === 0 && tomorrow.length === 0) return null;

  const out: string[] = ['🌙 *Итог дня*'];

  if (today.length > 0) {
    out.push(
      '',
      `Сегодня встреч: ${today.length} (${totalHours(today)} ч)`,
      ...today.map((e) => line(e, timeZone)),
    );
  } else {
    out.push('', 'Сегодня встреч не было.');
  }

  if (tomorrow.length > 0) {
    out.push('', `*Завтра:* ${tomorrow.length}`, ...tomorrow.map((e) => line(e, timeZone)));
    const first = tomorrow[0];
    if (partsIn(first.startMs, timeZone).hour < EARLY_HOUR) {
      // The point of an evening rundown: an early start is actionable tonight
      // and merely alarming in the morning.
      out.push('', `⚠️ Раннее начало — в ${hhmm(first.startMs, timeZone)}`);
    }
  } else {
    out.push('', '*Завтра:* встреч нет.');
  }

  return out.join('\n');
}

/** Friday look back and ahead. Null when the week held nothing either way. */
export function weekSummaryText(
  events: CalendarEvent[],
  now: number,
  timeZone: string,
): string | null {
  const from = partsIn(now, timeZone);
  // Monday of the current week, in local terms.
  const sinceMonday = (from.weekday + 6) % 7;
  const weekStartKey = dayKey(addDays(now, -sinceMonday), timeZone);
  const weekEndKey = dayKey(addDays(now, 6 - sinceMonday), timeZone);
  const nextStartKey = dayKey(addDays(now, 7 - sinceMonday), timeZone);
  const nextEndKey = dayKey(addDays(now, 13 - sinceMonday), timeZone);

  const inRange = (e: CalendarEvent, a: string, b: string) => {
    const k = dayKey(e.startMs, timeZone);
    return k >= a && k <= b;
  };

  const thisWeek = events
    .filter((e) => inRange(e, weekStartKey, weekEndKey))
    .sort((a, b) => a.startMs - b.startMs);
  const nextWeek = events
    .filter((e) => inRange(e, nextStartKey, nextEndKey))
    .sort((a, b) => a.startMs - b.startMs);

  if (thisWeek.length === 0 && nextWeek.length === 0) return null;

  const out: string[] = ['📊 *Итог недели*', ''];
  out.push(`Встреч за неделю: ${thisWeek.length} (${totalHours(thisWeek)} ч)`);

  // Which meeting ate the most time is the one worth noticing.
  const byName = new Map<string, number>();
  for (const e of thisWeek) {
    byName.set(e.summary, (byName.get(e.summary) || 0) + (e.endMs ? e.endMs - e.startMs : 0));
  }
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length > 0) {
    out.push('', 'Больше всего времени:');
    for (const [name, ms] of top) {
      out.push(`• ${name} — ${Math.round((ms / 3_600_000) * 10) / 10} ч`);
    }
  }

  out.push('', `*Следующая неделя:* ${nextWeek.length}`);
  if (nextWeek.length > 0) {
    out.push(`Первая — ${hhmm(nextWeek[0].startMs, timeZone)} ${nextWeek[0].summary}`);
  }

  return out.join('\n');
}

export function dayTaskId(groupFolder: string): string {
  return `${TASK_ID_PREFIX}${groupFolder}-day`;
}

export function weekTaskId(groupFolder: string): string {
  return `${TASK_ID_PREFIX}${groupFolder}-week`;
}

export interface SummaryPlan {
  upsert: { id: string; prompt: string; cron: string }[];
  remove: string[];
}

export function planSummaries(
  groupFolder: string,
  events: CalendarEvent[],
  existing: ScheduledTask[],
  opts: { now: number; timeZone: string },
): SummaryPlan {
  const owned = existing.filter((t) => t.id.startsWith(TASK_ID_PREFIX));
  const byId = new Map(owned.map((t) => [t.id, t]));
  const plan: SummaryPlan = { upsert: [], remove: [] };

  const wanted: { id: string; text: string | null; cron: string }[] = [
    {
      id: dayTaskId(groupFolder),
      text: daySummaryText(events, opts.now, opts.timeZone),
      cron: DAY_SUMMARY_CRON,
    },
    {
      id: weekTaskId(groupFolder),
      text: weekSummaryText(events, opts.now, opts.timeZone),
      cron: WEEK_SUMMARY_CRON,
    },
  ];

  for (const item of wanted) {
    const current = byId.get(item.id);
    if (item.text === null) {
      // Nothing to report — drop it rather than send an empty summary.
      if (current) plan.remove.push(item.id);
      continue;
    }
    if (
      !current ||
      current.prompt !== item.text ||
      current.schedule_value !== item.cron
    ) {
      plan.upsert.push({ id: item.id, prompt: item.text, cron: item.cron });
    }
  }

  return plan;
}
