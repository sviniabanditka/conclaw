---
name: vault-librarian
description: Weekly maintenance pass over the Obsidian vault. Use when running the librarian task, or when the user asks to tidy up the notes, find duplicates, or fix tags.
---

# Keeping the vault worth having

A knowledge base does not decay because notes are bad; it decays because
nothing ever looks at them again. Four hundred good notes nobody can navigate
are worth less than forty that link to each other.

This is a **weekly pass over `conclaw/` only**. `Claude/` belongs to another
tool and `plannotator/` is generated — read them for context, never edit them.

## The rule that makes this safe

**Propose deletions and merges; do not perform them.** Everything else — fixing
a tag, adding a link, repairing the index — is reversible in git and can be
done directly. Deleting or merging someone's notes on a schedule, while they
are not watching, is not something to be clever about.

## 1. Gather

```bash
cd /workspace/extra/obsidian-vault/conclaw

# Every note, with its tags.
grep -H '^tags:' -r . --include='*.md'

# Tags by frequency — the tail is where the synonyms hide.
grep -h '^tags:' -r . --include='*.md' | sed 's/tags: *\[//;s/\]//' \
  | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | sort | uniq -c | sort -n

# Which notes nothing links to.
grep -oh '\[\[[^]]*\]\]' -r . --include='*.md' | sort -u
```

## 2. Look for these, in this order

**Tag synonyms.** Two tags meaning one thing (`деплой` / `deploy`, `инфра` /
`инфраструктура`) split a topic in half and neither half looks incomplete. The
tail of the frequency list is where they live: a tag used once is either a
synonym of a common one or a topic with one note. Merge into the spelling
already used more often, everywhere it appears.

**Orphans.** A note no other note links to, and which the MOC does not list, is
findable only by search — which means only if you already remember it exists.
Link it from the most related note, or add it to `_MOC.md`.

**Index drift.** Entries in `_MOC.md` pointing at files that no longer exist, or
files with no entry. Both break navigation silently. Fix directly.

**Near-duplicates.** Two notes on one subject, usually because the second was
written without finding the first. Propose the merge, naming both and which
should absorb which — do not merge.

**Contradictions.** Two notes stating different facts about the same thing. One
of them is out of date, and you usually cannot tell which. Report both with
their `updated:` dates and let the user say.

**Stale by nature.** A note whose content had a horizon — a renewal date now
past, a "текущий план" from four months ago. Flag; do not delete.

**Missing frontmatter.** No `type:`, no `tags:`, no `updated:`. Fill in what you
can infer from the content; leave `created:` alone if it is there.

## 3. Report

One message, short, and only about what needs a decision. If nothing does, say
that in one line — a weekly report that always finds something is a report that
gets ignored.

```
🗂 Волт за неделю: 12 заметок

Поправил:
- тег `инфра` → `инфраструктура` (3 заметки)
- в _MOC.md висела ссылка на удалённую «Стоматолог Ирина» — убрал

Нужно твоё решение:
- «Домен sviniabanditka.com» и «DNS и хостинг» — про одно и то же,
  вторая новее. Слить в неё?
- «Тариф Contabo» говорит 12€/мес, «Инфраструктура — расходы» говорит 15€.
  Обновлены 12 мая и 3 июля.
```

State what you changed before what you are asking, so the message is useful
even when the user does not answer it.

## Setting up the weekly run

One `mcp__conclaw__schedule_task`, `kind: agent`, `context_mode: isolated`,
`schedule_type: cron`, e.g. `0 11 * * 0`, prompt: follow this skill. One
container a week, and it stays quiet on the weeks the vault is fine.
