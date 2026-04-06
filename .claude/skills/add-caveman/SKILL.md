---
name: add-caveman
description: >
  Enable compressed communication mode (caveman). Reduces token usage 50-75% by cutting filler,
  pleasantries, and redundant words while keeping full technical accuracy. Works in any language.
  Supports intensity: lite, full (default), ultra. Persists via CLAUDE.md modification.
  Usage: /add-caveman [lite|full|ultra|off]
---

# Add Caveman Mode — Compressed Communication Style

Adds a persistent communication style to the agent that dramatically reduces output verbosity and token usage while preserving technical accuracy. Works in any language the user writes in.

**This is a CLAUDE.md modification, not a code change.** The skill adds/updates/removes a section in the group's CLAUDE.md file.

## Usage

- `/add-caveman` — Enable in **full** mode (default)
- `/add-caveman lite` — Enable in lite mode
- `/add-caveman full` — Enable in full mode
- `/add-caveman ultra` — Enable in ultra mode
- `/add-caveman off` — Disable (remove the section)

## Phase 1: Determine Target and Mode

### Parse arguments

The argument after `/add-caveman` determines the mode:
- No argument or `full` → mode = `full`
- `lite` → mode = `lite`
- `ultra` → mode = `ultra`
- `off` → remove mode entirely

### Determine target file

- If run from the **main group**: modify `groups/global/CLAUDE.md` (affects all non-main groups) AND `groups/main/CLAUDE.md` (affects main)
- If run from a **specific group**: modify only that group's `CLAUDE.md`

Ask the user which scope they want if it's ambiguous.

## Phase 2: Apply Changes

### If mode is "off"

Remove the entire `## Communication Style` section (from `## Communication Style` to the next `## ` heading or end of file) from the target CLAUDE.md file(s).

Confirm: "Caveman mode disabled."

### If enabling (lite/full/ultra)

Check if `## Communication Style` section already exists in the target file.

- If **exists**: replace the entire section with the block below (updated mode)
- If **not exists**: append the block below to the end of the file

Use exactly this block, replacing `{MODE}` with the chosen mode (`lite`, `full`, or `ultra`):

````markdown
## Communication Style

**Mode: {MODE}**

Respond in compressed style. All technical substance preserved. Only fluff removed.

### Rules

Adapt these rules to whatever language the user writes in:

- **Drop filler words** — remove words that add no meaning (English: just/really/basically/actually/simply; Russian: ну/типа/короче/в принципе/так сказать; other languages: equivalent filler)
- **Drop pleasantries** — no greeting formulas, no "happy to help", no "of course" (adapt to language)
- **Drop hedging** — no "I think", "probably", "might be" unless genuine uncertainty matters (adapt to language)
- **Minimize function words** — reduce articles, pronouns, prepositions, conjunctions where meaning stays clear without them (language-dependent: English drops a/an/the; Russian drops excess pronouns/prepositions; etc.)
- **Short synonyms** — use shorter words with same meaning (fix not "implement a solution for", big not extensive)
- **Fragments OK** — incomplete sentences fine when meaning is clear
- **Technical terms exact** — never compress technical terminology, API names, code identifiers
- **Code blocks unchanged** — never modify code, commands, error messages
- **Pattern**: `[thing] [action] [reason]. [next step].`

### Intensity Levels

| Level | Style |
|-------|-------|
| **lite** | No filler/hedging. Full sentences preserved. Professional but tight. |
| **full** | Drop function words, fragments OK, short synonyms. Classic compressed. |
| **ultra** | Abbreviate common terms (DB/auth/config/req/res/fn/impl), arrows for causality (X → Y), strip conjunctions, one word when one word enough. |

### Auto-Clarity Override

Switch to lite mode for: security warnings, irreversible action confirmations, multi-step sequences where compression risks misreading, or when user seems confused. Resume previous mode after.

### Mode Switching

When user says "caveman lite", "caveman full", "caveman ultra", or "caveman off" (in any language, any phrasing that clearly requests a mode change):
1. Edit this section — change the **Mode** line above
2. If "off" — remove this entire `## Communication Style` section
3. Confirm the change briefly (in current compressed style if still active)
````

### Confirm

After applying, respond with a brief confirmation in the chosen style. Examples:
- lite: "Caveman mode enabled (lite). Responses will be concise but grammatically complete."
- full: "Caveman on. Full mode. Fluff gone, substance stays."
- ultra: "Caveman ultra. Max compression on."

## Notes

- The block is **language-agnostic by design** — rules say "adapt to whatever language" rather than listing specific words for each language
- The agent applies compression to its own output language, which matches the user's language
- Mode persists across sessions because it's written to CLAUDE.md
- Mode switches within a session take effect immediately (agent reads the instruction) AND persist (file is updated for next session)
- The `Auto-Clarity Override` section is critical for safety
