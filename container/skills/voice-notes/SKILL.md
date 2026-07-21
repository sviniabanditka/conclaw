---
name: voice-notes
description: Turn a spoken note into reminders. Use when a message arrives as "[Voice message transcription: ...]" and contains things to do, not just a question. Extracts commitments, schedules them, and reports back what was understood.
---

# Spoken notes → reminders

A voice note is how people offload things while walking: half a plan, three
errands and a date, in one breath. This turns that into reminders instead of a
transcript the user has to re-read later.

Applies when the message looks like `[Voice message transcription: …]`. A spoken
**question** is just a question — answer it normally and stop. Only act on a note
that contains things to be done.

## 1. Pull out the commitments

From the transcript take, for each item:

- **what** — short, in the user's own words, not a paraphrase
- **when** — the moment to remind, resolved to an absolute local time

Get the current time from `mcp__calendar__get-current-time` before resolving
anything relative. "На следующей неделе" and "в пятницу" mean nothing without it.

Rules that keep this useful rather than clever:

- **A vague item still gets a time.** "Продлить домен" with no date becomes a
  reminder tomorrow at 10:00 rather than nothing. Say which default you used.
- **Do not invent detail.** If the note says "созвониться с Тарасом", the
  reminder says that, not "созвон с Тарасом по поводу деплоя на 30 минут".
- **Skip what is not a commitment.** Thinking aloud, opinions, and things already
  done are not reminders.
- **One item per reminder.** Two errands mentioned in one sentence are two.

## 2. Check the calendar before choosing a time

The calendar is **read-only**: `list-events` and `get-freebusy` are available;
creating, moving and deleting events are not, deliberately.

So do not offer to put anything in the calendar, and do not claim to have done
so. Use it only to avoid reminding at a moment that is already spoken for — if
the natural slot collides with a meeting, move the reminder to just after it and
say why.

## 3. Schedule them

For each item call `mcp__conclaw__schedule_task` with:

- **kind**: `notify` — the text is known now, so no agent needs to wake later
- **schedule_type**: `once`
- **schedule_value**: local time, no `Z` suffix, e.g. `2026-07-24T10:00:00`
- **prompt**: the message the user will receive, e.g.
  `🔔 Продлить домен`

## 4. Report what you understood

Reply with the list, each with its time, so a mishearing is visible immediately:

```
Записал из голосового:

• Созвониться с Тарасом — пн 09:00
• Продлить домен — чт 10:00 (срок «до пятницы», поставил накануне)

Что-то не так — жми Undo.
```

An **Undo** button appears automatically under a reply whose turn created tasks,
and removes all of them. Mention it: transcription mishears names and dates, and
knowing one tap undoes everything is what makes speaking to it comfortable.

If nothing could be extracted, say so plainly and quote what you heard — a
silent no-op reads as the bot having missed the message entirely.
