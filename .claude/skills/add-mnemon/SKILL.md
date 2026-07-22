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

## Phase 2: Verify Code Is Present

mnemon ships on `main`: the binary is installed by `container/Dockerfile` and
`mnemon setup` runs from the entrypoint on every container start. There is
nothing to patch — this phase only confirms nothing has drifted.

```bash
npx vitest run src/mnemon-dockerfile.test.ts
docker run --rm --entrypoint mnemon conclaw-agent:latest --version
```

If the image has no `mnemon`, it predates the change: rebuild with
`./container/build.sh`. If the buildkit skips the layer, prune the builder
first (see the project CLAUDE.md note on the build cache).

> **Why the `||` in the entrypoint is load-bearing.** The entrypoint runs under
> `set -e`, and `mnemon setup` sits *before* the `cat` that reads the handshake
> JSON. Bare, any setup failure — corrupt store, a bad release, a permissions
> problem on the mount — would kill the container before it ever read stdin, so
> the agent would stop answering entirely instead of merely losing memory. The
> fallback downgrades a memory outage to exactly that. The guard test covers it.

### Turning it off

Memory is on by default. To run without it, set `MNEMON_DISABLED=1` in the
container environment — no rebuild, no edit to the image.

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
