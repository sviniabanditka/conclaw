import { useEffect, useState } from 'react';
import { Bookmark, CalendarClock, KeyRound } from 'lucide-react';

import { Card, CardMeta, CardTitle } from '@/components/ui/card';
import { Week } from '@/components/Week';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type Overview as OverviewData } from '@/lib/api';
import { ago, plural, when } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The refresher runs hourly; past this the credential is heading for a 401. */
const STALE_AFTER_MS = 90 * 60_000;

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Bookmark;
  value: number;
  label: string;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <Icon className="text-muted-foreground size-4" />
      <div className="text-2xl leading-none font-semibold">{value}</div>
      <div className="text-muted-foreground text-[12.5px]">{label}</div>
    </Card>
  );
}

export function Overview({ onError }: { onError: (e: Error) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    api.overview().then(setData, onError);
  }, [onError]);

  if (!data) {
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </>
    );
  }

  const stale = data.lastRefreshAgeMs != null && data.lastRefreshAgeMs > STALE_AFTER_MS;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          icon={Bookmark}
          value={data.unreadLinkCount}
          label={`${plural(data.unreadLinkCount, 'непрочитанная', 'непрочитанные', 'непрочитанных')} из ${data.linkCount}`}
        />
        <Stat
          icon={CalendarClock}
          value={data.taskCount}
          label={plural(data.taskCount, 'задача', 'задачи', 'задач')}
        />
      </div>

      <Card className="flex items-center gap-3">
        <KeyRound className={cn('size-4', stale ? 'text-destructive' : 'text-muted-foreground')} />
        <div>
          <CardTitle className="text-[14px]">Токен</CardTitle>
          <CardMeta className={cn('mt-0.5', stale && 'text-destructive')}>
            обновлён {ago(data.lastRefreshAgeMs)}
          </CardMeta>
        </div>
      </Card>

      <Week onError={onError} />

      {data.upcoming.length > 0 && (
        <div className="text-muted-foreground mt-2 px-1 text-[12.5px] tracking-wide uppercase">
          Дальше
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
