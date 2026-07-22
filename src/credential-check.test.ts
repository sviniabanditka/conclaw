/**
 * Proving the credential works, not that it exists.
 *
 * The distinction is the whole point. During the outage this was written for,
 * the gateway was up, the secret was listed, and its own logs said the
 * injection had been applied — while every reply failed with 401. The three
 * outcomes below have three different repairs and used to look identical.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  checkAnthropicCredential,
  type CredentialCheckDeps,
} from './credential-check.js';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CONFIG = {
  env: { HTTPS_PROXY: 'http://x:t@host.docker.internal:10255' },
  caCertificate: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
};

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function deps(over: Partial<CredentialCheckDeps> = {}): CredentialCheckDeps {
  return {
    getGatewayConfig: async () => CONFIG,
    tmpDir: tmpDir(),
    request: async () => '200',
    ...over,
  };
}

describe('checkAnthropicCredential', () => {
  it('passes when the gateway injects something the API accepts', async () => {
    expect(await checkAnthropicCredential(deps())).toEqual({ ok: true });
  });

  // The case that cost hours: reachable, answering, and rejected.
  it('separates a rejected credential from an unreachable gateway', async () => {
    const rejected = await checkAnthropicCredential(
      deps({ request: async () => '401' }),
    );
    expect(rejected).toMatchObject({ ok: false, reason: 'unauthorized' });
    if (!rejected.ok) expect(rejected.detail).toMatch(/rejected/);

    const unreachable = await checkAnthropicCredential(
      deps({ request: async () => '000' }),
    );
    expect(unreachable).toMatchObject({ ok: false, reason: 'gateway_unreachable' });
  });

  it('treats a forbidden response as a credential problem too', async () => {
    expect(await checkAnthropicCredential(deps({ request: async () => '403' }))).
      toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('reports the gateway being down separately from the API refusing', async () => {
    const res = await checkAnthropicCredential(
      deps({
        getGatewayConfig: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    );
    expect(res).toMatchObject({ ok: false, reason: 'gateway_unreachable' });
    if (!res.ok) expect(res.detail).toContain('ECONNREFUSED');
  });

  it('carries an unexpected status through rather than guessing', async () => {
    const res = await checkAnthropicCredential(deps({ request: async () => '502' }));
    expect(res).toMatchObject({ ok: false, reason: 'failed' });
    if (!res.ok) expect(res.detail).toContain('502');
  });

  // The gateway MITMs TLS, so the probe cannot verify without its certificate.
  it('writes the gateway CA where the request can read it', async () => {
    const dir = tmpDir();
    let seen: Record<string, string> = {};
    await checkAnthropicCredential({
      getGatewayConfig: async () => CONFIG,
      tmpDir: dir,
      request: async (_url, env) => {
        seen = env;
        return '200';
      },
    });
    const caPath = path.join(dir, 'onecli-host-ca.pem');
    expect(fs.readFileSync(caPath, 'utf-8')).toContain('BEGIN CERTIFICATE');
    expect(seen.CURL_CA_BUNDLE).toBe(caPath);
    // And the container-only host alias must have been translated.
    expect(seen.HTTPS_PROXY).toContain('127.0.0.1');
  });
});
