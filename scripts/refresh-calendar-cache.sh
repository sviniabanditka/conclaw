#!/bin/bash
# Refresh today's Google Calendar cache from inside an agent container.
#
# Runs as a scheduled task's `script`, and deliberately never wakes the agent:
# fetching a list of events needs no reasoning. The OneCLI gateway injects the
# OAuth token into outbound HTTPS, so a plain curl is authenticated without the
# container ever holding a credential — the same path the calendar MCP server
# takes, minus the model call.
#
# Cheap enough to run often, which is the point: the cache is what reminders are
# derived from, so a meeting created shortly before it starts is only ever
# noticed as fast as this runs.
set -uo pipefail

OUT=/workspace/group/today_events.json
TMP=$(mktemp)
RAW=$(mktemp)
trap 'rm -f "$TMP" "$RAW"' EXIT

FROM=$(date -Iseconds -d 'today 00:00:00')
TO=$(date -Iseconds -d 'today 23:59:59')

HTTP=$(curl -sS -o "$RAW" -w '%{http_code}' -G --max-time 30 \
  "https://www.googleapis.com/calendar/v3/calendars/primary/events" \
  --data-urlencode "timeMin=$FROM" \
  --data-urlencode "timeMax=$TO" \
  --data-urlencode "singleEvents=true" \
  --data-urlencode "orderBy=startTime" 2>/dev/null) || HTTP=000

if [ "$HTTP" != "200" ]; then
  # Leave the existing cache alone. A stale cache still produces correct
  # reminders for events already in it; an empty one silently cancels them all.
  echo "calendar refresh failed: HTTP $HTTP" >&2
  echo '{"wakeAgent": false}'
  exit 0
fi

node --input-type=module -e '
import fs from "fs";
const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const items = Array.isArray(raw.items) ? raw.items : [];
fs.writeFileSync(process.argv[2], JSON.stringify(items));
console.error(`calendar cache: ${items.length} event(s)`);
' "$RAW" "$TMP" || {
  echo "calendar refresh failed: could not parse response" >&2
  echo '{"wakeAgent": false}'
  exit 0
}

mv "$TMP" "$OUT"
echo '{"wakeAgent": false}'
