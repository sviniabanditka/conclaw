/**
 * Cron in words.
 *
 * The rule that matters is the fallback: an expression this system does not
 * generate is shown raw rather than guessed at, because a schedule described
 * incorrectly is worse than one shown as an expression.
 */
import { describe, it, expect } from 'vitest';

import { describeSchedule } from './schedule';
import type { TaskView } from './api';

function task(over: Partial<TaskView>): TaskView {
  return {
    id: 't',
    title: 'x',
    nextRun: null,
    scheduleType: 'cron',
    scheduleValue: '0 9 * * *',
    kind: 'notify',
    status: 'active',
    derived: false,
    ...over,
  };
}

describe('describeSchedule', () => {
  it('reads the shapes this system generates', () => {
    expect(describeSchedule(task({ scheduleValue: '0 9 * * *' }))).toBe('Daily at 09:00');
    expect(describeSchedule(task({ scheduleValue: '55 8 * * 1-5' }))).toBe(
      'Weekdays at 08:55',
    );
    expect(describeSchedule(task({ scheduleValue: '0 21 * * 5' }))).toBe('Fri at 21:00');
    expect(describeSchedule(task({ scheduleValue: '*/15 8-23 * * *' }))).toBe(
      'Every 15 min',
    );
  });

  it('shows a one-off as a moment', () => {
    const got = describeSchedule(
      task({ scheduleType: 'once', scheduleValue: '2099-01-01T09:00:00.000Z' }),
    );
    expect(got).toMatch(/^Once, /);
  });

  // Guessing here would put a wrong schedule in front of someone deciding
  // whether to delete a task.
  it('falls back to the expression rather than guessing', () => {
    for (const value of ['0 9 1 * *', '15,45 * * * *', 'nonsense', '0 9 * *']) {
      expect(describeSchedule(task({ scheduleValue: value })), value).toBe(value);
    }
  });
});
