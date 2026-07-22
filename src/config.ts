import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { isValidTimezone } from './timezone.js';

// Read config values from .env (falls back to process.env).
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'ONECLI_URL',
  'TZ',
  'HEARTBEAT_URL',
  'HEARTBEAT_INTERVAL_MS',
  'WEATHER_LATITUDE',
  'WEATHER_LONGITUDE',
  'CALENDAR_REFRESH_INTERVAL_MS',
  'MINIAPP_PORT',
  'MINIAPP_ALLOWED_USER_IDS',
]);

/**
 * The name written into the `groups/<name>/CLAUDE.md` templates.
 *
 * Registration rewrites those files when the configured name differs, so this
 * constant and the markdown have to agree — it lives here rather than as a
 * string literal in the two places that do the rewriting, because a rename
 * that misses one of them produces a persona addressed by two names.
 */
export const TEMPLATE_ASSISTANT_NAME = 'ConClaw';

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME ||
  envConfig.ASSISTANT_NAME ||
  TEMPLATE_ASSISTANT_NAME;
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;

/**
 * Repaint cadence for the live "working…" message, and the slower cadence it
 * falls back to once the platform rate-limits an edit. Editing is far more
 * restricted than sending, so this only ever backs off, never speeds up.
 */
export const LIVE_MESSAGE_INTERVAL_MS = parseInt(
  process.env.LIVE_MESSAGE_INTERVAL_MS || '1000',
  10,
);
export const LIVE_MESSAGE_BACKOFF_MS = parseInt(
  process.env.LIVE_MESSAGE_BACKOFF_MS || '2000',
  10,
);
/** Telegram's per-message character cap. */
export const TELEGRAM_MAX_LENGTH = 4096;
export const SCHEDULER_POLL_INTERVAL = 60000;
/**
 * How often reminder tasks are re-derived from each group's schedule.md.
 * The file is edited by hand and by the agent, and a stale reminder stays
 * invisible until it fires at the wrong time, so re-check often — the sync is
 * a file read and a diff.
 */
export const SCHEDULE_SYNC_INTERVAL = 60000;

/**
 * Coordinates for the weather line in the morning rundown. Unset disables it —
 * a wrong-city forecast is worse than none.
 */
export const WEATHER_LATITUDE =
  process.env.WEATHER_LATITUDE || envConfig.WEATHER_LATITUDE || '';
export const WEATHER_LONGITUDE =
  process.env.WEATHER_LONGITUDE || envConfig.WEATHER_LONGITUDE || '';

/**
 * How often the Google Calendar cache is refetched.
 *
 * One HTTPS request through the OneCLI gateway, from the host — cheap enough
 * to run often, and how often decides how quickly a meeting created shortly
 * before it starts is noticed at all.
 */
export const CALENDAR_REFRESH_INTERVAL_MS = parseInt(
  process.env.CALENDAR_REFRESH_INTERVAL_MS ||
    envConfig.CALENDAR_REFRESH_INTERVAL_MS ||
    '300000',
  10,
);

/**
 * Telegram Mini App.
 *
 * Both must be set for the app to start. The port is opt-in because this is
 * the only listening socket ConClaw has, and the allowlist is opt-in because
 * an unset one would mean "any Telegram user who finds the URL" — so an
 * install that configures neither exposes nothing at all.
 */
export const MINIAPP_PORT = parseInt(
  process.env.MINIAPP_PORT || envConfig.MINIAPP_PORT || '0',
  10,
);
export const MINIAPP_ALLOWED_USER_IDS =
  process.env.MINIAPP_ALLOWED_USER_IDS ||
  envConfig.MINIAPP_ALLOWED_USER_IDS ||
  '';

/**
 * Dead-man's switch to an external monitor. Unset disables it — the feature
 * needs a check created at a monitoring service, so it cannot have a default.
 */
export const HEARTBEAT_URL =
  process.env.HEARTBEAT_URL || envConfig.HEARTBEAT_URL || '';
export const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.HEARTBEAT_INTERVAL_MS || envConfig.HEARTBEAT_INTERVAL_MS || '300000',
  10,
);

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'conclaw',
  'mount-allowlist.json',
);
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'conclaw',
  'sender-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const LOGS_DIR = path.resolve(PROJECT_ROOT, 'logs');
export const SCRIPTS_DIR = path.resolve(PROJECT_ROOT, 'scripts');

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'conclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const ONECLI_URL =
  process.env.ONECLI_URL || envConfig.ONECLI_URL || 'http://localhost:10254';
export const MAX_MESSAGES_PER_PROMPT = Math.max(
  1,
  parseInt(process.env.MAX_MESSAGES_PER_PROMPT || '10', 10) || 10,
);
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTriggerPattern(trigger: string): RegExp {
  return new RegExp(`^${escapeRegex(trigger.trim())}\\b`, 'i');
}

export const DEFAULT_TRIGGER = `@${ASSISTANT_NAME}`;

export function getTriggerPattern(trigger?: string): RegExp {
  const normalizedTrigger = trigger?.trim();
  return buildTriggerPattern(normalizedTrigger || DEFAULT_TRIGGER);
}

export const TRIGGER_PATTERN = buildTriggerPattern(DEFAULT_TRIGGER);

// Timezone for scheduled tasks, message formatting, etc.
// Validates each candidate is a real IANA identifier before accepting.
function resolveConfigTimezone(): string {
  const candidates = [
    process.env.TZ,
    envConfig.TZ,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  for (const tz of candidates) {
    if (tz && isValidTimezone(tz)) return tz;
  }
  return 'UTC';
}
export const TIMEZONE = resolveConfigTimezone();
