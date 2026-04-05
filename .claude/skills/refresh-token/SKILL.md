---
name: refresh-token
description: Set up automatic Claude OAuth token refresh via cron. Required when using a Claude Pro/Max subscription (tokens expire every ~7 hours). Installs the refresh script and configures an hourly cron job.
---

# Refresh Token — Automatic Claude OAuth Token Refresh

Claude OAuth tokens (used with Pro/Max subscriptions) expire approximately every 7 hours. This skill installs a script that automatically refreshes the token and syncs it to the credential system, then sets up an hourly cron job to keep credentials valid 24/7.

**Not needed if:** You use an `ANTHROPIC_API_KEY` (pay-per-use) — those don't expire.

## How It Works

1. `scripts/refresh-token.sh` invokes `claude -p "ping"` which triggers the Claude CLI's built-in OAuth token auto-refresh
2. The script reads the refreshed token from `~/.claude/.credentials.json`
3. It deletes the old OneCLI secret and creates a new one with the fresh token
4. Cron runs this every hour, ensuring the token never expires

## Phase 1: Pre-flight

### Check if script exists

```bash
test -f scripts/refresh-token.sh && echo "EXISTS" || echo "MISSING"
```

If `EXISTS`, skip to Phase 3 (Set Up Cron).

### Check auth method

```bash
grep -q "ANTHROPIC_API_KEY" .env && echo "API_KEY" || echo "OAUTH"
```

If `API_KEY`, tell the user: "You're using an Anthropic API key, which doesn't expire. This skill is only needed for Claude Pro/Max subscription tokens. Skip this skill."

### Check prerequisites

```bash
claude --version 2>/dev/null && echo "OK" || echo "MISSING"
onecli version 2>/dev/null && echo "OK" || echo "MISSING"
python3 --version 2>/dev/null && echo "OK" || echo "MISSING"
```

All three (`claude`, `onecli`, `python3`) must be available. If any are missing, fix before proceeding.

## Phase 2: Install Script

### Copy the script

If the script was included in a skill branch merge (e.g., `/add-voice-telegram`), it's already at `scripts/refresh-token.sh`. Otherwise, copy it from the skill directory:

```bash
mkdir -p scripts
cp "${CLAUDE_SKILL_DIR}/refresh-token.sh" scripts/refresh-token.sh 2>/dev/null || true
chmod +x scripts/refresh-token.sh
```

### Test the script

```bash
bash scripts/refresh-token.sh
```

Expected output: `Token refreshed at <date>`. If it fails:
- "No credentials file found" → Run `claude auth login` first
- "Failed to extract token" → Check `~/.claude/.credentials.json` exists and has `claudeAiOauth.accessToken`
- "onecli: command not found" → Install OneCLI or add `~/.local/bin` to PATH

## Phase 3: Set Up Cron

### Add hourly cron job

Create the logs directory and install the cron entry:

```bash
mkdir -p logs
(crontab -l 2>/dev/null | grep -v refresh-token; echo "0 * * * * $(pwd)/scripts/refresh-token.sh >> $(pwd)/logs/token-refresh.log 2>&1") | crontab -
```

This runs at minute 0 of every hour. The token expires every ~7 hours, so hourly refresh provides comfortable margin.

### Verify cron is installed

```bash
crontab -l | grep refresh-token
```

Should show the cron entry with the full path.

### On macOS: ensure cron has disk access

macOS may block cron from accessing files. If cron fails silently:

1. Open **System Preferences** > **Privacy & Security** > **Full Disk Access**
2. Add `/usr/sbin/cron`

Alternatively, use launchd instead of cron:

```bash
cat > ~/Library/LaunchAgents/com.conclaw.refresh-token.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.conclaw.refresh-token</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(pwd)/scripts/refresh-token.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>StandardOutPath</key>
  <string>$(pwd)/logs/token-refresh.log</string>
  <key>StandardErrorPath</key>
  <string>$(pwd)/logs/token-refresh.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin</string>
  </dict>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.conclaw.refresh-token.plist
```

## Phase 4: Verify

### Check refresh log

Wait for the next hour mark, or run manually:

```bash
bash scripts/refresh-token.sh
cat logs/token-refresh.log
```

### Verify the secret was updated

```bash
onecli secrets list
```

Should show an Anthropic secret with a recent timestamp.

## Troubleshooting

### Token not refreshing

1. Check cron is running: `crontab -l | grep refresh`
2. Check log: `tail -20 logs/token-refresh.log`
3. Test manually: `bash scripts/refresh-token.sh`
4. Verify Claude auth: `claude auth status`

### "Claude invocation failed, using existing token"

The `claude -p "ping"` call failed, but the script continues with the existing token. This is usually fine — the token may still be valid. If it persists:
- Check `claude` is in PATH: `which claude`
- Check Claude is authenticated: `claude auth status`

### Cron not running on Linux

Ensure cron service is active:
```bash
systemctl status cron
# or
systemctl status crond
```

### Token still expires despite cron

- Check that the cron command uses absolute paths (it should, since the install command uses `$(pwd)`)
- Check that the OneCLI gateway is running: `curl -sf http://127.0.0.1:10254/health`
- Check logs for errors: `tail -50 logs/token-refresh.log`

## Removal

```bash
# Remove cron job
crontab -l | grep -v refresh-token | crontab -

# Or remove launchd job (macOS)
launchctl unload ~/Library/LaunchAgents/com.conclaw.refresh-token.plist 2>/dev/null
rm ~/Library/LaunchAgents/com.conclaw.refresh-token.plist 2>/dev/null

# Remove script
rm scripts/refresh-token.sh

# Remove logs
rm -f logs/token-refresh.log
```
