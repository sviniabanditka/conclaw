---
name: notes
description: Save, categorise and edit notes in the Obsidian vault. Use when the user says "запиши", "заметка", "сохрани это", "запомни" about something durable; when they ask what was written down ("что у меня записано про X"); or when they ask to change or delete a note.
---

# Notes in the Obsidian vault

Notes live as markdown in the vault mounted at `/workspace/extra/obsidian-vault`.
A host daemon commits and pushes every two minutes, so anything written here
appears in Obsidian on the user's other devices without further action — and is
versioned in git, which is why nothing here needs a backup or an undo of its own.

**Write only under `conclaw/`.** `Claude/` is another tool's knowledge base and
`plannotator/` is generated; editing either corrupts something you did not build.
You may *link* to a note in `Claude/` — just never write there.

Two rules that the rest of this skill assumes:

- **Always reply when you have written, changed or deleted something.** A save
  that produces silence is indistinguishable from a save that failed, and the
  user has no way to tell without opening Obsidian.
- **Do this yourself.** It is a search, a file write and a one-line index edit —
  delegating it to a sub-agent costs more than it saves and loses your reply.

## What belongs here

A note is something the **user** decided is worth keeping and will want back in
their own words: a fact, a decision, a plan, a reference. That is different from
the other two memories, and the difference is what stops this becoming a third
pile of the same thing:

| | holds | who writes it | who reads it |
|---|---|---|---|
| **notes** (this) | what they chose to record | on request | them, in Obsidian |
| mnemon | what you inferred about them | automatically | you |
| messages table | what was literally said | automatically | the `history` skill |

Do not write a note for something already answered in the chat, for your own
conclusions, or "just in case". If it is not worth them opening later, it is not
a note.

## 1. Look before you write

Two commands, every time, before creating anything. Skipping them is how a vault
rots into `деплой`, `deploy` and `deployment` as three unrelated tags.

```bash
cd /workspace/extra/obsidian-vault

# Does this note already exist? Editing beats a near-duplicate.
grep -ril 'КЛЮЧЕВОЕ СЛОВО' conclaw/ --include='*.md'

# The taxonomy actually in use, most common first.
grep -h '^tags:' -r . --include='*.md' | sed 's/tags: *\[//;s/\]//' \
  | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | sort | uniq -c | sort -rn | head -30
```

**Reuse an existing tag whenever one fits.** Invent a tag only when nothing does,
and then only one. Same for folders: `conclaw/_MOC.md` declares the structure —
follow it, and if you genuinely need a new folder, add it to the MOC in the same
turn or the next note will not find it.

## 2. Categorise

Two axes, and they are not interchangeable:

- **`type:`** — what the note *is*. Use one already in the vault:
  `knowledge` (a durable fact), `decision` (a choice and why), `session`
  (the outcome of a conversation). Do not invent a sixth kind.
- **`tags:`** — what it is *about*. Two to five, from the census above.

Include the type as the first tag, as the rest of the vault does.

Choose both yourself from what the user said — that is the point of this being
automatic. But if the note is a decision and you cannot tell *why* it was
decided, ask, rather than filing a decision with no reasoning in it.

## 3. Write the file

**Path.** `conclaw/_MOC.md` declares the folders; a note in the root of
`conclaw/` is a note outside the structure the user set up, and they accumulate:

```
conclaw/General/<Название>.md     общие заметки
conclaw/Sessions/<Название>.md    итоги разговора
```

**Filename = the title, exactly.** Obsidian links by filename, so the `[[…]]` in
the index shows whatever the file is called — a file named
`conclaw-mini-app-инfra` under a heading "Мини-апп ConClaw" reads as a different
note. Short, human, in the user's language, no timestamp: Obsidian shows dates
itself and a date inside a link is noise.

Write the **whole file in one operation**. The sync daemon commits on a timer
and can otherwise catch a half-written file.

```markdown
---
created: 2026-07-22
updated: 2026-07-22
project: general
type: knowledge
tags: [knowledge, домен, инфраструктура]
---

# Домен sviniabanditka.com

Регистратор — Namecheap, продление вручную до 3 марта.

## Детали
- DNS у Cloudflare, A-запись на Contabo VPS.

Связано: [[k3s cluster — local declarative backup & restore]]
```

- `created` and `updated` are the same on a new note; only `updated` moves later.
- `project: general` unless the note is clearly about one named project.
- **Link related notes** with `[[Заголовок]]`. A note nothing links to is a note
  nobody finds again — the link is most of the value of keeping it here rather
  than in a database.

Then add a line under `## Записи` in `conclaw/_MOC.md`, newest first:

```markdown
- [[Домен sviniabanditka.com]] — продление, DNS
```

## 4. Editing

Find the file, change it, **bump `updated:`**. Never write a second note about
the same thing.

- **Adding to a note**: put it in the right section, or add a section. Do not
  append to the end of the file regardless of structure.
- **The user corrects a fact**: replace it. This is not a log — git holds the
  previous version, so the note itself should read as currently true.
- **Retagging**: if a tag turns out to be a synonym of an existing one, fix it
  everywhere it appears, not just here.

## 5. Deleting

Delete the file **and** its line in `_MOC.md`, then say which note went. Git
keeps it recoverable, so this is safe — but a dangling MOC entry is not, so
never do one without the other.

## 6. Answering "что у меня записано про X"

Search, then answer the question — do not paste files.

```bash
grep -ril 'X' /workspace/extra/obsidian-vault/conclaw/ --include='*.md'
```

Quote the line that answers it and name the note it came from. If several notes
are relevant, say how they relate. If nothing matches, say so plainly rather
than answering from memory — the point of the vault is that it is checkable.

## Reporting back

Never finish silently. One line, so a miscategorisation is visible immediately
and cheap to correct while the user is still looking:

```
📝 Записал — *Домен sviniabanditka.com* (knowledge · домен, инфраструктура)
```

Say what changed, in the same shape, for an edit (`✏️ Дополнил`) or a delete
(`🗑 Удалил`). If you chose a new tag or a new folder, say that too — those are
the decisions worth catching early.
