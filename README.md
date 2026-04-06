# ConClaw

Personal Claude assistant. Lightweight, secure, customizable.

Based on [NanoClaw](https://github.com/qwibitai/nanoclaw) (MIT License).

---

## What is ConClaw?

ConClaw is an AI assistant that runs Claude agents securely in isolated Linux containers. It's a single Node.js process with a handful of files — small enough to understand, easy to modify.

## Quick Start

```bash
cd conclaw
npm install
npm run dev
```

Then configure your channels and start chatting.

## Philosophy

- **Small enough to understand.** One process, a few source files, no microservices.
- **Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker) — commands execute inside the container, not on your host.
- **Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code directly.

## What It Supports

- **Telegram messaging** — Primary channel with agent swarm support
- **Isolated group context** — Each group has its own `CLAUDE.md` memory, filesystem, and container sandbox
- **Scheduled tasks** — Recurring jobs that run Claude and message you back
- **Web access** — Search and fetch content from the Web
- **Container isolation** — Docker (macOS/Linux) or Apple Container (macOS)
- **Credential security** — Agents never hold raw API keys; requests route through a credential proxy
- **Skills as branches** — Install optional features via `git merge` of skill branches

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

ConClaw uses a **skill-as-branch** system. Each optional feature lives in its own git branch (`skill/*`). To install a skill, merge its branch into your repo:

```bash
git fetch upstream skill/<name>
git merge upstream/skill/<name>
```

Claude resolves any merge conflicts automatically when you run the skill via `/add-<name>`.

### Available Skills

| Skill | Type | Description |
|-------|------|-------------|
| `/add-telegram` | Feature (branch) | Add Telegram as a messaging channel |
| `/add-telegram-swarm` | Operational | Add agent swarm/teams support to Telegram |
| `/add-telegram-reactions` | Feature (branch) | Emoji reactions for processing status (👀→👍/💔) |
| `/add-voice-telegram` | Feature (branch) | Voice message transcription via local whisper.cpp |
| `/add-compact` | Feature (branch) | Add `/compact` command for context compaction |
| `/channel-formatting` | Feature (branch) | Convert Markdown to Telegram native formatting |
| `/use-native-credential-proxy` | Feature (branch) | Replace OneCLI with .env-based credential proxy |
| `/refresh-token` | Utility | Auto-refresh Claude OAuth tokens via cron |
| `/add-caveman` | Operational | Compressed communication style (reduces tokens 50-75%) |
| `/claw` | Utility | CLI tool for headless agent operation |
| `/setup` | Operational | First-time installation and configuration |
| `/update-conclaw` | Operational | Pull upstream updates safely |
| `/update-skills` | Operational | Update installed skill branches |
| `/customize` | Operational | Interactive customization guidance |
| `/debug` | Operational | Container debugging guide |
| `/init-onecli` | Operational | Install OneCLI Agent Vault |

**Feature skills** add code via `git merge` of a `skill/*` branch.
**Operational skills** are instruction-only workflows (SKILL.md on main).
**Utility skills** ship code files alongside SKILL.md.

## Requirements

- macOS, Linux, or Windows (via WSL2)
- Node.js 20+
- [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

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
