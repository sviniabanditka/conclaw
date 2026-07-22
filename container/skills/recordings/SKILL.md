---
name: recordings
description: Work with a transcribed recording — a meeting, a call, a lecture. Use when a message starts with "[Recording transcription: …]". Not for voice notes, which are handled by voice-notes.
---

# Recordings

A message beginning `[Recording transcription: имя файла]` is an audio file the
user sent, already transcribed on the host. What follows is the whole
transcript, unpunctuated by any speaker labels — whisper does not know who is
talking.

**This is not a voice note.** A voice note is the user thinking aloud at you,
and `voice-notes` turns it into their reminders. A recording is other people
talking, usually a meeting, and turning every sentence in it into a reminder
for the user would be wrong. Read the room: if the transcript is one person
addressing you directly, it is a note; otherwise it is a record of a
conversation between others.

## What to produce

Not a summary of the audio — a usable record of the meeting. In this order:

**Decisions.** What was actually settled, in the words used. A decision with no
owner is half a decision: say who, or say that nobody was named.

**Action items.** Who committed to what, and by when if a time was said. Only
things someone actually took on — "надо бы посмотреть" from nobody in
particular is not an action item.

**Open questions.** What was raised and left unresolved. This is the part
people forget and the part a transcript is uniquely good for.

**Everything else, briefly.** Context worth keeping, in a few lines.

## What the transcript will not tell you

Say so, rather than filling it in:

- **Who said what.** There are no speaker labels. Attribute only where the
  transcript names someone ("Тарас, возьмёшь?" — "возьму"). Never guess from
  turn order.
- **Names spelled wrong.** Whisper mangles names and jargon, especially mixed
  Russian and English. If a name looks garbled, write it as heard and flag it
  rather than inventing a plausible correction.
- **What was cut off.** If the file was too long the host says so instead of
  transcribing; a truncated transcript means you saw part of a meeting, and the
  summary has to say which part.

## Then route it

- **The record itself** — a note, via the `notes` skill, in
  `conclaw/Sessions/`, named for the meeting and dated. That is what
  `Sessions/` is for.
- **Action items the user took on** — schedule them with
  `mcp__conclaw__schedule_task`, `kind: notify`. Only theirs; do not create
  reminders about what other people promised.
- **A date that was agreed** — one reminder, before it.

## Reporting back

Lead with the decisions. The user was in the meeting; they want what they will
otherwise forget, not a retelling.

```
Созвон по API v2 — 34 мин

**Решили**
• Переносим на v2 до конца месяца — Тарас
• Нагрузочные гоняем на стейдже, не на проде

**На тебе**
• Прислать схему миграции до пятницы

**Открыто**
• Кто владеет очередью после переноса — не решили

📝 Записал — *Созвон по API v2* (session · api, планы)
⏰ Напомню в четверг про схему.

Имя «Дмитро/Дмитрий» в расшифровке звучит по-разному — уточни, если важно.
```
