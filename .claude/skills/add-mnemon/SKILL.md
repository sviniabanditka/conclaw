---
name: add-mnemon
description: Add persistent graph-based memory via mnemon. Agents recall past context before responding and remember insights after each turn. Memory persists in the per-group .claude/ mount across container restarts.
---

# Add Mnemon — Persistent Memory

Installs [mnemon](https://github.com/mnemon-dev/mnemon) into the ConClaw agent
container image. On each container start, `mnemon setup` registers Claude Code
hooks that surface relevant memory before the agent responds and store new
insights after each turn. Memory is written to the per-group `.claude/` mount
(`/home/node/.claude`) and survives container restarts.

## Compatibility — read first

mnemon works by registering **filesystem hooks** in `~/.claude/settings.json`.
ConClaw's agent-runner drives the **Claude Agent SDK** (not the `claude` CLI),
and calls `query()` with `settingSources: ['project', 'user']`
(`container/agent-runner/src/index.ts`). The `user` source is what loads
`/home/node/.claude/settings.json`, so hooks mnemon writes there are picked up by
the SDK. If a future change drops `user` from `settingSources`, mnemon's hooks
stop firing — that setting is the linchpin. This is ConClaw's analogue of
NanoClaw's "hooks fire only under `--target claude-code`" caveat.

## Phase 1: Pre-flight

### Check if already applied

```bash
grep -q 'MNEMON_VERSION' container/Dockerfile && echo "Already applied" || echo "Not applied"
```

If already applied, re-run Phase 2 anyway — every step is idempotent — then go to
Phase 3.

### Check latest mnemon version

```bash
curl -fsSL https://api.github.com/repos/mnemon-dev/mnemon/releases/latest | grep '"tag_name"'
```

Note the version (e.g. `0.1.1`, no leading `v`) — use it as `MNEMON_VERSION`.

## Phase 2: Apply Changes

### 1. Dockerfile — install the mnemon binary

`container/Dockerfile` runs as root until the `USER node` line, so the install
**must go before it**. Insert this block right after the
`RUN npm install -g agent-browser @anthropic-ai/claude-code` line (skip if
`grep -q 'MNEMON_VERSION' container/Dockerfile` already matches):

```dockerfile
# ---- mnemon — persistent agent memory ----------------------------------------
ARG MNEMON_VERSION=0.1.1
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/mnemon-dev/mnemon/releases/download/v${MNEMON_VERSION}/mnemon_${MNEMON_VERSION}_linux_${ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin mnemon && \
    chmod +x /usr/local/bin/mnemon

# Memory lives in the per-group .claude/ mount so it persists across restarts.
ENV MNEMON_DATA_DIR=/home/node/.claude/mnemon
```

`MNEMON_DATA_DIR` points into `/home/node/.claude`, which the container-runner
bind-mounts per group (`src/container-runner.ts`), so each group has isolated,
persistent memory.

### 2. Entrypoint — run `mnemon setup` on each container start

ConClaw's entrypoint is **not a separate file** — it is generated inline by a
`printf` in the Dockerfile (the `RUN printf '#!/bin/bash\nset -e\n...'` line).
`mnemon setup` is idempotent; add it right after `set -e`, before the `cat` that
captures stdin, so the handshake JSON on stdin is untouched. Change the printf so
its script body reads:

```
#!/bin/bash
set -e
mnemon setup --target claude-code --yes --global >&2
cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
...
```

Concretely, insert `mnemon setup --target claude-code --yes --global >&2\n`
immediately after the `set -e\n` in the printf format string. `>&2` routes
mnemon's output to stderr (docker logs) so it never pollutes the JSON stdout the
host parses.

### 3. Install the structural guard test

mnemon ships as a GitHub-release binary and its wiring lives in the Dockerfile
(both the install layer and the printf entrypoint), so nothing is importable or
typed — a structural test is the only red-on-drift guard. ConClaw keeps the
entrypoint inside the Dockerfile, so a single test covers both reach-ins:

```bash
cp .claude/skills/add-mnemon/mnemon-dockerfile.test.ts src/mnemon-dockerfile.test.ts
npx vitest run src/mnemon-dockerfile.test.ts
```

`cp` overwrites in place — re-running the skill is safe.

### 4. Rebuild and smoke-test the image

```bash
./container/build.sh
docker run --rm --entrypoint mnemon conclaw-agent:latest --version
```

> **Build cache:** if the mnemon layer doesn't appear, the buildkit context is
> stale. Prune the builder, then re-run `./container/build.sh` (see the project
> CLAUDE.md "Container Build Cache" note).

## Phase 3: Restart and Verify

### Restart the service

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.conclaw
# Linux
systemctl --user restart conclaw
```

Kill any running agent containers so they respawn from the new image:

```bash
docker ps -q --filter 'name=conclaw-' | xargs -r docker kill
```

### Confirm mnemon ran at container start

Trigger a message, then:

```bash
C=$(docker ps --filter name=conclaw- --format '{{.Names}}' | head -1)
docker logs "$C" 2>&1 | grep -i mnemon
docker exec "$C" cat /home/node/.claude/settings.json | grep -A5 -i mnemon
```

### Test memory recall

Have a conversation, then start a fresh session and reference something from the
earlier one. mnemon should surface the context without you restating it.

## Memory storage & reset

Memory lives at `/home/node/.claude/mnemon/` in the container, mapped to the
per-group `.claude/` on the host. Find the host path:

```bash
docker inspect $(docker ps --filter name=conclaw- --format '{{.Names}}' | head -1) \
  --format '{{range .Mounts}}{{if eq .Destination "/home/node/.claude"}}{{.Source}}{{end}}{{end}}'
```

To reset a group's memory, stop its container and delete the `mnemon/`
subdirectory from that path.

## Troubleshooting

- **`mnemon: command not found`** — image not rebuilt (or stale build cache).
  Prune the builder and `./container/build.sh`.
- **Memory not persisting** — `MNEMON_DATA_DIR` must resolve under the mounted
  `/home/node/.claude`. `docker exec <c> sh -c 'ls -la $MNEMON_DATA_DIR'`.
- **Agent ignores past memory** — hooks absent from `/home/node/.claude/settings.json`,
  or `settingSources` no longer includes `user` (see Compatibility above). Run
  `docker exec -it <c> mnemon setup --target claude-code --yes --global` to see
  the error.

## Removal

See [REMOVE.md](REMOVE.md).
