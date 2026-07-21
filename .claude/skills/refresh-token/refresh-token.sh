#!/bin/bash
# Refresh the OneCLI Anthropic secret from Claude Code's auto-refreshed credentials.
# Runs `claude -p` to trigger the OAuth refresh, then copies the token into OneCLI.
# Scheduled hourly by cron, or by refresh-token-loop.sh where cron is unavailable.

set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

CREDS_FILE="$HOME/.claude/.credentials.json"
ONECLI="$(command -v onecli)"
CLAUDE="$(command -v claude)"

if [ ! -f "$CREDS_FILE" ]; then
  echo "No credentials file found at $CREDS_FILE"
  exit 1
fi

if [ -z "$ONECLI" ] || [ -z "$CLAUDE" ]; then
  echo "Missing binary: onecli='$ONECLI' claude='$CLAUDE'"
  exit 1
fi

# Run Claude to trigger automatic token refresh
echo "Triggering token refresh via Claude..."
"$CLAUDE" -p "ping" --max-turns 1 >/dev/null 2>&1 || echo "Claude invocation failed, using existing token"

TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['claudeAiOauth']['accessToken'])")
if [ -z "$TOKEN" ]; then
  echo "Failed to extract token"
  exit 1
fi

# Get existing secret ID. The CLI wraps results in {"hint":..., "data":[...]};
# older versions returned a bare list, so accept both.
SECRET_ID=$("$ONECLI" secrets list | python3 -c "
import sys, json
payload = json.load(sys.stdin)
secrets = payload.get('data', []) if isinstance(payload, dict) else payload
anthropic = [s for s in secrets if s.get('hostPattern') == 'api.anthropic.com']
print(anthropic[0]['id'] if anthropic else '')
")

# Update in place rather than delete + create. A delete/create pair leaves a
# window of several seconds with no credential at all, during which the gateway
# hard-fails every request with `credential not found`. It also churns the
# secret ID on every run, which silently breaks any agent pinned to that ID via
# secretMode=selective.
if [ -n "$SECRET_ID" ]; then
  "$ONECLI" secrets update --id "$SECRET_ID" --value "$TOKEN" >/dev/null
else
  # Created as a generic secret with the header spelled out, not --type
  # anthropic. The typed variant stopped resolving in the gateway — it lists
  # fine and matches the host, but every request comes back
  # `credential_not_found`, while this shape returns 200 with the same token.
  echo "No existing Anthropic secret found; creating one"
  "$ONECLI" secrets create \
    --name "Anthropic OAuth" \
    --type generic \
    --value "$TOKEN" \
    --host-pattern api.anthropic.com \
    --path-pattern '/*' \
    --header-name Authorization \
    --value-format 'Bearer {value}' >/dev/null
fi

echo "Token refreshed at $(date)"
