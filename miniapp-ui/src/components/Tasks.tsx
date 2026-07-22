import { useCallback, useState } from 'react';
import { Bot, Bell, Pause, Play, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMeta } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type TaskView } from '@/lib/api';
import { when } from '@/lib/format';
import { describeSchedule } from '@/lib/schedule';
import { haptic, tap } from '@/lib/telegram';
import { useResource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';

type Filter = 'active' | 'paused' | 'all';

function TaskCard({
  task,
  onChanged,
  onError,
}: {
  task: TaskView;
  onChanged: () => void;
  onError: (e: Error) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string>();
  const paused = task.status !== 'active';

  async function run(
    action: () => Promise<{ updated?: boolean; deleted?: boolean; reason?: string }>,
  ) {
    setBusy(true);
    setRefused(undefined);
    try {
      const res = await action();
      if (res.updated === false || res.deleted === false) {
        haptic('error');
        setRefused(res.reason);
        setBusy(false);
        return;
      }
      haptic('success');
      onChanged();
    } catch (e) {
      setBusy(false);
      onError(e as Error);
    }
  }

  return (
    <Card className={cn('px-3 py-2.5', paused && 'opacity-60')}>
      <div className="flex items-start gap-3">
        {task.kind === 'agent' ? (
          <Bot className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        ) : (
          <Bell className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[14px] leading-snug">{task.title}</div>
          <CardMeta className="flex flex-wrap items-center gap-x-1.5">
            <span>{describeSchedule(task)}</span>
            {task.nextRun && !paused && <span>· next {when(task.nextRun)}</span>}
            {paused && <span>· paused</span>}
          </CardMeta>
          {task.derived && (
            <CardMeta>from schedule.md — deleting it will not stick</CardMeta>
          )}
          {refused && <div className="text-destructive mt-1 text-[12.5px]">{refused}</div>}
        </div>

        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          title={paused ? 'Resume' : 'Pause'}
          onClick={() => run(() => api.pauseTask(task.id, !paused))}
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          disabled={busy || task.derived}
          title={task.derived ? 'Edit schedule.md instead' : 'Delete'}
          onClick={() => run(() => api.deleteTask(task.id))}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

export function Tasks({ onError }: { onError: (e: Error) => void }) {
  const [filter, setFilter] = useState<Filter>('active');
  const load = useCallback(() => api.tasks(), []);
  const { data, refresh } = useResource('tasks', load, onError);
  const tasks = data?.tasks;

  if (!tasks) {
    return (
      <>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </>
    );
  }

  const shown = tasks.filter((t) =>
    filter === 'all' ? true : filter === 'paused' ? t.status !== 'active' : t.status === 'active',
  );
  const pausedCount = tasks.filter((t) => t.status !== 'active').length;

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['active', `Active (${tasks.length - pausedCount})`],
            ['paused', `Paused (${pausedCount})`],
            ['all', `All (${tasks.length})`],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <Badge
            key={value}
            asButton
            active={filter === value}
            onClick={() => {
              tap();
              setFilter(value);
            }}
          >
            {label}
          </Badge>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-[14px]">
          Nothing here.
        </div>
      ) : (
        shown.map((task) => (
          <TaskCard key={task.id} task={task} onChanged={refresh} onError={onError} />
        ))
      )}
    </>
  );
}
