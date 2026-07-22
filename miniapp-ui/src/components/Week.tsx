import { useEffect, useState } from 'react';

import { Card, CardMeta, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type DayStats } from '@/lib/api';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const METRICS: {
  key: keyof DayStats;
  label: string;
  format?: (d: DayStats) => string;
}[] = [
  {
    key: 'meetingMinutes',
    label: 'Встречи',
    format: (d) =>
      d.meetings ? `${d.meetings} · ${Math.round(d.meetingMinutes / 6) / 10} ч` : '',
  },
  { key: 'linksSaved', label: 'Ссылки' },
  { key: 'notesTouched', label: 'Заметки' },
  { key: 'messagesFromUser', label: 'Сообщения' },
];

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** Bars are drawn against the week's own peak — an absolute scale would flatten
 *  every metric whose numbers are small, which is most of them. */
function Row({ days, metric }: { days: DayStats[]; metric: (typeof METRICS)[number] }) {
  const values = days.map((d) => Number(d[metric.key]) || 0);
  const peak = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="mt-3">
      <CardMeta className="mt-0 flex justify-between">
        <span>{metric.label}</span>
        <span>{total || '—'}</span>
      </CardMeta>
      <div className="mt-1.5 flex h-10 items-end gap-1">
        {days.map((d, i) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={cn(
                'w-full rounded-sm transition-all',
                values[i] ? 'bg-primary' : 'bg-secondary',
              )}
              style={{ height: `${values[i] ? Math.max(12, (values[i] / peak) * 100) : 6}%` }}
              title={metric.format?.(d) || String(values[i])}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Week({ onError }: { onError: (e: Error) => void }) {
  const [days, setDays] = useState<DayStats[] | null>(null);

  useEffect(() => {
    api.days(7).then((d) => setDays(d.days), onError);
  }, [onError]);

  if (!days) return <Skeleton className="h-56" />;

  const today = days[days.length - 1];
  const meetHours = Math.round(today.meetingMinutes / 6) / 10;

  return (
    <Card>
      <CardTitle className="text-[15px]">Неделя</CardTitle>
      <CardMeta>
        сегодня: {today.meetings}{' '}
        {plural(today.meetings, 'встреча', 'встречи', 'встреч')}
        {today.meetingMinutes > 0 && ` (${meetHours} ч)`} · {today.linksSaved}{' '}
        {plural(today.linksSaved, 'ссылка', 'ссылки', 'ссылок')} · {today.notesTouched}{' '}
        {plural(today.notesTouched, 'заметка', 'заметки', 'заметок')}
      </CardMeta>

      {METRICS.map((m) => (
        <Row key={m.key} days={days} metric={m} />
      ))}

      <div className="text-muted-foreground mt-2 flex gap-1 text-[11px]">
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center">
            {WEEKDAYS[new Date(`${d.day}T12:00:00Z`).getDay()]}
          </span>
        ))}
      </div>
    </Card>
  );
}
