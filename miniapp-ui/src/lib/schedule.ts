import type { TaskView } from './api';
import { when } from './format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A cron expression, in words.
 *
 * Only the shapes this system actually generates are spelled out; anything
 * else falls back to the expression itself rather than a confident wrong
 * reading. This text sits next to a delete button, and a schedule described
 * incorrectly is worse than one shown raw.
 */
export function describeSchedule(task: TaskView): string {
  if (task.scheduleType === 'once') return `Once, ${when(task.scheduleValue)}`;

  const parts = task.scheduleValue.trim().split(/\s+/);
  if (parts.length !== 5) return task.scheduleValue;
  const [min, hour, dom, mon, dow] = parts;

  if (min.startsWith('*/')) return `Every ${min.slice(2)} min`;
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)} h`;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return task.scheduleValue;
  if (dom !== '*' || mon !== '*') return task.scheduleValue;

  const at = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dow === '*') return `Daily at ${at}`;
  if (dow === '1-5') return `Weekdays at ${at}`;
  if (/^\d$/.test(dow)) return `${DAYS[Number(dow) % 7]} at ${at}`;
  return task.scheduleValue;
}
