# ConClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `groups/{name}/RULES.md` | Rules learned from mistakes via the 🎓 button; prepended to every prompt. Written only by `src/rules.ts` after the user accepts — never by the agent |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |
| `.claude/skills/*/SKILL.md` | Skill definitions (all shipped on `main`) |

## Skills

Every skill ships its code on `main`. What a skill does when you run it is
auth, registration and config — the parts that need your credentials and cannot
live in a repository.

- **Feature skills** — the code is already on `main` and inert until configured.
  Their Phase 2 reads *"Verify Code Is Present"*. E.g. `/add-telegram`,
  `/add-telegram-swarm`, `/add-telegram-reactions`, `/add-voice-telegram`,
  `/add-compact`, `/channel-formatting`, `/add-gcal-tool`, `/add-mnemon`
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`, `/refresh-token`)
- **Operational skills** — instruction-only workflows (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

`/add-caveman` sits apart: it edits `CLAUDE.md` only, never source.

One opt-in exception, `/use-native-credential-proxy`, is still a `git merge` of
the `skill/native-credential-proxy` branch — it replaces OneCLI and so can't ship
enabled on `main`.

### Inert by default

Shipping a feature's code on `main` only works if an install that never asked
for it pays nothing. Each one is keyed on something the user provides:

| feature | switched on by |
|---|---|
| Google Calendar | the `.calendar-mcp` stub mount existing |
| mnemon memory | on by default; `MNEMON_DISABLED=1` turns it off |
| Telegram | `TELEGRAM_BOT_TOKEN` in `.env` |
| Mini App | `MINIAPP_PORT` **and** `MINIAPP_ALLOWED_USER_IDS` |
| voice transcription | `WHISPER_BIN` / `WHISPER_MODEL` resolving |
| heartbeat, weather | their env vars being set |

A feature that starts a process, opens a port or writes a file without being
asked is not inert, whatever its README says. Registering an MCP server whose
credentials are absent is the case that taught this: it fails on every
container start and logs an error in installs that have no calendar.

Local install state — `.env`, `store/`, `groups/<name>/`, the copies utility
skills write into `scripts/` — stays out of git. That is data and secrets, not
code.

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-conclaw` | Bring upstream updates into a customized install |
| `/init-onecli` | Install OneCLI Agent Vault and migrate `.env` credentials to it |
| `/add-caveman` | Enable compressed communication style (lite/full/ultra/off) |

## Secrets / Credentials / Proxy (OneCLI)

API keys, secret keys, OAuth tokens, and auth credentials are managed by the OneCLI gateway — which handles secret injection into containers at request time, so no keys or tokens are ever passed to containers directly. Run `onecli --help`.

## Development

Run commands directly — don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Build the Mini App front end, then compile TypeScript
npm run dev:ui       # Vite dev server for the Mini App front end alone
./container/build.sh # Rebuild agent container
```

The Mini App front end lives in `miniapp-ui/` (React + Tailwind + shadcn-style
components) and builds into `src/miniapp/public/`, which is **generated and
gitignored**. `build`, `dev` and `test` each run the UI build first, so a clean
clone works — but `npx vitest run` skips npm's pre-hooks, so run `npm test` (or
`npm run build:ui` once) or the asset tests will fail on a fresh checkout.

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.conclaw.plist
launchctl unload ~/Library/LaunchAgents/com.conclaw.plist
launchctl kickstart -k gui/$(id -u)/com.conclaw  # restart

# Linux (systemd)
systemctl --user start conclaw
systemctl --user stop conclaw
systemctl --user restart conclaw
```

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
