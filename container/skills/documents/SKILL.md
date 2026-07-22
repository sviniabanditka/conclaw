---
name: documents
description: Read a document the user sent and do something useful with it. Use whenever a message contains "[Document: …]" — a PDF, docx, xlsx, pptx, csv: договор, счёт, техзадание, отчёт, выписка, презентация.
---

# Documents

`[Document: Договор.docx] (attachments/Договор.docx)` means a real file, already
downloaded, in a mounted directory:

```
/workspace/group/attachments/Договор.docx
```

The path in the message is relative to the group folder; prepend
`/workspace/group/`. Saying you cannot open an attachment that is sitting on
the filesystem is the failure this skill exists to prevent.

## Getting the text out

**PDF** — read it directly with the `Read` tool; it handles PDFs, page by page.
For a long one, read the pages you need rather than all of them.

**docx, xlsx, pptx, csv, txt** — a bundled extractor, standard library only, no
install:

```bash
python3 /home/node/.claude/skills/documents/extract.py /workspace/group/attachments/Договор.docx
```

It recovers text and the structure that carries meaning — paragraphs, table
rows as tab-separated lines, one section per sheet or slide — and nothing else.
Formatting is gone, so do not reason about what was bold.

**Anything else** (`.doc`, `.rtf`, `.pages`, an archive) — it exits with
`unsupported: .ext`. Say so and ask for a PDF. Do not guess at the contents
from the filename.

## Reading it well

- **Transcribe numbers, dates and names exactly.** A wrong digit in a sum or a
  date is worse than no answer. Quote them from the text rather than retyping
  from memory of what you read a moment ago.
- **Say what you did not read.** If you looked at four pages of a forty-page
  contract, say which four. An answer that sounds complete but is not is the
  most expensive mistake available here.
- **Do not fill gaps.** A scanned PDF may be images with no text layer — then
  you have pictures, and `Read` sees them as pictures. That is fine, but say
  that is what happened.
- **Tables lose their columns.** Extracted rows are tab-separated; if a row
  does not line up with the header, say so instead of guessing the mapping.

## Then route it

Same as any other input, and the caption decides:

- **A question over the document** — answer it and stop. "Что тут по срокам?"
  is not a request to file anything.
- **Durable** — the terms of a contract, credentials for a service, a
  specification: load the `notes` skill and write it to `conclaw/General/`.
  Reference the file by name so the source is findable.
- **Time-bound** — a renewal, an expiry, a payment date, a deadline: schedule
  it with `mcp__conclaw__schedule_task`, `kind: notify`, and say what you set.
- **Both** — a contract with a termination date is a note plus a reminder.

## Reporting back

Lead with what the document says. The user knows they sent a contract; what
they want is the part that matters.

```
Договор №42 — Brights ⇄ BannerBoo

• Срок: до 3 марта 2027, автопродление на год
• Сумма: 1500 € / мес
• Расторжение: письменно за 60 дней

⏰ Напомню 2 января — окно на расторжение закрывается 2 января 2027.
📝 Записал — *Договор №42* (knowledge · договоры, bannerboo)

Читал страницы 1–3 из 11; приложения не смотрел.
```

Put what you did not read at the end, in the same message — never in a separate
one, and never omitted.
