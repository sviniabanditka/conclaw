/**
 * Step: verify — End-to-end health check of the full installation.
 * Replaces 09-verify.sh
 *
 * Uses better-sqlite3 directly (no sqlite3 CLI), platform-aware service checks.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';


import { STORE_DIR } from '../src/config.js';
import { readEnvFile } from '../src/env.js';
import { transcriptionProblems } from '../src/transcription.js';
import { checkAnthropicCredential } from '../src/credential-check.js';
import { DATA_DIR, ONECLI_URL } from '../src/config.js';
import { logger } from '../src/logger.js';
import { getServiceManager, isRoot } from './platform.js';
import { emitStatus } from './status.js';

export async function run(_args: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const homeDir = os.homedir();

  logger.info('Starting verification');

  // 1. Check service status
  let service = 'not_found';
  const mgr = getServiceManager();

  if (mgr === 'launchd') {
    try {
      const output = execSync('launchctl list', { encoding: 'utf-8' });
      if (output.includes('com.conclaw')) {
        // Check if it has a PID (actually running)
        const line = output.split('\n').find((l) => l.includes('com.conclaw'));
        if (line) {
          const pidField = line.trim().split(/\s+/)[0];
          service = pidField !== '-' && pidField ? 'running' : 'stopped';
        }
      }
    } catch {
      // launchctl not available
    }
  } else if (mgr === 'systemd') {
    const prefix = isRoot() ? 'systemctl' : 'systemctl --user';
    try {
      execSync(`${prefix} is-active conclaw`, { stdio: 'ignore' });
      service = 'running';
    } catch {
      try {
        const output = execSync(`${prefix} list-unit-files`, {
          encoding: 'utf-8',
        });
        if (output.includes('conclaw')) {
          service = 'stopped';
        }
      } catch {
        // systemctl not available
      }
    }
  } else {
    // Check for nohup PID file
    const pidFile = path.join(projectRoot, 'conclaw.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const raw = fs.readFileSync(pidFile, 'utf-8').trim();
        const pid = Number(raw);
        if (raw && Number.isInteger(pid) && pid > 0) {
          process.kill(pid, 0);
          service = 'running';
        }
      } catch {
        service = 'stopped';
      }
    }
  }
  // Neither manager knows about it — but "not managed" is not "not running".
  // A pod without systemd runs it under tmux or nohup, and reporting that as a
  // dead service sends you restarting something that is already up.
  if (service !== 'running') {
    try {
      execSync('pgrep -f "node dist/index.js"', { stdio: 'ignore' });
      service = 'running_unmanaged';
    } catch {
      // Genuinely not running.
    }
  }

  logger.info({ service }, 'Service status');

  // 2. Check container runtime
  let containerRuntime = 'none';
  try {
    execSync('docker info', { stdio: 'ignore' });
    containerRuntime = 'docker';
  } catch {
    // No runtime
  }

  // 3. Check credentials
  let credentials = 'missing';
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    if (/^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|ONECLI_URL)=/m.test(envContent)) {
      credentials = 'configured';
    }
  }

  // 4. Check channel auth (detect configured channels by credentials)
  const envVars = readEnvFile([
    'TELEGRAM_BOT_TOKEN',
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'DISCORD_BOT_TOKEN',
  ]);

  const channelAuth: Record<string, string> = {};

  // WhatsApp: check for auth credentials on disk
  const authDir = path.join(projectRoot, 'store', 'auth');
  if (fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0) {
    channelAuth.whatsapp = 'authenticated';
  }

  // Token-based channels: check .env
  if (process.env.TELEGRAM_BOT_TOKEN || envVars.TELEGRAM_BOT_TOKEN) {
    channelAuth.telegram = 'configured';
  }
  if (
    (process.env.SLACK_BOT_TOKEN || envVars.SLACK_BOT_TOKEN) &&
    (process.env.SLACK_APP_TOKEN || envVars.SLACK_APP_TOKEN)
  ) {
    channelAuth.slack = 'configured';
  }
  if (process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN) {
    channelAuth.discord = 'configured';
  }

  const configuredChannels = Object.keys(channelAuth);
  const anyChannelConfigured = configuredChannels.length > 0;

  // 5. Check registered groups (using better-sqlite3, not sqlite3 CLI)
  let registeredGroups = 0;
  const dbPath = path.join(STORE_DIR, 'messages.db');
  if (fs.existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare('SELECT COUNT(*) as count FROM registered_groups')
        .get() as { count: number };
      registeredGroups = row.count;
      db.close();
    } catch {
      // Table might not exist
    }
  }

  // 6. Check mount allowlist
  let mountAllowlist = 'missing';
  if (
    fs.existsSync(
      path.join(homeDir, '.config', 'conclaw', 'mount-allowlist.json'),
    )
  ) {
    mountAllowlist = 'configured';
  }

  // 7. Features that fail quietly.
  //
  // Everything above is missing in a way you notice within a minute. These are
  // the ones that look installed and do nothing: a voice note comes back as
  // `[Voice message]` with no explanation hours later, and a Mini App with no
  // allowlist simply refuses to open its port. Both happened here.
  const transcription = await transcriptionProblems();

  const miniapp = readEnvFile(['MINIAPP_PORT', 'MINIAPP_ALLOWED_USER_IDS']);
  const miniappPort = process.env.MINIAPP_PORT || miniapp.MINIAPP_PORT;
  const miniappUsers =
    process.env.MINIAPP_ALLOWED_USER_IDS || miniapp.MINIAPP_ALLOWED_USER_IDS;
  const miniappState = !miniappPort
    ? 'disabled'
    : miniappUsers
      ? 'configured'
      : 'port_without_allowlist';

  // The calendar wiring ships on main and stays inert until these exist, so
  // their absence is a state, not a fault.
  const calendarStubs = fs.existsSync(
    path.join(homeDir, '.calendar-mcp', 'gcp-oauth.keys.json'),
  )
    ? 'configured'
    : 'not_configured';

  // Does the credential actually work? Everything else asks whether something
  // is configured; during the outage this was written for, the gateway was up,
  // the secret was listed and its own logs said the injection had been
  // applied — while every reply failed with 401 for hours.
  const { OneCLI } = await import('@onecli-sh/sdk');
  const onecli = new OneCLI({ url: ONECLI_URL });
  const probe = await checkAnthropicCredential({
    getGatewayConfig: () => onecli.getContainerConfig(),
    tmpDir: path.join(DATA_DIR, 'tmp'),
  });
  const credentialWorks = probe.ok ? 'yes' : `${probe.reason} — ${probe.detail}`;

  // Token refresh is scheduled outside this process, so nothing here notices
  // its absence until the credential expires hours later and every reply
  // starts failing with a 401 that reads like a broken key.
  const refreshScript = path.join(projectRoot, 'scripts', 'refresh-token-loop.sh');
  const refreshLog = path.join(projectRoot, 'logs', 'refresh-token.log');
  let tokenRefresh = 'not_installed';
  if (fs.existsSync(refreshScript)) {
    try {
      const ageMs = Date.now() - fs.statSync(refreshLog).mtimeMs;
      // The loop runs hourly; ninety minutes tolerates one missed cycle.
      tokenRefresh = ageMs < 90 * 60_000 ? 'running' : 'stale';
    } catch {
      tokenRefresh = 'never_ran';
    }
  }

  // Determine overall status
  // A rejected credential is fatal — the bot cannot answer at all. An
  // unreachable gateway is not: an install using the native credential proxy
  // instead of OneCLI has no gateway to reach, and failing it here would be a
  // false alarm on a working system.
  const credentialFatal = !probe.ok && probe.reason === 'unauthorized';

  const status =
    (service === 'running' || service === 'running_unmanaged') &&
    credentials !== 'missing' &&
    anyChannelConfigured &&
    registeredGroups > 0 &&
    !credentialFatal
      ? 'success'
      : 'failed';

  logger.info({ status, channelAuth }, 'Verification complete');

  emitStatus('VERIFY', {
    SERVICE: service,
    CONTAINER_RUNTIME: containerRuntime,
    CREDENTIALS: credentials,
    CONFIGURED_CHANNELS: configuredChannels.join(','),
    CHANNEL_AUTH: JSON.stringify(channelAuth),
    REGISTERED_GROUPS: registeredGroups,
    MOUNT_ALLOWLIST: mountAllowlist,
    TRANSCRIPTION: transcription.length === 0 ? 'ready' : transcription.join('; '),
    TOKEN_REFRESH: tokenRefresh,
    CREDENTIAL_WORKS: credentialWorks,
    MINIAPP: miniappState,
    CALENDAR: calendarStubs,
    STATUS: status,
    LOG: 'logs/setup.log',
  });

  if (status === 'failed') process.exit(1);
}
