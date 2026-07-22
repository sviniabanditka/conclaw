/**
 * The two translations that let a container's gateway config work on the host.
 * Both are invisible when wrong: the request simply fails to connect, or fails
 * to verify, and the cache silently stops updating.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CalendarRefresher,
  hostProxyEnv,
  type CalendarRefreshDeps,
} from './calendar-refresh.js';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CONFIG = {
  env: {
    HTTPS_PROXY: 'http://x:token@host.docker.internal:10255',
    https_proxy: 'http://x:token@host.docker.internal:10255',
    NODE_EXTRA_CA_CERTS: '/tmp/onecli-gateway-ca.pem',
    NODE_USE_ENV_PROXY: '1',
    ANTHROPIC_API_KEY: 'placeholder',
  },
  caCertificate: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
};

describe('hostProxyEnv', () => {
  // docker adds a host mapping for this name; nothing does on the host.
  it('points the proxy at loopback instead of the docker host alias', () => {
    const env = hostProxyEnv(CONFIG, '/tmp/ca.pem');
    expect(env.HTTPS_PROXY).toBe('http://x:token@127.0.0.1:10255');
    expect(env.https_proxy).toBe('http://x:token@127.0.0.1:10255');
    expect(env.HTTPS_PROXY).not.toContain('host.docker.internal');
  });

  it('keeps the proxy credentials intact', () => {
    expect(hostProxyEnv(CONFIG, '/tmp/ca.pem').HTTPS_PROXY).toContain('x:token@');
  });

  // The gateway MITMs TLS, so without its CA every request fails to verify.
  it('points every CA variable at the host copy', () => {
    const env = hostProxyEnv(CONFIG, '/host/ca.pem');
    expect(env.CURL_CA_BUNDLE).toBe('/host/ca.pem');
    expect(env.SSL_CERT_FILE).toBe('/host/ca.pem');
    // The container path would silently not exist here.
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/host/ca.pem');
  });

  it('carries other gateway variables through untouched', () => {
    expect(hostProxyEnv(CONFIG, '/tmp/ca.pem').NODE_USE_ENV_PROXY).toBe('1');
  });

  // It exists to make in-container tools believe they are authenticated;
  // on the host it is a fake credential in a shell that has no use for one.
  it('drops the placeholder API key', () => {
    expect(hostProxyEnv(CONFIG, '/tmp/ca.pem').ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('CalendarRefresher', () => {
  function setup(over: Partial<CalendarRefreshDeps> = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-'));
    const run = vi.fn<NonNullable<CalendarRefreshDeps['run']>>(async () => {});
    const refresher = new CalendarRefresher({
      scriptPath: '/opt/refresh.sh',
      outputPath: '/groups/main/calendar_events.json',
      tmpDir,
      getGatewayConfig: async () => CONFIG,
      intervalMs: 60_000,
      run,
      ...over,
    });
    return { refresher, run, tmpDir };
  }

  it('writes the CA where the script can read it', async () => {
    const { refresher, tmpDir } = setup();
    await refresher.refresh();
    const ca = fs.readFileSync(path.join(tmpDir, 'onecli-host-ca.pem'), 'utf-8');
    expect(ca).toContain('BEGIN CERTIFICATE');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Without this the script writes to its container default, which on the host
  // is a path in no group at all.
  it('tells the script where the group cache lives', async () => {
    const { refresher, run, tmpDir } = setup();
    await refresher.refresh();
    const env = run.mock.calls[0][1];
    expect(env.CALENDAR_CACHE_OUT).toBe('/groups/main/calendar_events.json');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs the script it was given', async () => {
    const { refresher, run, tmpDir } = setup();
    await refresher.refresh();
    expect(run.mock.calls[0][0]).toBe('/opt/refresh.sh');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // A refresh that throws must not take the orchestrator down with it.
  it('survives a failing refresh and keeps the timer', async () => {
    const { refresher, tmpDir } = setup({
      run: vi.fn(async () => {
        throw new Error('HTTP 500');
      }),
    });
    expect(() => refresher.start()).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    refresher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
