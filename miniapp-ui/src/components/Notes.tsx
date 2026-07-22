import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Plus, Search, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMeta } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type NoteView } from '@/lib/api';
import { when } from '@/lib/format';
import { haptic, tap } from '@/lib/telegram';

/** A new note has no id yet; the editor is the same either way. */
type Editing = NoteView | 'new' | null;

function Editor({
  editing,
  onClose,
  onSaved,
  onError,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: Error) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string>();

  useEffect(() => {
    if (!editing) return;
    const note = editing === 'new' ? null : editing;
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setTags(note?.tags.join(', ') ?? '');
    setRefused(undefined);
  }, [editing]);

  if (!editing) return null;
  const isNew = editing === 'new';

  async function run(
    action: () => Promise<{ saved?: boolean; deleted?: boolean; reason?: string }>,
  ) {
    setBusy(true);
    setRefused(undefined);
    try {
      const res = await action();
      if (res.saved === false || res.deleted === false) {
        haptic('error');
        // The reason matters: "a note with that title exists" and "title is
        // required" want opposite corrections.
        setRefused(res.reason ?? 'not saved');
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
    <Sheet open onClose={onClose} title={isNew ? 'New note' : 'Edit note'}>
      <div className="flex flex-col gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          autoFocus={isNew}
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Markdown body"
          className="min-h-56 font-mono"
        />
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags, comma separated"
        />
        {refused && <div className="text-destructive px-1 text-[13px]">{refused}</div>}

        <Button
          size="block"
          disabled={busy || !title.trim()}
          onClick={() =>
            run(() =>
              isNew
                ? api.createNote({ title, body, tags })
                : api.saveNote(editing.id, { title, body, tags }),
            )
          }
        >
          Save
        </Button>
        {!isNew && (
          <Button
            variant="destructive"
            size="block"
            disabled={busy}
            onClick={() => run(() => api.deleteNote(editing.id))}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        )}
        <p className="text-muted-foreground px-1 text-[12px]">
          Saved straight into the Obsidian vault. The sync daemon commits it
          within a couple of minutes, so every edit has a history.
        </p>
      </div>
    </Sheet>
  );
}

export function Notes({ onError }: { onError: (e: Error) => void }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string>();
  const [data, setData] = useState<{ notes: NoteView[]; tags: string[] } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const loaded = useRef(false);

  const load = useCallback(() => {
    api.notes({ q, tag }).then((d) => {
      loaded.current = true;
      setData(d);
    }, onError);
  }, [q, tag, onError]);

  useEffect(() => {
    const id = setTimeout(load, loaded.current ? 200 : 0);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes"
            className="pl-9"
          />
        </div>
        <Button
          size="icon"
          className="size-11 shrink-0"
          title="New note"
          onClick={() => {
            tap();
            setEditing('new');
          }}
        >
          <Plus className="size-5" />
        </Button>
      </div>

      {data && data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.tags.map((t) => (
            <Badge
              key={t}
              asButton
              active={tag === t}
              onClick={() => {
                tap();
                setTag(tag === t ? undefined : t);
              }}
            >
              #{t}
            </Badge>
          ))}
        </div>
      )}

      {!data ? (
        <>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </>
      ) : data.notes.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-[14px]">
          No notes yet.
          <br />
          Tell the bot to write one, or tap + here.
        </div>
      ) : (
        data.notes.map((note) => (
          <Card
            key={note.id}
            className="cursor-pointer px-3 py-2.5"
            onClick={() => {
              tap();
              setEditing(note);
            }}
          >
            <div className="flex items-start gap-3">
              <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-medium">{note.title}</div>
                {note.body && (
                  <div className="text-muted-foreground mt-0.5 line-clamp-2 text-[12.5px]">
                    {note.body.replace(/[#*`>-]/g, ' ').replace(/\s+/g, ' ').trim()}
                  </div>
                )}
                <CardMeta className="mt-1">
                  {note.updated ? when(`${note.updated}T12:00:00.000Z`) : 'undated'}
                  {note.tags.length > 0 &&
                    ` · ${note.tags.map((t) => `#${t}`).join(' ')}`}
                </CardMeta>
              </div>
            </div>
          </Card>
        ))
      )}

      <Editor
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={load}
        onError={onError}
      />
    </>
  );
}
