#!/bin/bash
# Refresh OneCLI Anthropic secret from Claude Code's auto-refreshed credentials.
# Runs claude -p to trigger OAuth token refresh, then copies to OneCLI.
# Intended to run via cron every 4 hours.

set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

CREDS_FILE="$HOME/.claude/.credentials.json"
ONECLI="$HOME/.local/bin/onecli"
CLAUDE="$HOME/.local/bin/claude"

if [ ! -f "$CREDS_FILE" ]; then
  echo "No credentials file found"
  exit 1
fi

# Run Claude to trigger automatic token refresh
echo "Triggering token refresh via Claude..."
$CLAUDE -p "ping" --max-turns 1 >/dev/null 2>&1 || echo "Claude invocation failed, using existing token"

# Extract current access token
TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['claudeAiOauth']['accessToken'])")
if [ -z "$TOKEN" ]; then
  echo "Failed to extract token"
  exit 1
fi

# Get existing secret ID
SECRET_ID=$($ONECLI secrets list 2>/dev/null | python3 -c "
import sys, json
secrets = json.load(sys.stdin)
anthropic = [s for s in secrets if s.get('hostPattern') == 'api.anthropic.com']
print(anthropic[0]['id'] if anthropic else '')
")

# Delete old and create new
if [ -n "$SECRET_ID" ]; then
  $ONECLI secrets delete --id "$SECRET_ID" >/dev/null 2>&1
fi

$ONECLI secrets create \
  --name Anthropic \
  --type anthropic \
  --value "$TOKEN" \
  --host-pattern api.anthropic.com >/dev/null 2>&1

echo "Token refreshed at $(date)"
