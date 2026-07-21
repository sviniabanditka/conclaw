import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Search, Tag, Trash2, Undo2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMeta, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type LinkFilter, type LinkView } from '@/lib/api';
import { when } from '@/lib/format';
import { haptic, tap } from '@/lib/telegram';

const FILTERS: { value: LinkFilter; label: string }[] = [
  { value: 'unread', label: 'Непрочитанные' },
  { value: 'read', label: 'Прочитанные' },
  { value: 'all', label: 'Все' },
];

function LinkCard({
  link,
  onChanged,
}: {
  link: LinkView;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(link.tags.join(', '));
  const [note, setNote] = useState(link.note ?? '');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ updated?: boolean; deleted?: boolean }>) {
    setBusy(true);
    try {
      const result = await action();
      if (result.updated === false || result.deleted === false) {
        haptic('error');
        setBusy(false);
        return;
      }
      haptic('success');
      onChanged();
    } catch {
      // The list reloads on the next action; a failed tap just re-enables.
      haptic('error');
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={link.url}
            target="_blank"
            rel="noopener"
            className="text-link flex items-start gap-1.5 font-medium break-words"
          >
            <span className="min-w-0">{link.title ?? link.url}</span>
            <ExternalLink className="mt-1 size-3.5 shrink-0 opacity-60" />
          </a>

          {link.description && <CardMeta>{link.description}</CardMeta>}

          <CardMeta className="flex flex-wrap items-center gap-x-1.5">
            <span>{link.domain}</span>
            <span>·</span>
            <span>{when(link.addedAt)}</span>
            {link.tags.map((tag) => (
              <span key={tag} className="text-link">
                #{tag}
              </span>
            ))}
          </CardMeta>

          {link.note && <div className="mt-2 text-[13.5px] opacity-85">{link.note}</div>}
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            title={link.read ? 'Вернуть в непрочитанные' : 'Прочитано'}
            onClick={() => run(() => api.setLinkRead(link.id, !link.read))}
          >
            {link.read ? <Undo2 className="size-4" /> : <Check className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Теги и заметка"
            onClick={() => {
              tap();
              setEditing((v) => !v);
            }}
          >
            <Tag className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            disabled={busy}
            title="Удалить"
            onClick={() => run(() => api.deleteLink(link.id))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="animate-in-up mt-3 flex flex-col gap-2">
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="теги через запятую"
          />
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="заметка"
            className="min-h-20"
          />
          <Button
            size="block"
            disabled={busy}
            onClick={() => run(() => api.updateLink(link.id, { tags, note }))}
          >
            Сохранить
          </Button>
        </div>
      )}
    </Card>
  );
}

export function Links({ onError }: { onError: (e: Error) => void }) {
  const [filter, setFilter] = useState<LinkFilter>('unread');
  const [tag, setTag] = useState<string>();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ links: LinkView[]; tags: string[] } | null>(null);
  // The first load should paint immediately; only typing needs debouncing.
  const loaded = useRef(false);

  const load = useCallback(() => {
    api.links({ filter, tag, q }).then((d) => {
      loaded.current = true;
      setData(d);
    }, onError);
  }, [filter, tag, q, onError]);

  useEffect(() => {
    const id = setTimeout(load, loaded.current ? 200 : 0);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <>
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по ссылкам"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Badge
            key={f.value}
            asButton
            active={filter === f.value && !tag}
            onClick={() => {
              tap();
              setTag(undefined);
              setFilter(f.value);
            }}
          >
            {f.label}
          </Badge>
        ))}
        {data?.tags.map((t) => (
          <Badge
            key={t}
            asButton
            active={tag === t}
            onClick={() => {
              tap();
              // Tapping the active tag clears it — always a way back.
              const next = tag === t ? undefined : t;
              setTag(next);
              if (next) setFilter('all');
            }}
          >
            #{t}
          </Badge>
        ))}
      </div>

      {!data ? (
        <>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </>
      ) : data.links.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-[14px]">
          Ничего не найдено.
          <br />
          Кинь ссылку в чат — она попадёт сюда.
        </div>
      ) : (
        data.links.map((link) => <LinkCard key={link.id} link={link} onChanged={load} />)
      )}
    </>
  );
}
