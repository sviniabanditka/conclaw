import { useEffect, useState } from 'react';
import { AlertTriangle, Bookmark, CheckCircle2, FileText, MessageSquare } from 'lucide-react';

import { BarRow, Ring } from '@/components/ui/chart';
import { Card, CardMeta, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type DayStats, type Overview as OverviewData } from '@/lib/api';
import { ago, plural, when } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The refresher runs hourly; past this the credential is heading for a 401. */
const STALE_AFTER_MS = 90 * 60_000;
/** A working day, as the denominator for the meeting ring. */
const DAY_HOURS = 8;

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Bookmark;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <div>
        <div className="text-lg leading-none font-semibold">{value}</div>
        <div className="text-muted-foreground text-[11.5px]">{label}</div>
      </div>
    </div>
  );
}

export function Overview({ onError }: { onError: (e: Error) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [days, setDays] = useState<DayStats[] | null>(null);

  useEffect(() => {
    api.overview().then(setData, onError);
    api.days(7).then((d) => setDays(d.days), onError);
  }, [onError]);

  if (!data || !days) {
    return (
      <>
        <Skeleton className="h-32" />
        <Skeleton className="h-44" />
        <Skeleton className="h-20" />
      </>
    );
  }

  const today = days[days.length - 1];
  const hours = Math.round(today.meetingMinutes / 6) / 10;
  const stale = data.lastRefreshAgeMs != null && data.lastRefreshAgeMs > STALE_AFTER_MS;
  const labels = days.map((d) => d.day);
  const weekMeetings = days.reduce((n, d) => n + d.meetings, 0);
  const weekLinks = days.reduce((n, d) => n + d.linksSaved, 0);
  const weekNotes = days.reduce((n, d) => n + d.notesTouched, 0);

  return (
    <>
      <Card>
        <Ring
          value={hours}
          max={DAY_HOURS}
          label={hours > 0 ? `${hours}h` : 'Clear'}
          sub={
            today.meetings > 0
              ? `${today.meetings} ${plural(today.meetings, 'meeting', 'meetings')} today`
              : 'No meetings today'
          }
        />
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3">
          <Metric icon={Bookmark} value={data.unreadLinkCount} label="unread" />
          <Metric icon={FileText} value={today.notesTouched} label="notes today" />
          <Metric
            icon={MessageSquare}
            value={today.messagesFromUser + today.messagesFromBot}
            label="messages"
          />
        </div>
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-[15px]">This week</CardTitle>
          <CardMeta className="mt-0">
            {weekMeetings} meetings · {weekLinks} links · {weekNotes} notes
          </CardMeta>
        </div>

        <CardMeta className="mt-3">Meetings</CardMeta>
        <BarRow values={days.map((d) => d.meetingMinutes)} labels={labels} accent />

        <CardMeta className="mt-3">Links saved</CardMeta>
        <BarRow values={days.map((d) => d.linksSaved)} labels={labels} />

        <CardMeta className="mt-3">Conversation</CardMeta>
        <BarRow
          values={days.map((d) => d.messagesFromUser + d.messagesFromBot)}
          labels={labels}
        />

        <div className="text-muted-foreground mt-2 flex gap-[3px] text-[10px]">
          {days.map((d) => (
            <span key={d.day} className="flex-1 text-center">
              {WEEKDAYS[new Date(`${d.day}T12:00:00Z`).getUTCDay()]}
            </span>
          ))}
        </div>
      </Card>

      <Card className="flex items-center gap-3">
        {stale ? (
          <AlertTriangle className="text-destructive size-4 shrink-0" />
        ) : (
          <CheckCircle2 className="text-muted-foreground size-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <CardTitle className="text-[14px]">Token</CardTitle>
          <CardMeta className={cn('mt-0.5', stale && 'text-destructive')}>
            refreshed {ago(data.lastRefreshAgeMs)}
          </CardMeta>
        </div>
      </Card>

      {data.upcoming.length > 0 && (
        <div className="text-muted-foreground mt-2 px-1 text-[12px] tracking-wide uppercase">
          Coming up
        </div>
      )}
      {data.upcoming.map((task) => (
        <Card key={task.id}>
          <CardTitle className="text-[14.5px]">{task.title}</CardTitle>
          <CardMeta>{when(task.nextRun)}</CardMeta>
        </Card>
      ))}
    </>
  );
}
