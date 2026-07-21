---
name: watch
description: Watch a web page and report when it changes. Use when the user asks to be told about changes to a page — a price, a job listing, an order status, a release page, availability. Triggers on "следи за", "watch this page", "tell me when X changes".
---

# Watch a page for changes

Creates a scheduled task that fetches a page, fingerprints it, and only wakes an
agent when the fingerprint moves. A page that sits still costs one container
start per check and no tokens, so watchers are cheap to keep and cheap to have
several of.

**Main channel only** — watchers are created against the project's script, which
is mounted read-only in the main channel:

```bash
test -f /workspace/project/scripts/watch-page.sh && echo OK || echo NOT_MAIN
```

If `NOT_MAIN`, tell the user watchers can only be set up from the main chat.

## Creating a watcher

The check script is configured through variables prepended to it, because a task
carries its script but no separate environment. Build the script, then schedule
it.

```bash
WATCH_URL='https://example.com/page'   # what to watch
WATCH_ID='shoes-price'                 # short slug, unique per watcher
WATCH_SELECTOR=''                      # optional grep -E filter

{
  printf "export WATCH_URL=%q\n" "$WATCH_URL"
  printf "export WATCH_ID=%q\n" "$WATCH_ID"
  [ -n "$WATCH_SELECTOR" ] && printf "export WATCH_SELECTOR=%q\n" "$WATCH_SELECTOR"
  cat /workspace/project/scripts/watch-page.sh
} > /tmp/watcher.sh
cat /tmp/watcher.sh   # this whole text becomes the task's `script`
```

Then call `mcp__conclaw__schedule_task` with:

- **kind**: `agent` — a change needs describing, so the model must be able to run.
  The script keeps it asleep until then.
- **script**: the full text produced above.
- **prompt**: what to say when it *does* change, e.g.

  > Страница изменилась. В `script_data.data` — `url`, `id` и `excerpt` нового
  > содержимого. Коротко скажи пользователю, что именно поменялось, и приложи
  > ссылку. Если изменение косметическое (дата, счётчик) — не пиши ничего.

- **schedule_type**: `cron`
- **schedule_value**: match how fast the thing actually moves. `0 * * * *`
  (hourly) suits most pages; `*/15 8-23 * * *` for something time-sensitive.
  Every check is a container start, so do not go below 15 minutes without a
  reason.

Tell the user the first run only records a baseline, so the first report comes
from the *second* check onwards.

## Choosing a selector

Without one, the whole page is fingerprinted after scripts, styles and tags are
stripped. That is right for a page that changes rarely, but noisy for one with a
counter, a carousel or a "last updated" line.

`WATCH_SELECTOR` is a `grep -E` pattern applied to the stripped text; only the
matches are fingerprinted. To watch a price:

```
WATCH_SELECTOR='[0-9][0-9 ]*(грн|₴|USD|\$)'
```

Check what a selector actually matches before scheduling, by running the script
with the variables set and looking at the excerpt it reports.

## Listing and removing

Watchers are ordinary scheduled tasks. `mcp__conclaw__list_tasks` shows them;
their prompt mentions the page. Remove one with `mcp__conclaw__cancel_task`.

Stored fingerprints live in `/workspace/group/watchers/<id>.sha`. Deleting one
resets the baseline, which is the way to make a watcher forget a change it has
already reported.

## What it will not do

- **Pages that need a login.** The fetch is a plain unauthenticated request.
- **Content rendered by JavaScript.** The fingerprint is of the HTML as served.
  For those, use `agent-browser` in a scheduled agent task instead — more
  expensive, since it wakes the model on every check.
- **Telling you *what* changed by itself.** The script reports that the page
  moved and hands over an excerpt; the description is the agent's job.
