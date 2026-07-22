---
name: photos
description: Look at an image the user sent and do something useful with it. Use whenever a message contains "[Photo] (attachments/…)" or "[Image] (attachments/…)" — a whiteboard, a receipt, a page of a book, a screenshot of an error, a business card, a form.
---

# Images

A message like `[Photo] (attachments/photo_412.jpg)` means a real file. It is on
disk, mounted, and you can open it:

```
/workspace/group/attachments/photo_412.jpg
```

The path in the message is relative to the group folder; prepend
`/workspace/group/`. **Read the file.** Answering "не вижу картинку" when it is
sitting on the filesystem is the one failure this skill exists to prevent.

## What to do with it

Photos are sent for a reason and the reason is usually visible in the image.
Work out which of these it is, then act — do not describe the picture back.

| what it is | what the user wants |
|---|---|
| whiteboard, notebook page, sticky notes | the content as a note, structured |
| receipt, invoice, price tag | the numbers, and often a note or reminder |
| page of a book, article, screen of text | the passage, quoted accurately |
| screenshot of an error, logs, a failing build | a diagnosis, not a transcription |
| business card, contact details | a note with the contact |
| form, document, ticket, boarding pass | the fields that matter, and any date worth a reminder |
| a photo of something to remember (a wine label, a shelf, a model number) | a note naming the thing precisely |

**A caption overrides all of this.** "Что тут не так?" over a screenshot is a
question, not a note. Obey the caption and stop.

**Not every photo is an errand.** A photo of a cat is a photo of a cat. Reply
like a person and file nothing.

## Reading it well

- **Transcribe exactly what is written**, including numbers, dates and spelling.
  A misread digit in a price or a date is worse than no note at all. If a
  character is genuinely ambiguous, say so rather than picking the likely one.
- **Keep the structure.** A whiteboard with three columns is three columns, not
  a flat list. An arrow between two boxes means something.
- **Do not fill gaps.** If the corner is cut off or the focus is gone, say which
  part you could not read. Never infer the missing half of a phone number.
- **Say what you cannot tell.** A receipt without a visible date has no date.

## Then route it

- **Durable** — load the `notes` skill and write it there, in
  `conclaw/General/`. The image itself stays in `attachments/`; reference it in
  the note by filename so the source is findable.
- **Time-bound** — a date on a ticket, an expiry, a renewal: schedule it with
  `mcp__conclaw__schedule_task`, `kind: notify`, and say what you scheduled.
- **Both** — a receipt with a warranty date is a note plus a reminder.
- **Neither** — just answer.

## Reporting back

Lead with what it says, not with what you did. The user knows what they
photographed; what they want is the content back in a usable form.

```
Доска после встречи:

**Сделать**
- перенести API на v2 — Тарас
- нагрузочные до пятницы

**Открыто**
- кто владеет очередью?

📝 Записал — *Встреча по API v2* (session · api, планы)
```

If something was unreadable, say it in the same message, not afterwards.
