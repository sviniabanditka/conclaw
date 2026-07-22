---
name: self-extend
description: Write yourself a new skill. Use when the user asks for a capability you do not have — "научись…", "хочу чтобы ты умел…", "сделай так, чтобы каждый раз…" — or when you notice you are re-deriving the same procedure across conversations.
---

# Writing yourself a skill

You cannot install one. The project is mounted read-only precisely so that you
cannot change what runs on the host — you write a **proposal**, the user gets a
button, and the orchestrator installs it if they press ✅.

```
/workspace/group/proposed-skills/<имя>/SKILL.md
```

The name must match `^[a-z][a-z0-9-]{1,38}$` and equal the `name:` in the
frontmatter, or the proposal is ignored without comment.

## When a skill is the right answer

A skill is worth writing when a procedure is **repeatable, non-obvious, and
yours to get wrong**. Weigh it honestly — every skill is one more thing
competing for attention, and a vague one makes the useful ones harder to find.

Write one when:

- the user asks for a capability, in so many words
- you have worked out the same non-obvious sequence twice
- something went wrong in a way a written procedure would have prevented, and
  it is a *procedure* rather than a single rule

Do **not** write one when:

- a single rule would do — that is the 🎓 button, not this
- it is a one-off, however elaborate
- it restates what you already do well without being told
- it is really a fact about the user — that belongs in notes

## What makes a skill work

Everything in this file was learned from skills that failed in this install:

**The description decides whether it is ever loaded.** It is all the model sees
when choosing. Write the *situations*, in the words the user actually uses,
including the language they use. A description like "Manage files" is never
matched by anything.

**A skill you did not load is a skill that does nothing.** Assume it will
sometimes not load. Anything that must hold regardless — a path, a hard
constraint — belongs in a rule, not only here.

**Say why, not only what.** A step with no reason gets skipped the moment it
seems inconvenient, and a wrong reason is worse than none.

**Name the failure you are preventing.** "Check X before Y" is forgettable;
"Check X before Y, because Y silently succeeds on stale data" is not.

**Show the command.** A concrete command is followed far more reliably than a
sentence describing one.

## Before you propose it

**Run it.** Every command in the skill, once, in this container. A skill that
looks right and fails at runtime is the failure mode this whole flow exists to
catch, and you are the only one who can catch it before the user does.

Then check the obvious things yourself: frontmatter has `name` and
`description`; `name` matches the folder; nothing in the file refers to paths
outside `/workspace`.

## Proposing

Write the directory, then say so in one line. Do not paste the skill into the
chat — the user gets it with buttons on the next pass, within a minute.

```
🧩 Написал скилл `weather-jokes` — придёт с кнопкой.
```

If you also need a script or a template, put it in the same directory; it is
copied along with the skill.

## Updating one that exists

Same flow, same name. The user is told it replaces the old one, and the old
directory goes wholesale — so include everything the skill needs, not just the
part you changed.

Prefer this to writing `weather-jokes-v2`: two skills covering one topic split
the description space and neither gets chosen reliably.
