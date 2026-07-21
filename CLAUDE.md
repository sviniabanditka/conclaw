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
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |
| `.claude/skills/*/SKILL.md` | Skill definitions (all shipped on `main`) |

## Skills

Every skill *definition* ships on `main`. Whether the code it installs also ships
on `main` is what separates the types:

- **Feature skills** — code is already on `main` (inert until configured); running
  `/add-<name>` only does auth/registration/config wiring. Their Phase 2 reads
  *"Verify Code Is Present"*. E.g. `/add-telegram`, `/add-telegram-swarm`,
  `/add-telegram-reactions`, `/add-voice-telegram`, `/add-compact`,
  `/channel-formatting`
- **Patch skills** — code is **not** on `main`; running `/add-<name>` edits tracked
  source (`container/Dockerfile`, `container/agent-runner/`, adds `src/*.test.ts`).
  Their Phase 2 reads *"Apply Changes"*. E.g. `/add-gcal-tool`, `/add-mnemon`
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`, `/refresh-token`)
- **Operational skills** — instruction-only workflows (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

`/add-caveman` sits apart: it edits `CLAUDE.md` only, never source.

One opt-in exception, `/use-native-credential-proxy`, is still a `git merge` of
the `skill/native-credential-proxy` branch — it replaces OneCLI and so can't ship
enabled on `main`.

### Do not commit patch-skill output to `main`

A patch skill's edits are **per-install state**. Committing them to `main` bakes
the feature into every clean install and removes the ability to choose — which is
the whole point of the skill. Keep them uncommitted in the working tree (or on a
local branch that is never merged).

What *does* belong on `main` is any fix to the **skill itself**: `.claude/skills/<name>/`
— SKILL.md, its bundled test templates, its scripts. That is how a bug found while
installing stops recurring for the next install. Same rule for utility skills:
`.claude/skills/refresh-token/refresh-token.sh` is the template and belongs on
`main`; the `scripts/refresh-token.sh` copy it installs is local state.

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
