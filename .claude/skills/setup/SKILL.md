---
name: setup
description: Run initial ConClaw setup. Use when user wants to install dependencies, authenticate Telegram, register their main channel, or start the background services. Triggers on "setup", "install", "configure conclaw", or first-time setup requests.
---

# ConClaw Setup

Run setup steps automatically. Only pause when user action is required (channel authentication, configuration choices). Setup uses `bash setup.sh` for bootstrap, then `npx tsx setup/index.ts --step <name>` for all other steps. Steps emit structured status blocks to stdout. Verbose logs go to `logs/setup.log`.

**Principle:** When something is broken or missing, fix it. Don't tell the user to go fix it themselves unless it genuinely requires their manual action (e.g. authenticating a channel, pasting a secret token). If a dependency is missing, install it. If a service won't start, diagnose and repair. Ask the user for permission when needed, then do the work.

**UX Note:** Use `AskUserQuestion` for multiple-choice questions only. Do NOT use it when free-text input is needed (e.g. tokens, paths) — just ask the question in plain text and wait for the user's reply.

## 0. Git & Fork Setup

Check the git remote configuration.

Run:
- `git remote -v`

Verify `origin` points to the user's repo (e.g. `sviniabanditka/conclaw` or their fork). If `upstream` is missing and user wants to track upstream updates:

```bash
git remote add upstream https://github.com/sviniabanditka/conclaw.git
```

## 1. Bootstrap (Node.js + Dependencies)

Run `bash setup.sh` and parse the status block.

- If NODE_OK=false → Node.js is missing or too old. Use `AskUserQuestion: Would you like me to install Node.js 22?` If confirmed:
  - macOS: `brew install node@22` (if brew available) or install nvm then `nvm install 22`
  - Linux: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`, or nvm
  - After installing Node, re-run `bash setup.sh`
- If DEPS_OK=false → Read `logs/setup.log`. Try: delete `node_modules`, re-run `bash setup.sh`. If native module build fails, install build tools (`xcode-select --install` on macOS, `build-essential` on Linux), then retry.
- If NATIVE_OK=false → better-sqlite3 failed to load. Install build tools and re-run.
- Record PLATFORM and IS_WSL for later steps.

## 2. Check Environment

Run `npx tsx setup/index.ts --step environment` and parse the status block.

- If HAS_AUTH=true → already configured, note for step 5
- If HAS_REGISTERED_GROUPS=true → note existing config, offer to skip or reconfigure
- Record DOCKER value for step 3

## 2a. Timezone

Run `npx tsx setup/index.ts --step timezone` and parse the status block.

- If NEEDS_USER_INPUT=true → AskUserQuestion: "What is your timezone?" with common options and an "Other" escape. Then re-run: `npx tsx setup/index.ts --step timezone -- --tz <their-answer>`.
- If STATUS=success → Timezone is configured.

## 3. Container Runtime

### 3a. Choose runtime

Check the preflight results for `DOCKER` and the PLATFORM from step 1. Docker is the only supported runtime.

### 3a-docker. Install Docker

- DOCKER=running → continue to step 4
- DOCKER=installed_not_running → start Docker: `open -a Docker` (macOS) or `sudo systemctl start docker` (Linux). Wait 15s, re-check.
- DOCKER=not_found → Ask user, then install via `brew install --cask docker` (macOS) or `curl -fsSL https://get.docker.com | sh` (Linux).

### 3c. Build and test

Run `npx tsx setup/index.ts --step container -- --runtime <chosen>` and parse the status block.

## 4. Credential System

The credential system depends on the container runtime chosen in step 3.

### 4a. Docker → OneCLI

Install OneCLI and its CLI tool:

```bash
curl -fsSL onecli.sh/install | sh
curl -fsSL onecli.sh/cli/install | sh
```

Verify both installed: `onecli version`. If the command is not found, add `~/.local/bin` to PATH.

Then configure and register credentials. See `/init-onecli` skill for the full credential setup flow.

## 5. Set Up Telegram Channel

Invoke the `/add-telegram` skill. It handles code installation, authentication, registration, and JID resolution.

After the skill completes, rebuild:

```bash
npm install && npm run build
```

## 6. Mount Allowlist

AskUserQuestion: Agent access to external directories?

**No:** `npx tsx setup/index.ts --step mounts -- --empty`
**Yes:** Collect paths/permissions. `npx tsx setup/index.ts --step mounts -- --json '{"allowedRoots":[...],"blockedPatterns":[],"nonMainReadOnly":true}'`

## 7. Start Service

If service already running: unload first.
- macOS: `launchctl unload ~/Library/LaunchAgents/com.conclaw.plist`
- Linux: `systemctl --user stop conclaw`

Run `npx tsx setup/index.ts --step service` and parse the status block.

## 8. Verify

Run `npx tsx setup/index.ts --step verify` and parse the status block.

**If STATUS=failed, fix each:**
- SERVICE=stopped → `npm run build`, then restart
- CREDENTIALS=missing → re-run step 4
- CHANNEL_AUTH shows `not_found` → re-invoke `/add-telegram`
- REGISTERED_GROUPS=0 → re-invoke `/add-telegram`
- MOUNT_ALLOWLIST=missing → `npx tsx setup/index.ts --step mounts -- --empty`

Tell user to test: send a message in their registered Telegram chat. Show: `tail -f logs/conclaw.log`

## Troubleshooting

**Service not starting:** Check `logs/conclaw.error.log`. Common: wrong Node path (re-run step 7), credential system not running, missing channel credentials.

**Container agent fails ("Claude Code process exited with code 1"):** Ensure the container runtime is running. Check container logs in `groups/main/logs/container-*.log`.

**No response to messages:** Check trigger pattern. Main channel doesn't need prefix. Check `logs/conclaw.log`.

**Channel not connecting:** Verify `TELEGRAM_BOT_TOKEN` is set in `.env`. Channels auto-enable when their credentials are present. Restart the service after any `.env` change.

**Unload service:** macOS: `launchctl unload ~/Library/LaunchAgents/com.conclaw.plist` | Linux: `systemctl --user stop conclaw`
