/**
 * Keeping the calendar cache fresh, from the host.
 *
 * This used to be a scheduled task with `kind: agent`, which spawned a
 * container every fifteen minutes to run a shell script — about fifty container
 * starts a day to make one HTTPS request. The model never ran, so it cost no
 * tokens, but it cost a docker run and a TypeScript compile each time for
 * nothing.
 *
 * The only reason it lived in a container was the credential: the OneCLI
 * gateway injects the OAuth token into outbound HTTPS, and containers are what
 * the gateway is set up for. But the gateway is an ordinary authenticated
 * proxy, and the host can use it too — given two fixes, which is what this
 * module is for:
 *
 *  - the proxy URL names `host.docker.internal`, which only resolves inside a
 *    container (docker adds a host mapping); from the host it is loopback.
 *  - the CA path points inside the container, so the certificate has to be
 *    written somewhere the host can read.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

export interface GatewayConfig {
  env: Record<string, string>;
  caCertificate: string;
}

/**
 * Turn the gateway's container environment into one that works on the host.
 *
 * `ANTHROPIC_API_KEY=placeholder` is dropped: it exists so tools inside a
 * container believe they are authenticated, and here it would only leak a
 * fake credential into a shell that has no use for one.
 */
export function hostProxyEnv(
  config: GatewayConfig,
  caPath: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.env)) {
    if (key === 'ANTHROPIC_API_KEY') continue;
    out[key] = value.replace('host.docker.internal', '127.0.0.1');
  }
  // curl and node each look at a different variable, and the script uses both.
  out.CURL_CA_BUNDLE = caPath;
  out.SSL_CERT_FILE = caPath;
  out.NODE_EXTRA_CA_CERTS = caPath;
  return out;
}

export interface CalendarRefreshDeps {
  /** Absolute path to refresh-calendar-cache.sh. */
  scriptPath: string;
  /** Where the cache file for the group lives, on the host. */
  outputPath: string;
  /** Directory to keep the gateway CA in. */
  tmpDir: string;
  getGatewayConfig: () => Promise<GatewayConfig>;
  intervalMs: number;
  run?: (script: string, env: Record<string, string>) => Promise<void>;
}

function defaultRun(
  script: string,
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(script, [], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`exit ${code}: ${stderr.trim().slice(0, 200)}`)),
    );
  });
}

/**
 * Refreshes the cache on a timer. A failure is logged and the next tick tries
 * again — the script leaves the existing cache in place when the fetch fails,
 * so a stale cache still produces correct reminders for events already in it.
 */
export class CalendarRefresher {
  private deps: CalendarRefreshDeps;
  private timer?: NodeJS.Timeout;

  constructor(deps: CalendarRefreshDeps) {
    this.deps = deps;
  }

  async refresh(): Promise<void> {
    const config = await this.deps.getGatewayConfig();
    const caPath = path.join(this.deps.tmpDir, 'onecli-host-ca.pem');
    fs.mkdirSync(this.deps.tmpDir, { recursive: true });
    fs.writeFileSync(caPath, config.caCertificate);

    const env = hostProxyEnv(config, caPath);
    env.CALENDAR_CACHE_OUT = this.deps.outputPath;
    await (this.deps.run ?? defaultRun)(this.deps.scriptPath, env);
  }

  start(): void {
    const tick = () => {
      this.refresh().then(
        () => logger.debug('Calendar cache refreshed'),
        (err) => logger.warn({ err: String(err) }, 'Calendar cache refresh failed'),
      );
    };
    tick();
    this.timer = setInterval(tick, this.deps.intervalMs);
    this.timer.unref?.();
    logger.info(
      { intervalMs: this.deps.intervalMs },
      'Calendar cache refresher started',
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
