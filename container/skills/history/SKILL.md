---
name: history
description: Search past conversations. Use when the user asks what was said before — "что мы говорили про X", "когда я просил Y", "что ты мне отвечал по поводу Z" — or when you need to check whether something was already discussed.
---

# Searching the conversation history

Both halves of the conversation are stored in SQLite at
`/workspace/store/messages.db`, writable from the main channel. Memory (mnemon)
holds conclusions; this holds what was actually said, verbatim, with timestamps.

Use it when the question is about the record — *when* something was said, the
exact wording, whether a thing was discussed at all. For "what do you know about
me", memory is the better source.

## The table

```sql
-- messages(id, chat_jid, sender, sender_name, content, timestamp,
--          is_from_me, is_bot_message, reply_to_message_id, ...)
```

`is_bot_message = 1` is what the assistant said, `0` is the user. Timestamps are
ISO-8601 UTC — convert for display, the user thinks in local time.

## Searching

```bash
sqlite3 -json /workspace/store/messages.db "
  SELECT timestamp, is_bot_message, substr(content, 1, 300) AS content
  FROM messages
  WHERE chat_jid = 'CHAT_JID'
    AND content LIKE '%деплой%'
  ORDER BY timestamp DESC
  LIMIT 20;
"
```

Practical notes:

- **`LIKE` is case-sensitive for Cyrillic** in SQLite's default build. Search a
  distinctive stem rather than a whole word — `'%деплой%'` catches деплой,
  деплоя, деплою — and try both cases when a term may start a sentence.
- **Read, do not write.** The database is writable so tasks can be managed; the
  history is a record and editing it is never the answer to a question about it.
- **Recent history only exists from when recording started.** Replies sent before
  that are in Telegram but not here. If a search comes up empty for something the
  user clearly remembers, say that rather than concluding it never happened.

## Answering well

Quote the relevant line and give its local date and time, then answer the actual
question. A wall of matched rows is not an answer.

```
19 июля, 14:32 — ты писал: «...»
Я тогда ответил, что ...
```

If several messages are relevant, summarise the thread rather than pasting it.
If nothing matches, say so plainly and offer the closest thing found.
