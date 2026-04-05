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

- **Multi-channel messaging** — WhatsApp, Telegram, Discord, Slack, Gmail
- **Isolated group context** — Each group has its own `CLAUDE.md` memory, filesystem, and container sandbox
- **Scheduled tasks** — Recurring jobs that run Claude and message you back
- **Web access** — Search and fetch content from the Web
- **Container isolation** — Docker (macOS/Linux) or Apple Container (macOS)
- **Credential security** — Agents never hold raw API keys; requests route through a credential proxy

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
