---
name: status
description: Quick read-only health check — session context, workspace mounts, tool availability, and task snapshot. Use when the user asks for system status or runs /status.
---

# /status — System Status Check

Generate a quick read-only status report of the current agent environment.

**Main-channel check:** Only the main channel has `/workspace/project` mounted. Run:

```bash
test -d /workspace/project && echo "MAIN" || echo "NOT_MAIN"
```

If `NOT_MAIN`, respond with:
> This command is available in your main chat only. Send `/status` there to check system status.

Then stop — do not generate the report.

## How to gather the information

Run the checks below and compile results into the report format.

### 1. Session context

```bash
echo "Timestamp: $(date)"
echo "Working dir: $(pwd)"
echo "Channel: main"
```

### 2. Workspace and mount visibility

```bash
echo "=== Workspace ==="
ls /workspace/ 2>/dev/null
echo "=== Group folder ==="
ls /workspace/group/ 2>/dev/null | head -20
echo "=== Extra mounts ==="
ls /workspace/extra/ 2>/dev/null || echo "none"
echo "=== IPC ==="
ls /workspace/ipc/ 2>/dev/null
```

### 3. Tool availability

Confirm which tool families are available to you:

- **Core:** Bash, Read, Write, Edit, Glob, Grep
- **Web:** WebSearch, WebFetch
- **Orchestration:** Task, TaskOutput, TaskStop, TeamCreate, TeamDelete, SendMessage
- **MCP:** mcp__conclaw__* (send_message, schedule_task, list_tasks, pause_task, resume_task, cancel_task, update_task, register_group)

### 4. Container utilities

```bash
which agent-browser 2>/dev/null && echo "agent-browser: available" || echo "agent-browser: not installed"
node --version 2>/dev/null
claude --version 2>/dev/null
```

### 5. Task snapshot

Use the MCP tool to list tasks:

```
Call mcp__conclaw__list_tasks to get scheduled tasks.
```

If no tasks exist, report "No scheduled tasks."

### 6. Credential refresh freshness

Claude OAuth tokens expire every ~7h, and the refresher is scheduled by cron or
by a `refresh-token-loop.sh` running in tmux. A tmux loop dies with its session
and does **not** restart itself, so the only evidence it is still alive is the
freshness of its log. When it stops, nothing surfaces until the token expires
hours later and every reply fails with `401 authentication_error` — which reads
like a broken credential rather than a stopped loop.

```bash
F=/workspace/project/logs/refresh-token.log
if [ ! -f "$F" ]; then
  echo "refresh: not configured (no log)"
else
  AGE=$(( ($(date +%s) - $(stat -c %Y "$F")) / 60 ))
  echo "refresh: last activity ${AGE} min ago"
  echo "last line: $(tail -1 "$F")"
  if [ "$AGE" -lt 90 ]; then echo "verdict: OK"
  elif [ "$AGE" -lt 360 ]; then echo "verdict: STALE"
  else echo "verdict: CRITICAL"; fi
fi
```

Thresholds follow the refresher's hourly cadence against the ~7h token life:

| Age | Verdict | Meaning |
|-----|---------|---------|
| < 90 min | ✓ OK | Ran within the last cycle |
| 90 min – 6 h | ⚠️ STALE | Scheduler likely dead; token still valid, so there is time to fix it |
| > 6 h | 🚨 CRITICAL | Token is expiring or already expired — replies are about to start failing |

On STALE or CRITICAL, say plainly that the refresher looks dead and give the
restart command:

```bash
tmux new -d -s refresh 'scripts/refresh-token-loop.sh'
```

(Check `tmux ls` first — a session may exist with a wedged loop inside it.)

Note this reads the log through the read-only `/workspace/project` mount, which
only the main channel has — the same reason this whole command is main-only.

## Report format

Present as a clean, readable message:

```
🔍 *ConClaw Status*

*Session:*
• Channel: main
• Time: 2026-03-14 09:30 UTC
• Working dir: /workspace/group

*Workspace:*
• Group folder: ✓ (N files)
• Extra mounts: none / N directories
• IPC: ✓ (messages, tasks, input)

*Tools:*
• Core: ✓  Web: ✓  Orchestration: ✓  MCP: ✓

*Container:*
• agent-browser: ✓ / not installed
• Node: vXX.X.X
• Claude Code: vX.X.X

*Scheduled Tasks:*
• N active tasks / No scheduled tasks

*Token refresh:*
• ✓ last run 12 min ago
```

If the refresh verdict is STALE or CRITICAL, do not bury it in the list — lead
the report with it, since everything else being healthy is irrelevant once the
credential expires:

```
🚨 *Token refresh is dead* — last run 7h ago, token has likely expired.
Restart it: `tmux new -d -s refresh 'scripts/refresh-token-loop.sh'`
```

Adapt based on what you actually find. Keep it concise — this is a quick health check, not a deep diagnostic.

**See also:** `/capabilities` for a full list of installed skills and tools.
