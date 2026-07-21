/**
 * schedule.md → reminder tasks.
 *
 * The hard part is midnight. A routine that runs 09:00 → 01:00 spans two
 * calendar days, so a naive "weekdays" cron fires the 01:00 reminder on the
 * tail of the wrong night. The expected cron strings below are the ones the
 * schedule had been maintained with by hand, which is what makes them a real
 * oracle rather than a restatement of the implementation.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  parseSchedule,
  reminderCron,
  planSync,
  taskIdFor,
  syncScheduleFile,
  TASK_ID_PREFIX,
} from './schedule-sync.js';
import { ScheduledTask } from './types.js';

const SCHEDULE = `# Расписание (будние дни)

| Время | Событие |
|-------|---------|
| 09:00 | Подъем |
| 09:30 | Работа |
| 23:00 | Заканчиваем день |
| 00:00 | Конец работы |
| 01:00 | Сон |
`;

describe('parseSchedule', () => {
  it('reads time and label rows, skipping the header', () => {
    const entries = parseSchedule(SCHEDULE);
    expect(entries.map((e) => e.time)).toEqual([
      '09:00',
      '09:30',
      '23:00',
      '00:00',
      '01:00',
    ]);
    expect(entries[0].label).toBe('Подъем');
  });

  it('marks rows after midnight as belonging to the next day', () => {
    const entries = parseSchedule(SCHEDULE);
    expect(entries.map((e) => e.dayOffset)).toEqual([0, 0, 0, 1, 1]);
  });

  it('ignores lines that are not schedule rows', () => {
    expect(parseSchedule('# Title\n\nsome prose\n')).toEqual([]);
  });

  it('normalises a single-digit hour', () => {
    expect(parseSchedule('| 9:05 | X |')[0].time).toBe('09:05');
  });
});

describe('reminderCron', () => {
  // These are the expressions the schedule ran on before it was derived.
  const cases: [string, string][] = [
    ['09:00', '55 8 * * 1-5'],
    ['09:30', '25 9 * * 1-5'],
    ['23:00', '55 22 * * 1-5'],
    ['00:00', '55 23 * * 1-5'],
    ['01:00', '55 0 * * 2-6'],
  ];

  it.each(cases)('%s → %s', (time, expected) => {
    const entry = parseSchedule(SCHEDULE).find((e) => e.time === time)!;
    expect(reminderCron(entry, 5)).toBe(expected);
  });

  // 00:00 is reminded the evening before, so its days shift back while the
  // event's do not — the inverse of the 01:00 case.
  it('shifts the day back when the lead time crosses midnight', () => {
    const entry = { time: '00:00', label: 'X', dayOffset: 1 };
    expect(reminderCron(entry, 5)).toBe('55 23 * * 1-5');
  });

  it('handles a lead time that crosses midnight from day zero', () => {
    const entry = { time: '00:10', label: 'X', dayOffset: 0 };
    // 23:55 the day before Mon–Fri is Sun–Thu.
    expect(reminderCron(entry, 15)).toBe('55 23 * * 0-4');
  });

  it('honours a custom lead time', () => {
    const entry = { time: '10:00', label: 'X', dayOffset: 0 };
    expect(reminderCron(entry, 30)).toBe('30 9 * * 1-5');
  });
});

function existingTask(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'x',
    group_folder: 'g',
    chat_jid: 'tg:1',
    prompt: 'p',
    schedule_type: 'cron',
    schedule_value: '0 0 * * *',
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

describe('planSync', () => {
  const entries = parseSchedule(SCHEDULE);

  it('creates a task per row when none exist', () => {
    const plan = planSync('g', entries, []);
    expect(plan.create).toHaveLength(5);
    expect(plan.update).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it('does nothing when tasks already match', () => {
    const current = entries.map((e) =>
      existingTask({
        id: taskIdFor('g', e),
        prompt: `⏰ Через 5 минут — *${e.label}* (${e.time})`,
        schedule_value: reminderCron(e, 5),
      }),
    );
    const plan = planSync('g', entries, current);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });

  it('updates a task whose time changed in the file', () => {
    const entry = entries[0];
    const stale = existingTask({
      id: taskIdFor('g', entry),
      prompt: `⏰ Через 5 минут — *${entry.label}* (${entry.time})`,
      schedule_value: '0 7 * * 1-5',
    });
    const plan = planSync('g', [entry], [stale]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].cron).toBe('55 8 * * 1-5');
  });

  it('removes a task whose row was deleted from the file', () => {
    const orphan = existingTask({ id: `${TASK_ID_PREFIX}g-2200` });
    const plan = planSync('g', [], [orphan]);
    expect(plan.remove).toEqual([orphan.id]);
  });

  // The one thing this must never do is touch someone else's tasks.
  it('leaves tasks it does not own completely alone', () => {
    const userTask = existingTask({ id: 'task-1234-abcd' });
    const plan = planSync('g', [], [userTask]);
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([]);
  });
});

describe('syncScheduleFile', () => {
  function deps(over: Partial<Parameters<typeof syncScheduleFile>[0]> = {}) {
    return {
      groupFolder: 'g',
      chatJid: 'tg:1',
      scheduleFile: '/nonexistent/schedule.md',
      getTasks: () => [] as ScheduledTask[],
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      nextRunFor: () => '2026-01-01T00:00:00.000Z',
      ...over,
    };
  }

  // A group without the file is not an error — it just does not use this.
  it('is a no-op when the file is missing', () => {
    const d = deps();
    expect(syncScheduleFile(d)).toBeNull();
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it('creates notify tasks, not agent tasks', () => {
    const file = `${process.cwd()}/src/schedule-sync.test.fixture.md`;
    const fs = require('fs');
    fs.writeFileSync(file, '| 10:00 | Test |\n');
    try {
      const d = deps({ scheduleFile: file });
      syncScheduleFile(d);
      expect(d.createTask).toHaveBeenCalledTimes(1);
      const created = (d.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(created.kind).toBe('notify');
      expect(created.schedule_value).toBe('55 9 * * 1-5');
    } finally {
      fs.unlinkSync(file);
    }
  });
});
