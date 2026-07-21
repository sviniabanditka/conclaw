---
name: links
description: Report on the links collected during the day. Use when running the evening link digest task, or when the user asks what they saved / "что я накидал сегодня".
---

# Evening link digest

Links sent on their own during the day are captured without a reply and land in
`/workspace/group/links.jsonl`, one JSON object per line: `{"url": …, "at": …}`.
This reports on them once, in the evening.

The point is that links are sent to be read later and then never are. A list of
URLs read back is no better than the chat scrollback — what makes the digest
worth opening is knowing what each one *is* without opening it.

## 1. Read the collection

```bash
cat /workspace/group/links.jsonl 2>/dev/null
```

If the file is missing or empty, send nothing at all. A daily "ничего не
сохранено" is a message that trains the user to ignore the digest.

## 2. Look at each one

Use `WebFetch` per URL. For each, give one or two sentences: what it is and why
someone would open it — not the page's own marketing line.

- **A page that will not load** still belongs in the digest, marked as
  unavailable, with the URL. Dropping it silently loses something the user
  deliberately saved.
- **Do not try to read anything behind a login.** Report it as such and move on.
- **Say when two links are about the same thing.** That connection is the part
  the user cannot get by scrolling back.

## 3. Send the digest

```
🔖 Ссылки за день: 5

• *Название или суть* — одно-два предложения
  https://…

• …

Две про одно и то же: X и Y — обе про <тему>.
```

Then clear the file so tomorrow starts empty:

```bash
: > /workspace/group/links.jsonl
```

Clear it **only after** the digest has been sent. Clearing first and failing
during the send loses the day's collection with nothing to show for it.

## Setting up the daily run

One `mcp__conclaw__schedule_task`, `kind: agent`, `context_mode: isolated`,
`schedule_type: cron`, e.g. `0 21 * * *`, whose prompt is: read the file, follow
this skill, send the digest, clear the file. It costs one container a day, and
only produces a message on days there is something to report.
