import { useCallback, useEffect, useState } from 'react';
import { FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMeta } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Markdown } from '@/components/ui/markdown';
import { Sheet, SheetAction } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type NoteView } from '@/lib/api';
import { when } from '@/lib/format';
import { haptic, tap } from '@/lib/telegram';
import { useSheetChrome } from '@/lib/use-sheet-chrome';
import { useResource } from '@/lib/use-resource';

/** A new note has no id yet; the editor is the same either way. */
type Editing = NoteView | 'new' | null;

function Editor({
  editing,
  onClose,
  onSaved,
  onError,
  onOpenNote,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: Error) => void;
  onOpenNote: (target: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string>();
  // A new note opens in edit; an existing one opens as a rendered view, so the
  // common case — reading what the bot wrote — needs no keyboard.
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const isNew = editing === 'new';

  useEffect(() => {
    if (!editing) return;
    const note = editing === 'new' ? null : editing;
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setTags(note?.tags.join(', ') ?? '');
    setRefused(undefined);
    setMode(editing === 'new' ? 'edit' : 'view');
  }, [editing]);

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

  const save = () =>
    run(() =>
      !editing || editing === 'new'
        ? api.createNote({ title, body, tags })
        : api.saveNote(editing.id, { title, body, tags }),
    );

  useSheetChrome({
    open: Boolean(editing),
    onClose,
    action:
      mode === 'view'
        ? { text: 'Edit', onClick: () => setMode('edit') }
        : { text: 'Save', disabled: busy || !title.trim(), busy, onClick: save },
  });

  if (!editing) return null;
  const note = editing === 'new' ? null : editing;

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'New note' : mode === 'view' ? title : 'Edit note'}
    >
      {mode === 'view' && note ? (
        <div className="flex flex-col gap-3">
          {note.tags.length > 0 && (
            <div className="text-link text-[12.5px]">
              {note.tags.map((t) => `#${t}`).join(' ')}
            </div>
          )}
          {body.trim() ? (
            <Markdown onWikilink={onOpenNote}>{body}</Markdown>
          ) : (
            <div className="text-muted-foreground text-[14px]">Empty note.</div>
          )}
          <SheetAction>
            <Button size="block" onClick={() => setMode('edit')}>
              <Pencil className="size-4" />
              Edit
            </Button>
          </SheetAction>
        </div>
      ) : (
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

          <SheetAction>
            <Button size="block" disabled={busy || !title.trim()} onClick={save}>
              Save
            </Button>
          </SheetAction>
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
      )}
    </Sheet>
  );
}

export function Notes({ onError }: { onError: (e: Error) => void }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string>();
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(() => api.notes({ q, tag }), [q, tag]);
  const { data, refresh } = useResource(`notes:${tag ?? ''}:${q}`, load, onError);

  // A [[wikilink]] names a note by its title (its filename without .md). Match
  // it against what is loaded; a target with no match does nothing rather than
  // opening a blank editor for a note that is not there.
  const openByTitle = useCallback(
    (target: string) => {
      const found = data?.notes.find(
        (n) => n.title.toLocaleLowerCase() === target.toLocaleLowerCase(),
      );
      if (found) {
        tap();
        setEditing(found);
      }
    },
    [data],
  );

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
        onSaved={refresh}
        onError={onError}
        onOpenNote={openByTitle}
      />
    </>
  );
}
