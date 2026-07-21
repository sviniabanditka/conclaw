/**
 * These tests are the security boundary for a page on the public internet, so
 * they lean on the negative cases: a signature that does not match, a payload
 * that is old, and — the one a signature check alone would let through — a
 * genuine Telegram user who simply is not you.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

import {
  verifyInitData,
  parseAllowedUserIds,
  DEFAULT_MAX_AGE_SECONDS,
} from './auth.js';

const TOKEN = '123456:test-bot-token';
const OWNER = 555001;
const NOW = 1_800_000_000_000; // ms
const now = () => NOW;

/** Build initData exactly the way Telegram does, so the test signs for real. */
function signed(
  fields: Record<string, string>,
  token: string = TOKEN,
): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function initDataFor(
  userId = OWNER,
  authDate = Math.floor(NOW / 1000),
  token = TOKEN,
): string {
  return signed(
    {
      auth_date: String(authDate),
      query_id: 'AAdummy',
      user: JSON.stringify({ id: userId, first_name: 'Test' }),
    },
    token,
  );
}

const opts = (over: Partial<Parameters<typeof verifyInitData>[2]> = {}) => ({
  allowedUserIds: [OWNER],
  now,
  ...over,
});

describe('verifyInitData', () => {
  it('accepts a correctly signed payload from an allowed user', () => {
    const res = verifyInitData(initDataFor(), TOKEN, opts());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.user.id).toBe(OWNER);
  });

  it('rejects a payload signed with a different bot token', () => {
    const res = verifyInitData(initDataFor(OWNER, undefined, 'other:token'), TOKEN, opts());
    expect(res).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('rejects a payload whose fields were edited after signing', () => {
    const original = new URLSearchParams(initDataFor());
    original.set('user', JSON.stringify({ id: OWNER, first_name: 'Edited' }));
    const res = verifyInitData(original.toString(), TOKEN, opts());
    expect(res).toEqual({ ok: false, reason: 'bad signature' });
  });

  // The case a signature check alone cannot catch: the signature is genuinely
  // Telegram's, it just belongs to somebody else who opened the link.
  it('rejects a validly signed payload from a user who is not allowed', () => {
    const res = verifyInitData(initDataFor(999999), TOKEN, opts());
    expect(res).toEqual({ ok: false, reason: 'user not allowed' });
  });

  // An unset allowlist must not read as "everyone".
  it('denies everyone when the allowlist is empty', () => {
    const res = verifyInitData(initDataFor(), TOKEN, opts({ allowedUserIds: [] }));
    expect(res.ok).toBe(false);
  });

  it('refuses to verify anything without a bot token', () => {
    const res = verifyInitData(initDataFor(), '', opts());
    expect(res.ok).toBe(false);
  });

  it('rejects a payload older than the max age', () => {
    const stale = Math.floor(NOW / 1000) - DEFAULT_MAX_AGE_SECONDS - 1;
    const res = verifyInitData(initDataFor(OWNER, stale), TOKEN, opts());
    expect(res).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a payload just inside the max age', () => {
    const old = Math.floor(NOW / 1000) - DEFAULT_MAX_AGE_SECONDS + 10;
    expect(verifyInitData(initDataFor(OWNER, old), TOKEN, opts()).ok).toBe(true);
  });

  it('rejects a payload dated in the future beyond clock skew', () => {
    const ahead = Math.floor(NOW / 1000) + 3600;
    const res = verifyInitData(initDataFor(OWNER, ahead), TOKEN, opts());
    expect(res).toEqual({ ok: false, reason: 'auth_date in the future' });
  });

  it('tolerates a small clock skew', () => {
    const ahead = Math.floor(NOW / 1000) + 30;
    expect(verifyInitData(initDataFor(OWNER, ahead), TOKEN, opts()).ok).toBe(true);
  });

  it('rejects an empty or absent initData', () => {
    expect(verifyInitData('', TOKEN, opts()).ok).toBe(false);
    expect(verifyInitData('hash=', TOKEN, opts()).ok).toBe(false);
  });

  it('rejects a payload with no hash at all', () => {
    const res = verifyInitData('auth_date=1&user=%7B%7D', TOKEN, opts());
    expect(res).toEqual({ ok: false, reason: 'missing hash' });
  });

  it('rejects a hash that is not hex of the right length', () => {
    const params = new URLSearchParams(initDataFor());
    params.set('hash', 'abcd');
    expect(verifyInitData(params.toString(), TOKEN, opts()).ok).toBe(false);
  });

  it('rejects a signed payload carrying no user', () => {
    const res = verifyInitData(
      signed({ auth_date: String(Math.floor(NOW / 1000)) }),
      TOKEN,
      opts(),
    );
    expect(res).toEqual({ ok: false, reason: 'missing user' });
  });

  it('rejects a signed payload whose user is not parseable', () => {
    const res = verifyInitData(
      signed({ auth_date: String(Math.floor(NOW / 1000)), user: 'not-json' }),
      TOKEN,
      opts(),
    );
    expect(res).toEqual({ ok: false, reason: 'malformed user' });
  });

  // Telegram percent-encodes the user JSON; the check string uses decoded
  // values, so a decoding slip would break every real request.
  it('handles fields needing percent-encoding', () => {
    const data = signed({
      auth_date: String(Math.floor(NOW / 1000)),
      user: JSON.stringify({ id: OWNER, first_name: 'Ан дрей & Co' }),
    });
    expect(verifyInitData(data, TOKEN, opts()).ok).toBe(true);
  });
});

describe('parseAllowedUserIds', () => {
  it('parses a comma-separated list', () => {
    expect(parseAllowedUserIds('111, 222,333')).toEqual([111, 222, 333]);
  });

  it('is empty for empty or junk input, rather than permissive', () => {
    expect(parseAllowedUserIds('')).toEqual([]);
    expect(parseAllowedUserIds('abc, ,-1, 0')).toEqual([]);
  });
});
