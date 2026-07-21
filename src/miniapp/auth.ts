/**
 * Verifying that a Mini App request really came from Telegram, from you.
 *
 * The Mini App is served over the public internet — anyone who learns the URL
 * can open it. Everything that keeps it yours happens in this file, so it is
 * written to fail closed at every branch.
 *
 * Telegram hands the page an `initData` string signed with a key derived from
 * the bot token. Recomputing that signature proves the payload came from
 * Telegram and was not edited. It does **not** prove who sent it: any Telegram
 * user opening the app gets an equally valid signature for their own id. So a
 * valid signature is only half the check — the id it carries must also be on
 * the allowlist. Skipping that would hand the whole task list and link archive
 * to whoever found the link.
 *
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import crypto from 'crypto';

/** Telegram's own recommendation. Long, because initData is issued once at load. */
export const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export type VerifyResult =
  | { ok: true; user: InitDataUser; authDate: number }
  | { ok: false; reason: string };

export interface VerifyOptions {
  /** Telegram user ids permitted to use the app. Empty denies everyone. */
  allowedUserIds: number[];
  now?: () => number;
  maxAgeSeconds?: number;
}

/**
 * Check an `initData` string. Returns the user only when the signature is
 * Telegram's, the payload is fresh, and the user is allowed.
 *
 * The failure reasons are deliberately coarse — they go to the log, never to
 * the client, so a prober learns nothing about which half of the check failed.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts: VerifyOptions,
): VerifyResult {
  if (!botToken) return { ok: false, reason: 'no bot token configured' };

  // An empty allowlist is a misconfiguration, not permission for everyone.
  // Checked before the signature so it cannot be missed on the happy path.
  if (opts.allowedUserIds.length === 0) {
    return { ok: false, reason: 'no allowed users configured' };
  }

  if (!initData) return { ok: false, reason: 'missing initData' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed initData' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing hash' };

  // Every field except `hash` itself, "key=value" lines sorted by key.
  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  const dataCheckString = pairs.sort().join('\n');

  // Note the inversion: "WebAppData" is the HMAC *key* and the bot token is the
  // message. Swapping them yields a plausible-looking digest that never matches.
  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const expected = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  if (!timingSafeEqualHex(hash, expected)) {
    return { ok: false, reason: 'bad signature' };
  }

  // Only past the signature check is anything in the payload trustworthy.
  const authDate = parseInt(params.get('auth_date') || '', 10);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: 'missing auth_date' };
  }
  const nowSeconds = Math.floor((opts.now ?? Date.now)() / 1000);
  const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (nowSeconds - authDate > maxAge) {
    return { ok: false, reason: 'expired' };
  }
  // A payload dated in the future means a clock problem or a replay attempt.
  // Allow a minute of skew, reject beyond it.
  if (authDate - nowSeconds > 60) {
    return { ok: false, reason: 'auth_date in the future' };
  }

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'missing user' };
  let user: InitDataUser;
  try {
    user = JSON.parse(rawUser) as InitDataUser;
  } catch {
    return { ok: false, reason: 'malformed user' };
  }
  if (typeof user?.id !== 'number') return { ok: false, reason: 'missing user id' };

  if (!opts.allowedUserIds.includes(user.id)) {
    return { ok: false, reason: 'user not allowed' };
  }

  return { ok: true, user, authDate };
}

/** Constant-time compare of two hex digests, tolerant of length mismatch. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  // timingSafeEqual throws on differing lengths; a length mismatch is already
  // a definitive mismatch, so there is nothing to leak by returning early.
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Parse `MINIAPP_ALLOWED_USER_IDS` — comma-separated Telegram numeric ids. */
export function parseAllowedUserIds(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}
