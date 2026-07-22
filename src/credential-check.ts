/**
 * Does the OneCLI gateway actually hand out a working credential?
 *
 * Every other check in setup asks whether something is *configured*. This one
 * asks whether it works, and it exists because of the outage that motivated it:
 * the gateway was up, the secret was listed, `injections_applied=1` appeared in
 * its own logs — and every agent reply failed with 401 for hours. Nothing in
 * the system could tell the difference between a credential that resolves and
 * one that merely exists.
 *
 * The probe is `GET /v1/models`: authenticated, so it proves injection end to
 * end, and free, so it can be run whenever without thinking about cost.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import { hostProxyEnv, type GatewayConfig } from './calendar-refresh.js';

export type CredentialProbe =
  | { ok: true }
  | {
      ok: false;
      reason: 'gateway_unreachable' | 'unauthorized' | 'failed';
      detail: string;
    };

export interface CredentialCheckDeps {
  getGatewayConfig: () => Promise<GatewayConfig>;
  tmpDir: string;
  /** Returns the HTTP status as a string, or '000' when nothing answered. */
  request?: (url: string, env: Record<string, string>) => Promise<string>;
}

function defaultRequest(
  url: string,
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'curl',
      [
        '-s', '-o', '/dev/null',
        '-w', '%{http_code}',
        '--max-time', '20',
        '-H', 'anthropic-version: 2023-06-01',
        url,
      ],
      { env: { ...process.env, ...env }, timeout: 25_000 },
      (err, stdout) => resolve(err ? '000' : String(stdout).trim()),
    );
  });
}

/**
 * Ask the gateway for a credential and use it.
 *
 * A 401 here is the interesting answer: it means the gateway is reachable and
 * answered, and what it injected is not accepted — which is a different repair
 * from the gateway being down, and the two were indistinguishable before.
 */
export async function checkAnthropicCredential(
  deps: CredentialCheckDeps,
): Promise<CredentialProbe> {
  let config: GatewayConfig;
  try {
    config = await deps.getGatewayConfig();
  } catch (err) {
    return {
      ok: false,
      reason: 'gateway_unreachable',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const caPath = path.join(deps.tmpDir, 'onecli-host-ca.pem');
  try {
    fs.mkdirSync(deps.tmpDir, { recursive: true });
    fs.writeFileSync(caPath, config.caCertificate);
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      detail: `cannot write CA: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const request = deps.request ?? defaultRequest;
  const status = await request(
    'https://api.anthropic.com/v1/models',
    hostProxyEnv(config, caPath),
  );

  if (status === '200') return { ok: true };
  if (status === '401' || status === '403') {
    return {
      ok: false,
      reason: 'unauthorized',
      detail: `gateway answered but the credential was rejected (HTTP ${status})`,
    };
  }
  if (status === '000') {
    return {
      ok: false,
      reason: 'gateway_unreachable',
      detail: 'no response through the proxy',
    };
  }
  return { ok: false, reason: 'failed', detail: `HTTP ${status}` };
}
