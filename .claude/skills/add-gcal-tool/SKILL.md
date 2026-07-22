---
name: add-gcal-tool
description: Add Google Calendar as an MCP tool (list calendars, list/search/create events, free/busy) using OneCLI-managed OAuth. No raw credentials ever reach the container — OneCLI injects real tokens at request time. Wired globally in the agent-runner because ConClaw has no per-group MCP registry.
---

# Add Google Calendar Tool (OneCLI-native)

Wires [`@cocal/google-calendar-mcp`](https://github.com/cocal-com/google-calendar-mcp)
into the ConClaw agent container. The MCP server reads **stub** credentials
containing the `onecli-managed` placeholder; the OneCLI gateway intercepts
outbound calls to `calendar.googleapis.com` / `oauth2.googleapis.com` and swaps
the bearer for the real OAuth token from its vault. Containers never see a real
secret — same invariant OneCLI enforces for every credential.

**Why this package:** `@cocal/google-calendar-mcp` supports multi-calendar and
multi-account and is actively maintained; `@gongrzhe/server-calendar-autoauth-mcp`
only does the `primary` calendar with 5 tools.

Tools surface as `mcp__calendar__<name>`. This skill wires the **read-only** set
(`list-calendars`, `list-events`, `search-events`, `get-event`, `get-freebusy`,
`get-current-time`); the write tools (`create-event`, `update-event`,
`delete-event`) exist but are deliberately not granted — see Phase 2.

## How this differs from NanoClaw's version

NanoClaw registers MCP servers **per agent group** via `ncl groups config
add-mcp-server` (stored in a central DB, materialized into `container.json`).
**ConClaw has no such registry** — `container/agent-runner/src/index.ts` passes a
**hardcoded** `mcpServers` map and a **fixed** `allowedTools` list to the SDK's
`query()`. So this skill wires calendar **globally**: every agent group gets the
`calendar` MCP server. Each group that should actually use it needs the
`.calendar-mcp` stub mount (Phase 3); groups without the mount get the server
configured but log a missing-credentials error and expose no working tools —
harmless for a single-group personal install.

## Phase 1: Pre-flight

### OneCLI has Google Calendar connected

```bash
onecli apps get --provider google-calendar
```

Expect `"connection": { "status": "connected" }` with `calendar.readonly` +
`calendar.events` scopes. If not connected, tell the user:

> Open the OneCLI web UI (`ONECLI_URL`, e.g. http://127.0.0.1:10254), go to
> Apps → Google Calendar → Connect, and sign in with the Google account the agent
> should act as. `calendar.readonly` + `calendar.events` are the minimum useful
> scopes.

### Stub credentials

Stubs live at `~/.calendar-mcp/`. cocal defaults to
`~/.config/google-calendar-mcp/tokens.json`; we override via env vars in Phase 2
so it reads our stubs. Check:

```bash
ls -la ~/.calendar-mcp/gcp-oauth.keys.json ~/.calendar-mcp/credentials.json 2>&1
grep -l onecli-managed ~/.calendar-mcp/*.json 2>/dev/null
```

If both exist and contain `onecli-managed`, skip ahead. If either holds **real**
credentials (no `onecli-managed`), **STOP** — back up and delete first. If absent,
write the stubs:

```bash
mkdir -p ~/.calendar-mcp
cat > ~/.calendar-mcp/gcp-oauth.keys.json <<'EOF'
{
  "installed": {
    "client_id": "onecli-managed.apps.googleusercontent.com",
    "client_secret": "onecli-managed",
    "redirect_uris": ["http://localhost:3000/oauth2callback"]
  }
}
EOF
cat > ~/.calendar-mcp/credentials.json <<'EOF'
{
  "access_token": "onecli-managed",
  "refresh_token": "onecli-managed",
  "token_type": "Bearer",
  "expiry_date": 99999999999999,
  "scope": "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events"
}
EOF
chmod 600 ~/.calendar-mcp/*.json
```

> **k3s / dind note:** if ConClaw runs in the workspace pod, `~` is `/workspace`
> (on the shared PVC), so `~/.calendar-mcp` = `/workspace/.calendar-mcp` — visible
> to the dind daemon at the same path, which is required for the bind mount to
> resolve. Do **not** put it under `/tmp` (per-container, not shared).

### Mount allowlist covers the path

```bash
cat ~/.config/conclaw/mount-allowlist.json
```

`~/.calendar-mcp` must sit under an `allowedRoots` entry with
`"allowReadWrite": true` (the MCP server rewrites `credentials.json` on token
refresh). Add it if missing:

```json
{
  "allowedRoots": [
    { "path": "~/.calendar-mcp", "allowReadWrite": true, "description": "Google Calendar MCP stubs" }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
```

The allowlist is cached in memory — the ConClaw orchestrator must be **restarted**
after editing it (Phase 4).

### Agent secret-mode

```bash
onecli agents list
```

`secretMode: all` is sufficient. If `selective`, assign the Google Calendar secret
to the agent explicitly.

## Phase 2: Verify Code Is Present

The wiring ships on `main`: `container/Dockerfile` installs
`@cocal/google-calendar-mcp`, and `container/agent-runner/src/index.ts`
registers the server and allows its read-only tools.

**It is inert until the stubs are mounted.** The agent-runner registers the
server only when `/workspace/extra/.calendar-mcp/gcp-oauth.keys.json` exists —
otherwise it would start a stdio process that fails immediately and logs an
error on every container start, in every install that never asked for a
calendar. So Phase 3 is what actually switches this on.

```bash
npx vitest run src/gcal-dockerfile.test.ts src/gcal-agent-runner.test.ts
docker run --rm --entrypoint sh conclaw-agent:latest -c 'command -v google-calendar-mcp'
```

If the binary is missing the image predates the change — `./container/build.sh`,
pruning the builder first if the layer is skipped.

### The read-only rule

Tools are listed one by one rather than by wildcard, and the guard test fails
on `mcp__calendar__*` or on any of `create-event`, `update-event`,
`delete-event`. A wrong answer is a nuisance; a deleted meeting is damage other
people notice and the agent cannot undo. Keep it that way.

## Phase 3: Mount the stubs per group

Global `mcpServers` still needs the stub creds mounted into the groups that use
calendar. ConClaw mounts extra dirs through each group's `additionalMounts` in the
central DB (`store/messages.db`, `registered_groups.container_config`) — the same
mechanism the Obsidian vault uses. There is no CLI; write it directly.

For each target group folder (`main` for the primary group; list with a quick
query below), merge an `additionalMounts` entry:

```bash
node -e '
const Database = require("better-sqlite3");
const db = new Database("store/messages.db");
const FOLDER = process.argv[1];                       // e.g. "telegram_main"
const HOST = require("os").homedir() + "/.calendar-mcp";
const row = db.prepare("SELECT name, container_config FROM registered_groups WHERE folder = ?").get(FOLDER);
if (!row) { console.error("no group with folder", FOLDER); process.exit(1); }
const cfg = row.container_config ? JSON.parse(row.container_config) : {};
cfg.additionalMounts = cfg.additionalMounts || [];
if (!cfg.additionalMounts.some(m => m.containerPath === ".calendar-mcp")) {
  cfg.additionalMounts.push({ hostPath: HOST, containerPath: ".calendar-mcp", readonly: false });
}
db.prepare("UPDATE registered_groups SET container_config = ? WHERE folder = ?").run(JSON.stringify(cfg), FOLDER);
console.log("mounted .calendar-mcp for", row.name);
' telegram_main
```

`readonly: false` — the MCP server rewrites `credentials.json` on token refresh.
`containerPath` is relative (mount-security rejects absolute; extra mounts land at
`/workspace/extra/<relative>`). List groups to find folders:

```bash
node -e 'const d=require("better-sqlite3")("store/messages.db");for(const r of d.prepare("SELECT name,folder FROM registered_groups").all())console.log(r.name,"->",r.folder)'
```

> **Alternative (bot-driven):** you can instead ask the running assistant to
> "mount `~/.calendar-mcp` as `.calendar-mcp`", which writes the same
> `additionalMounts` entry — but the allowlist + orchestrator restart from
> Phase 1/4 are still required.

## Phase 4: Build and Restart

```bash
npm run build

# macOS
launchctl kickstart -k gui/$(id -u)/com.conclaw
# Linux
systemctl --user restart conclaw
```

Kill running agent containers so they respawn with the new image, mounts, and
mcpServers config:

```bash
docker ps -q --filter 'name=conclaw-' | xargs -r docker kill
```

## Phase 5: Verify

Ask a wired agent: **"list my calendars"** or **"what's on my calendar next
Monday?"**. The first call takes 2–3 s while the MCP server starts and OneCLI does
the token exchange.

Check logs if it misbehaves:

```bash
tail -100 logs/conclaw.log | grep -iE 'calendar|mcp'
docker logs $(docker ps --filter name=conclaw- --format '{{.Names}}' | head -1) 2>&1 | grep -iE 'calendar|mcp'
```

Common signals:
- `command not found: google-calendar-mcp` → image not rebuilt (or stale cache).
- `ENOENT ...credentials.json` → `.calendar-mcp` mount missing for this group, or
  not in the allowlist.
- `Invalid Credentials (Authorization)` / `401` **from Google** → the request
  bypassed the gateway entirely: the `onecliProxyEnv()` forward in Phase 2b/2c is
  missing, so the `onecli-managed` stub went straight to Google.
- `app_not_connected` **from OneCLI** → interception works; the provider just
  isn't connected. Finish Phase 1 (or check the agent's secret mode).
- "I don't have calendar tools" → agent-runner edits missing or image stale
  (calendar tools missing from `allowedTools`, or `calendar` not in `mcpServers`).

To test the server in isolation without going through an agent turn, drive it
over raw stdio in the built image (swap the `-e`/`-v` flags for the ones
`onecli.applyContainerConfig()` produces to test *with* the proxy):

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list-calendars","arguments":{}}}' \
| docker run -i --rm --add-host host.docker.internal:host-gateway \
    -v ~/.calendar-mcp:/workspace/extra/.calendar-mcp \
    -e GOOGLE_OAUTH_CREDENTIALS=/workspace/extra/.calendar-mcp/gcp-oauth.keys.json \
    -e GOOGLE_CALENDAR_MCP_TOKEN_PATH=/workspace/extra/.calendar-mcp/credentials.json \
    --entrypoint google-calendar-mcp conclaw-agent:latest
```

## Removal

See [REMOVE.md](REMOVE.md).

## Credits

- MCP server: [`@cocal/google-calendar-mcp`](https://github.com/cocal-com/google-calendar-mcp) (MIT).
- Adapted from NanoClaw's `/add-gcal-tool`; re-architected from per-group to global
  wiring because ConClaw's agent-runner passes a hardcoded `mcpServers` map.
