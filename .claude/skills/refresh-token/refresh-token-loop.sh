#!/bin/bash
# Cron replacement: re-runs refresh-token.sh on an interval, forever.
#
# For hosts with no crond and no systemd timers — containers and managed pods
# often have neither, so the hourly cron entry this skill normally installs is
# unavailable. Running this in a tmux window alongside the service gives the same
# effect for as long as the host lives.
#
# Note it dies with its tmux session and does not self-restart, so a token can
# quietly go stale for hours. Watch the freshness of the last line in
# logs/refresh-token.log rather than assuming it is still running.
#
# Usage: tmux new-session -d -s refresh 'scripts/refresh-token-loop.sh'

set -uo pipefail

INTERVAL="${REFRESH_INTERVAL_SECONDS:-3600}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$HERE/../logs/refresh-token.log"

mkdir -p "$(dirname "$LOG")"

echo "[$(date)] refresh loop started (interval ${INTERVAL}s)" >>"$LOG"

while true; do
  # Never let one bad run kill the loop; the token has ~7h of slack.
  if "$HERE/refresh-token.sh" >>"$LOG" 2>&1; then
    echo "[$(date)] refresh ok" >>"$LOG"
  else
    echo "[$(date)] refresh FAILED (exit $?), retrying in ${INTERVAL}s" >>"$LOG"
  fi
  sleep "$INTERVAL"
done
