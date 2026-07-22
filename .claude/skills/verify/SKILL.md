---
name: verify
description: Check a running ConClaw installation and report what is broken or unconfigured. Use for "проверь установку", "всё ли работает", "что не настроено", after a restart, or when something behaves oddly and it is not obvious why.
---

# Verify the installation

```bash
npx tsx setup/index.ts --step verify
```

One status block. Read it in two passes: what is broken, then what is simply
not configured — the second list is not a fault, and treating it as one sends
people fixing things that were never asked for.

## Broken

| field | meaning | fix |
|---|---|---|
| `CREDENTIAL_WORKS: unauthorized …` | the gateway answered and what it injected was **rejected**. The bot cannot answer at all. | `/refresh-token`, then re-check. If it persists the secret in OneCLI is the wrong shape — see docs/MANUAL-SETUP.md |
| `SERVICE: stopped` / `not_found` | not running under any manager, and no `node dist/index.js` process either | `npm run build`, then start it |
| `TOKEN_REFRESH: not_installed` | **nothing notices this until it is too late.** The OAuth token expires within hours and every reply starts returning 401 | `/refresh-token` |
| `TOKEN_REFRESH: stale` | installed but has not run for over 90 minutes | `tmux ls`, `tail logs/refresh-token.log` |
| `REGISTERED_GROUPS: 0` | no chat is registered | `/add-telegram` |
| `MINIAPP: port_without_allowlist` | the port is set but nobody is allowed, so the server refuses to open it | set `MINIAPP_ALLOWED_USER_IDS` |

`CREDENTIAL_WORKS` is the one worth running on its own. It is a free,
authenticated request through the gateway, and it is the only check that
distinguishes a credential that *resolves* from one that merely *exists* —
during the outage it was written for, everything else looked healthy for hours
while every reply failed.

## Not configured

These are states, not faults. Say what is off and move on unless asked.

- `TRANSCRIPTION` lists what is missing → `bash scripts/install-transcription.sh`
- `CALENDAR: not_configured` → the code ships and is inert → `/add-gcal-tool`
- `MINIAPP: disabled` → no `MINIAPP_PORT`
- `SERVICE: running_unmanaged` → running under tmux or nohup rather than
  systemd/launchd. Normal in a pod with no init system.
- `CREDENTIAL_WORKS: gateway_unreachable` → OneCLI is not running, or this
  install uses the native credential proxy instead. Only a fault if you expect
  OneCLI.

## What this cannot check

Anything living in a browser or on another machine: the Mini App registration
with @BotFather, the Google OAuth app, DNS and TLS for the Mini App domain.
Those are in `docs/MANUAL-SETUP.md`; when one of them is wrong the symptom is a
feature that never worked, rather than one that stopped.
