# Remove Mnemon

Every step is idempotent — safe to run even if some steps were never applied.

## 1. Strip the Dockerfile install layer

In `container/Dockerfile`, delete the mnemon block (the `# ---- mnemon` comment,
the `ARG MNEMON_VERSION`, the `RUN` that downloads the binary, and the
`ENV MNEMON_DATA_DIR` line):

```dockerfile
# ---- mnemon — persistent agent memory ----------------------------------------
ARG MNEMON_VERSION=0.1.1
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/mnemon-dev/mnemon/releases/download/v${MNEMON_VERSION}/mnemon_${MNEMON_VERSION}_linux_${ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin mnemon && \
    chmod +x /usr/local/bin/mnemon

ENV MNEMON_DATA_DIR=/home/node/.claude/mnemon
```

If it's already gone, skip.

## 2. Strip the entrypoint setup line

In `container/Dockerfile`, in the `RUN printf '#!/bin/bash\n...'` line, delete the
`mnemon setup --target claude-code --yes --global >&2\n` fragment so the printf
returns to `set -e\ncd /app && npx tsc ...`.

If it's already gone, skip.

## 3. Delete the copied test

```bash
rm -f src/mnemon-dockerfile.test.ts
```

## 4. Rebuild and restart

```bash
npm run build && ./container/build.sh

# macOS
launchctl kickstart -k gui/$(id -u)/com.conclaw
# Linux
systemctl --user restart conclaw
```

Kill running agent containers so they respawn without mnemon:

```bash
docker ps -q --filter 'name=conclaw-' | xargs -r docker kill
```

## 5. Delete stored memory (optional)

mnemon's graph lives at `/home/node/.claude/mnemon/` in each container, mapped to
the per-group `.claude/` on the host. Find the host path and clear it:

```bash
docker inspect $(docker ps --filter name=conclaw- --format '{{.Names}}' | head -1) \
  --format '{{range .Mounts}}{{if eq .Destination "/home/node/.claude"}}{{.Source}}{{end}}{{end}}'
```

Stop the container, then delete the `mnemon/` subdirectory from that path (one per
group).
