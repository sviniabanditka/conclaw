# Remove Google Calendar Tool

Idempotent — safe to run even if some steps were never applied.

## 1. Remove the `.calendar-mcp` mount from each group

There is no CLI — drop the entry from the central DB directly:

```bash
node -e '
const Database = require("better-sqlite3");
const db = new Database("store/messages.db");
for (const r of db.prepare("SELECT folder, container_config FROM registered_groups").all()) {
  if (!r.container_config) continue;
  const cfg = JSON.parse(r.container_config);
  if (!cfg.additionalMounts) continue;
  cfg.additionalMounts = cfg.additionalMounts.filter(m => m.containerPath !== ".calendar-mcp");
  db.prepare("UPDATE registered_groups SET container_config = ? WHERE folder = ?").run(JSON.stringify(cfg), r.folder);
}
console.log("removed .calendar-mcp mounts");
'
```

## 2. Revert the agent-runner edits

In `container/agent-runner/src/index.ts`:
- remove the `'mcp__calendar__*',` line from `allowedTools`.
- remove the whole `calendar: { command: 'google-calendar-mcp', ... }` block from
  the `mcpServers` map (leave `conclaw` intact).

## 3. Revert the Dockerfile edits

In `container/Dockerfile`, delete the calendar block:

```dockerfile
# ---- Google Calendar MCP server ---------------------------------------------
ARG CALENDAR_MCP_VERSION=2.6.1
RUN npm install -g "@cocal/google-calendar-mcp@${CALENDAR_MCP_VERSION}"
```

## 4. Delete the copied tests

```bash
rm -f src/gcal-dockerfile.test.ts src/gcal-agent-runner.test.ts
```

## 5. Rebuild and restart

```bash
npm run build && ./container/build.sh

# macOS
launchctl kickstart -k gui/$(id -u)/com.conclaw
# Linux
systemctl --user restart conclaw
```

Kill running agent containers so they respawn without the `calendar` MCP server:

```bash
docker ps -q --filter 'name=conclaw-' | xargs -r docker kill
```

## 6. Optional: remove stubs, allowlist entry, disconnect OneCLI

```bash
rm -rf ~/.calendar-mcp/
# also drop the ~/.calendar-mcp allowedRoots entry from
# ~/.config/conclaw/mount-allowlist.json (then restart the orchestrator)
onecli apps disconnect --provider google-calendar
```

## Verification

```bash
grep -q CALENDAR_MCP_VERSION container/Dockerfile && echo "still present" || echo "clean"
ls src/gcal-dockerfile.test.ts 2>&1   # No such file or directory
```
