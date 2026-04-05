---
name: add-telegram-reactions
description: Add emoji reactions to Telegram messages to signal processing status (👀 processing, 👍 done, 💔 error). Requires Telegram channel to be set up first.
---

# Add Telegram Message Reactions

Adds automatic emoji reactions to Telegram messages to signal processing status. Users see at a glance whether their message was received, answered, or hit an error.

| Emoji | Meaning |
|-------|---------|
| 👀 | Message received, processing started |
| 👍 | Agent responded successfully |
| 💔 | Error occurred |

**Prerequisites:** Telegram channel must be set up first (`/add-telegram`).

## Phase 1: Pre-flight

Check if already applied:

```bash
grep -q "setReaction" src/channels/telegram.ts && echo "ALREADY_APPLIED" || echo "NEEDS_APPLY"
```

If `ALREADY_APPLIED`, skip to Phase 3 (Verify).

## Phase 2: Apply Code Changes

### Merge the skill branch

```bash
git fetch upstream skill/telegram-reactions
git merge upstream/skill/telegram-reactions --no-edit || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue --no-edit
}
```

> **Note:** `upstream` is the remote pointing to `sviniabanditka/conclaw`. If using a different remote name, substitute accordingly.

This merges in:
- `src/types.ts` — adds optional `setReaction()` method to Channel interface
- `src/channels/telegram.ts` — implements `setReaction()` via grammy's `setMessageReaction` API
- `src/index.ts` — calls reactions at message lifecycle points (processing, success, error)

### Validate

```bash
npm install
npm run build
```

## Phase 3: Build and Restart

```bash
npm run build
# Linux:
systemctl --user restart conclaw
# macOS:
launchctl kickstart -k gui/$(id -u)/com.conclaw
```

## Phase 4: Verify

Send a message to the Telegram bot. You should see:

1. 👀 reaction appears immediately on your message
2. Bot replies with text
3. 👀 changes to 👍

To test error handling, you can temporarily break the agent (e.g., stop Docker) and send a message — should see 💔.

## Notes

- Reactions use Telegram's native `setMessageReaction` API — only emojis from Telegram's allowed set work
- The `setReaction` method is optional on the Channel interface — other channels are unaffected
- If the bot doesn't have permission to react in a group, errors are silently ignored (logged at debug level)

## Removal

```bash
git checkout upstream/main -- src/types.ts src/channels/telegram.ts src/index.ts
npm run build
systemctl --user restart conclaw  # or launchctl kickstart on macOS
```
