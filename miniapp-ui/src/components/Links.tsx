import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Globe, Plus, Search, Settings2, Trash2, Undo2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMeta } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type LinkFilter, type LinkView } from '@/lib/api';
import { hostOf, when } from '@/lib/format';
import { haptic, tap } from '@/lib/telegram';

const FILTERS: { value: LinkFilter; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
  { value: 'all', label: 'All' },
];

/**
 * The favicon, or the first letter of the host.
 *
 * A row with no picture at all reads as broken rather than as pending, and the
 * icon arrives seconds after the link does — so the placeholder has to look
 * deliberate.
 */
function LinkIcon({ link }: { link: LinkView }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(link.url);

  if (link.icon && !failed) {
    return (
      <img
        src={link.icon}
        alt=""
        className="size-8 shrink-0 rounded-md object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="bg-secondary text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold uppercase">
      {host[0] ?? <Globe className="size-4" />}
    </div>
  );
}

function LinkRow({
  link,
  onEdit,
  onChanged,
  onError,
}: {
  link: LinkView;
  onEdit: () => void;
  onChanged: () => void;
  onError: (e: Error) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggleRead() {
    setBusy(true);
    try {
      const res = await api.setLinkRead(link.id, !link.read);
      haptic(res.updated ? 'success' : 'error');
      if (res.updated) onChanged();
      else setBusy(false);
    } catch (e) {
      setBusy(false);
      onError(e as Error);
    }
  }

  return (
    <Card className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <LinkIcon link={link} />

        <a
          href={link.url}
          target="_blank"
          rel="noopener"
          className="min-w-0 flex-1"
          onClick={tap}
        >
          <div className="truncate text-[14.5px] leading-snug font-medium">
            {link.title ?? hostOf(link.url)}
          </div>
          <div className="text-muted-foreground truncate text-[12px]">
            {hostOf(link.url)} · {when(link.addedAt)}
            {link.tags.length > 0 && ` · ${link.tags.map((t) => `#${t}`).join(' ')}`}
          </div>
        </a>

        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          title={link.read ? 'Mark unread' : 'Mark read'}
          onClick={toggleRead}
        >
          {link.read ? <Undo2 className="size-4" /> : <Check className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Edit"
          onClick={() => {
            tap();
            onEdit();
          }}
        >
          <Settings2 className="size-4" />
        </Button>
      </div>

      {link.description && (
        <CardMeta className="mt-1.5 pl-11">{link.description}</CardMeta>
      )}
      {link.note && (
        <div className="mt-1.5 pl-11 text-[13px] opacity-85">{link.note}</div>
      )}
    </Card>
  );
}

function EditSheet({
  link,
  onClose,
  onSaved,
  onError,
}: {
  link: LinkView | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: Error) => void;
}) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!link) return;
    setTitle(link.title ?? '');
    setTags(link.tags.join(', '));
    setNote(link.note ?? '');
  }, [link]);

  if (!link) return null;

  async function run(action: () => Promise<{ updated?: boolean; deleted?: boolean }>) {
    setBusy(true);
    try {
      const res = await action();
      if (res.updated === false || res.deleted === false) {
        haptic('error');
        setBusy(false);
        return;
      }
      haptic('success');
      onSaved();
      onClose();
    } catch (e) {
      setBusy(false);
      onError(e as Error);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Edit link">
      <div className="flex flex-col gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
        />
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags, comma separated"
        />
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note"
          className="min-h-20"
        />
        <div className="text-muted-foreground px-1 text-[12px] break-all">
          {link.url}
        </div>

        <Button
          size="block"
          disabled={busy}
          onClick={() => run(() => api.updateLink(link.id, { title, tags, note }))}
        >
          Save
        </Button>
        <Button
          variant="destructive"
          size="block"
          disabled={busy}
          onClick={() => run(() => api.deleteLink(link.id))}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
      </div>
    </Sheet>
  );
}

function AddSheet({
  open,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: Error) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  if (!open) return null;

  async function save() {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await api.addLink(url);
      if (!res.added) {
        haptic('error');
        setNote(res.reason ?? 'not saved');
        setBusy(false);
        return;
      }
      haptic('success');
      // Re-adding is how the store resurfaces a link, and saying nothing would
      // read as the button having failed.
      if (res.existed) setNote('Already saved — brought back to the top');
      setUrl('');
      onSaved();
      if (!res.existed) onClose();
      else setBusy(false);
    } catch (e) {
      setBusy(false);
      onError(e as Error);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Add link">
      <div className="flex flex-col gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          autoFocus
        />
        {note && <div className="text-muted-foreground px-1 text-[13px]">{note}</div>}
        <Button size="block" disabled={busy || !url.trim()} onClick={save}>
          Save
        </Button>
        <p className="text-muted-foreground px-1 text-[12px]">
          The title and icon are fetched in the background, the same as for a
          link sent to the chat.
        </p>
      </div>
    </Sheet>
  );
}

export function Links({ onError }: { onError: (e: Error) => void }) {
  const [filter, setFilter] = useState<LinkFilter>('all');
  const [tag, setTag] = useState<string>();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ links: LinkView[]; tags: string[] } | null>(null);
  const [editing, setEditing] = useState<LinkView | null>(null);
  const [adding, setAdding] = useState(false);
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

  // The icon arrives from a background fetch a few seconds after the link, so
  // a list opened right after saving one would otherwise show a blank row
  // until something else caused a reload.
  useEffect(() => {
    if (!data?.links.some((l) => !l.icon)) return;
    const id = setTimeout(load, 5000);
    return () => clearTimeout(id);
  }, [data, load]);

  return (
    <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search links"
            className="pl-9"
          />
        </div>
        <Button
          size="icon"
          className="size-11 shrink-0"
          title="Add link"
          onClick={() => {
            tap();
            setAdding(true);
          }}
        >
          <Plus className="size-5" />
        </Button>
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
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </>
      ) : data.links.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-[14px]">
          Nothing here.
          <br />
          Send a link to the chat and it lands in this list.
        </div>
      ) : (
        data.links.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            onEdit={() => setEditing(link)}
            onChanged={load}
            onError={onError}
          />
        ))
      )}

      <AddSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={load}
        onError={onError}
      />

      <EditSheet
        link={editing}
        onClose={() => setEditing(null)}
        onSaved={load}
        onError={onError}
      />
    </>
  );
}
