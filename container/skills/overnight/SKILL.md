---
name: overnight
description: Take on work that needs longer than a chat reply and deliver the result in the morning. Use when the user asks to look into something, research a topic, compare options, or prepare a summary "by morning" / "к утру" / "пока я сплю".
---

# Overnight work

Some questions do not fit a chat reply: comparing five options, reading a
specification, working through a repository. Rather than making the user wait,
schedule the work for the night and hand over the result with the morning
rundown.

Two separate moments, and keeping them apart is the whole point:

- **The work runs at night**, when nobody is waiting and a long run costs
  nothing in attention.
- **The result arrives in the morning.** A finished report at 03:40 is a
  notification in the middle of the night — the one thing this must not do.

## 1. Agree the brief before scheduling

The night run has no chat history and cannot ask a follow-up question. Whatever
is ambiguous now is ambiguous at 03:00, and comes back as a confident answer to
the wrong question.

So settle in the chat, briefly:

- what the question actually is
- what a useful answer looks like — a comparison, a recommendation, a summary
- anything the run needs to know that it cannot look up

Then repeat the brief back in one sentence and schedule it.

## 2. Schedule the run

`mcp__conclaw__schedule_task`:

- **kind**: `agent`
- **context_mode**: `isolated` — a fresh session, so **the prompt must carry the
  entire brief**. Nothing from this conversation is visible to it.
- **schedule_type**: `once`
- **schedule_value**: a local time in the quiet hours, e.g. `2026-07-22T03:00:00`
- **prompt**: the brief, plus the delivery instruction below

The prompt should end with something like:

> Когда закончишь, НЕ отправляй результат сразу. Вызови
> `mcp__conclaw__schedule_task` с `kind: "notify"`, `schedule_type: "once"`,
> `schedule_value` = сегодня 09:05 по местному времени, а в `prompt` положи
> готовый текст выжимки. Ничего не пиши в чат до этого момента.

That second task is what lands in the morning. It is a `notify`, so the text is
already written — nothing has to run or think at 09:05.

## 3. Tell the user what will happen

Say when it will run, when the answer arrives, and that nothing will appear in
between. A background job the user cannot see is one they assume was forgotten.

## Limits worth stating

- **A silent run is killed after ~30 minutes.** The clock resets whenever the run
  produces output, so genuinely long work is fine as long as it keeps working —
  but a single unbroken thinking step has that ceiling.
- **It costs real tokens**, more than a chat answer, and nobody is watching it
  spend them. Suit the scope to the question; say so if the user asks for
  something open-ended.
- **No calendar writes.** Reading the schedule is available, changing it is not.
- **It cannot ask anything.** This is why step 1 exists.

## When not to use this

If the answer takes a minute, just answer. Deferring a short question to 03:00
and reporting at 09:05 is worse than replying now — it turns an answer into a
wait.
