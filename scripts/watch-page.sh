#!/bin/bash
# Detect that a watched page changed, without waking the agent.
#
# Runs as a scheduled task's `script`. Fetches the URL, reduces it to a
# fingerprint, and compares that with the previous run. Only a real change wakes
# the model — a page that sits still costs one container start and no tokens.
#
# Configured through the task's own environment:
#   WATCH_URL      page to fetch
#   WATCH_ID       stable name for the stored fingerprint
#   WATCH_SELECTOR optional grep -E filter, to watch part of a page
set -uo pipefail

STATE_DIR=/workspace/group/watchers
mkdir -p "$STATE_DIR"

URL="${WATCH_URL:-}"
ID="${WATCH_ID:-default}"
STATE="$STATE_DIR/$ID.sha"

if [ -z "$URL" ]; then
  echo "watch: WATCH_URL not set" >&2
  echo '{"wakeAgent": false}'
  exit 0
fi

BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

HTTP=$(curl -sS -L -o "$BODY" -w '%{http_code}' --max-time 30 \
  -H 'User-Agent: Mozilla/5.0 (compatible; ConClaw watcher)' "$URL" 2>/dev/null) || HTTP=000

if [ "$HTTP" != "200" ]; then
  # A failed fetch is not a change. Reporting one on every network blip would
  # make the watcher noise rather than signal, and the stored fingerprint stays
  # put so a real change is still caught next time.
  echo "watch: HTTP $HTTP for $URL" >&2
  echo '{"wakeAgent": false}'
  exit 0
fi

# Strip the parts of a page that differ on every request — scripts, styles,
# timestamps, CSRF tokens — or the watcher fires constantly and means nothing.
TEXT=$(sed -e 's/<script[^>]*>.*<\/script>//g' \
           -e 's/<style[^>]*>.*<\/style>//g' \
           -e 's/<[^>]*>/ /g' "$BODY" \
       | tr -s '[:space:]' ' ' \
       | sed -e 's/[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}//g')

if [ -n "${WATCH_SELECTOR:-}" ]; then
  TEXT=$(printf '%s' "$TEXT" | grep -oE "$WATCH_SELECTOR" | tr -s '[:space:]' ' ')
fi

NEW=$(printf '%s' "$TEXT" | sha256sum | cut -d' ' -f1)
OLD=$(cat "$STATE" 2>/dev/null || echo "")
printf '%s' "$NEW" > "$STATE"

if [ -z "$OLD" ]; then
  # First run only records the baseline. Announcing a "change" the moment a
  # watcher is created would be a false positive every time.
  echo "watch: baseline recorded for $ID" >&2
  echo '{"wakeAgent": false}'
  exit 0
fi

if [ "$NEW" = "$OLD" ]; then
  echo '{"wakeAgent": false}'
  exit 0
fi

# Give the agent enough to describe the change without fetching again.
EXCERPT=$(printf '%s' "$TEXT" | head -c 1500)
node --input-type=module -e '
const [url, id, excerpt] = process.argv.slice(1);
console.log(JSON.stringify({ wakeAgent: true, data: { url, id, excerpt } }));
' "$URL" "$ID" "$EXCERPT"
