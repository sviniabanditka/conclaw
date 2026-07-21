# ConClaw

Personal Claude assistant. Lightweight, secure, customizable.

Based on [NanoClaw](https://github.com/qwibitai/nanoclaw) (MIT License).

---

## What is ConClaw?

ConClaw is an AI assistant that runs Claude agents securely in isolated Linux containers. It's a single Node.js process with a handful of files — small enough to understand, easy to modify.

## Quick Start

```bash
gh repo fork sviniabanditka/conclaw --clone
cd conclaw
claude
```

<details>
<summary>Without GitHub CLI</summary>

1. Fork [sviniabanditka/conclaw](https://github.com/sviniabanditka/conclaw) on GitHub (click the Fork button)
2. `git clone https://github.com/<your-username>/conclaw.git`
3. `cd conclaw`
4. `claude`

</details>

Then run `/setup`. Claude Code handles everything: dependencies, authentication, container setup and service configuration.

> **Note:** Commands prefixed with `/` (like `/setup`, `/add-telegram`) are [Claude Code skills](https://code.claude.com/docs/en/skills). Type them inside the `claude` CLI prompt, not in your regular terminal. If you don't have Claude Code installed, get it at [claude.com/product/claude-code](https://claude.com/product/claude-code).

## Philosophy

- **Small enough to understand.** One process, a few source files, no microservices.
- **Secure by isolation.** Agents run in Docker containers — commands execute inside the container, not on your host.
- **Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code directly.

## What It Supports

- **Telegram messaging** — Primary channel with agent swarm support
- **Isolated group context** — Each group has its own `CLAUDE.md` memory, filesystem, and container sandbox
- **Scheduled tasks** — Recurring jobs that run Claude and message you back
- **Web access** — Search and fetch content from the Web
- **Container isolation** — Docker (macOS/Linux)
- **Credential security** — Agents never hold raw API keys; requests route through a credential proxy
- **Built-in skills** — Optional features ship on `main`; enable them by running `/add-<name>`

## Architecture

```
Channels --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

Single Node.js process. Channels self-register at startup. Agents execute in isolated Linux containers. Per-group message queue with concurrency control. IPC via filesystem.

Key files:
- `src/index.ts` — Orchestrator: state, message loop, agent invocation
- `src/channels/registry.ts` — Channel registry (self-registration at startup)
- `src/ipc.ts` — IPC watcher and task processing
- `src/router.ts` — Message formatting and outbound routing
- `src/group-queue.ts` — Per-group queue with global concurrency limit
- `src/container-runner.ts` — Spawns streaming agent containers
- `src/task-scheduler.ts` — Runs scheduled tasks
- `src/db.ts` — SQLite operations
- `groups/*/CLAUDE.md` — Per-group memory
- `.claude/skills/*/SKILL.md` — Skill definitions (on main branch)

## Skills

Every skill *definition* ships on `main` — nothing to merge. Run `/<name>` to use
one: **feature** skills (Telegram, voice, reactions, …) enable code that's already
present by doing the auth/registration/config work; **patch** skills instead edit
tracked source to add code that is deliberately *not* on `main`, so a clean
install stays a menu rather than a bundle; **operational** skills are
instruction-only workflows; **utility** skills carry helper code alongside their
`SKILL.md`.

A patch skill's edits are per-install state and should stay out of `main` —
otherwise the feature is baked into every fresh clone. Fixes to the skill itself
(`.claude/skills/<name>/`) do belong on `main`.

The one exception is `/use-native-credential-proxy`: it swaps OneCLI for a
`.env`-based proxy, which is mutually exclusive with OneCLI, so it stays an
opt-in `git merge` of the `skill/native-credential-proxy` branch.

### Available Skills

| Skill | Type | Description |
|-------|------|-------------|
| `/add-telegram` | Feature | Add Telegram as a messaging channel |
| `/add-telegram-swarm` | Feature | Add agent swarm/teams support to Telegram |
| `/add-telegram-reactions` | Feature | Emoji reactions for processing status (👀→👍/💔) |
| `/add-voice-telegram` | Feature | Voice message transcription via local whisper.cpp |
| `/add-compact` | Feature | Add `/compact` command for context compaction |
| `/channel-formatting` | Feature | Convert Markdown to Telegram native formatting |
| `/add-gcal-tool` | Patch | Google Calendar as an MCP tool via OneCLI OAuth |
| `/add-mnemon` | Patch | Persistent graph-based agent memory (mnemon) |
| `/add-caveman` | Feature | Compressed communication style (reduces tokens 50-75%) |
| `/use-native-credential-proxy` | Branch (opt-in) | Replace OneCLI with a `.env`-based credential proxy |
| `/refresh-token` | Utility | Auto-refresh Claude OAuth tokens via cron |
| `/claw` | Utility | CLI tool for headless agent operation |
| `/setup` | Operational | First-time installation and configuration |
| `/update-conclaw` | Operational | Pull upstream updates safely |
| `/customize` | Operational | Interactive customization guidance |
| `/debug` | Operational | Container debugging guide |
| `/init-onecli` | Operational | Install OneCLI Agent Vault |

**Feature skills** are built into `main`; running one wires up config/auth for code
that already ships. **Operational skills** are instruction-only workflows.
**Utility skills** ship helper code alongside their `SKILL.md`.

## Requirements

- macOS, Linux, or Windows (via WSL2)
- Node.js 20+
- [Docker](https://docker.com/products/docker-desktop)

## Development

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests
npm run typecheck    # Type check
npm run lint         # Lint
```

## License

MIT
