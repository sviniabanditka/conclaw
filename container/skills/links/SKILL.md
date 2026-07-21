---
name: links
description: Report on saved links and describe them. Use when running the evening link digest task, when the user asks what they saved / "что я накидал", or when asked to tag or clean up the link archive.
---

# The link archive

Links sent on their own are captured without a reply and stored in SQLite at
`/workspace/store/messages.db`, table `links`. They are also visible in the
Telegram Mini App, which is where the user reads them — so what you write here
is what they see there.

```sql
-- links(id, group_folder, url, title, description, domain, tags, note,
--       read, added_at, read_at)
```

The point is that links are saved to be read later and then never are. A list
of bare URLs is no better than the chat scrollback. **Your job is to make each
one legible without opening it** — a title and one honest sentence about what it
is. That is the difference between an archive and a pile.

Find your group's folder once, and use it in every query:

```bash
sqlite3 -json /workspace/store/messages.db \
  "SELECT folder FROM registered_groups WHERE jid = 'CHAT_JID';"
```

## 1. Find what still needs describing

```bash
sqlite3 -json /workspace/store/messages.db "
  SELECT id, url FROM links
  WHERE group_folder = 'FOLDER' AND title IS NULL
  ORDER BY added_at;
"
```

## 2. Look at each one and write it down

Use `WebFetch` per URL, then store what you learned. Keep the description to one
or two sentences saying what it is and why someone would open it — not the
page's own marketing line.

```bash
sqlite3 /workspace/store/messages.db "
  UPDATE links
  SET title = 'Заголовок', description = 'Что это и зачем открывать', tags = 'rust, async'
  WHERE id = 12 AND group_folder = 'FOLDER';
"
```

Practical notes:

- **Escape single quotes** by doubling them (`''`), or the statement breaks on
  any title containing an apostrophe.
- **A page that will not load** still gets a title — the URL and a description
  saying it was unavailable. Leaving `title` NULL means it is offered to you
  again tomorrow, forever.
- **Do not try to read anything behind a login.** Record that and move on.
- **Tags are lowercase, comma-separated**, and few. Reuse tags already present
  in the table rather than inventing a synonym — the app filters by exact tag,
  so `rust` and `Rust` become two unrelated buckets.
- **Never set `read`.** That flag is the user's: it means *they* dealt with it.

## 3. Send the digest

Report only what is unread and from today. If there is nothing, **send nothing
at all** — a daily "ничего не сохранено" trains the user to ignore the digest.

```sql
SELECT url, title, description, tags FROM links
WHERE group_folder = 'FOLDER' AND read = 0 AND added_at >= date('now')
ORDER BY added_at;
```

```
🔖 Ссылки за день: 5

• *Название* — одно-два предложения
  https://…

• …

Две про одно и то же: X и Y — обе про <тему>.
```

Say when two links are about the same thing. That connection is the part the
user cannot get by scrolling back.

Nothing is deleted after the digest: the archive is the point, and the user
marks things read in the Mini App when they have actually dealt with them.

## Setting up the daily run

One `mcp__conclaw__schedule_task`, `kind: agent`, `context_mode: isolated`,
`schedule_type: cron`, e.g. `0 21 * * *`, whose prompt is: follow this skill —
describe anything undescribed, then send the digest. It costs one container a
day and only produces a message on days there is something to report.
