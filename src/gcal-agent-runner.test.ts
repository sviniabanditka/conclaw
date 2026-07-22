/**
 * Structural guard for the Google Calendar SDK wiring in the agent-runner.
 *
 * ConClaw has no per-group MCP registry — the `mcpServers` map and `allowedTools`
 * list are hardcoded in container/agent-runner/src/index.ts and passed to the
 * SDK's query(). Registering calendar means editing that object literal. It is
 * container-runner source (a different tsconfig, not built by the host `tsc`), so
 * a text guard is the red-on-drift signal: drop the `calendar` server or the
 * read-only allow-list and calendar tools silently stop working — or, worse,
 * a wildcard creeps back in and hands the agent write access.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

function agentRunner(): string {
  const p = path.resolve(
    process.cwd(),
    'container/agent-runner/src/index.ts',
  );
  return fs.readFileSync(p, 'utf8');
}

describe('agent-runner wires the Google Calendar MCP server', () => {
  const text = agentRunner();

  it('allows only read-only calendar tools', () => {
    for (const tool of [
      'mcp__calendar__list-calendars',
      'mcp__calendar__list-events',
      'mcp__calendar__get-event',
    ]) {
      expect(text).toContain(tool);
    }
  });

  // `mcp__calendar__*` would also grant create-event, update-event and
  // delete-event. A wrong answer is a nuisance; a deleted meeting is damage
  // other people notice and the agent cannot undo.
  it('never grants calendar write access', () => {
    const allowed = text.slice(
      text.indexOf('allowedTools'),
      text.indexOf('env: sdkEnv'),
    );
    expect(allowed).not.toMatch(/mcp__calendar__\*/);
    for (const tool of ['create-event', 'update-event', 'delete-event']) {
      expect(allowed).not.toContain(`mcp__calendar__${tool}`);
    }
  });

  // The wiring ships on main, so it has to stay silent where nobody asked for
  // a calendar: registering a stdio server whose credentials are not mounted
  // starts a process that fails and logs on every container start.
  it('registers the server only when the stub credentials are mounted', () => {
    expect(text).toMatch(/existsSync\(CALENDAR_CREDENTIALS\)/);
    expect(text).toContain('...calendarMcpServer()');
  });

  it('registers a calendar MCP server running google-calendar-mcp', () => {
    expect(text).toMatch(/calendar:\s*\{/);
    expect(text).toContain('google-calendar-mcp');
  });

  it('points the server at the mounted stub credentials', () => {
    expect(text).toContain('/workspace/extra/.calendar-mcp/credentials.json');
  });

  // MCP stdio children inherit only a safe-list (HOME, PATH, SHELL, ...) that
  // excludes every var OneCLI needs to intercept googleapis.com. Without an
  // explicit forward the stub token reaches Google directly and 401s, so the
  // passthrough is load-bearing, not decoration.
  it('forwards the OneCLI proxy/TLS env to the calendar server', () => {
    expect(text).toContain('...onecliProxyEnv()');
    for (const key of ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) {
      expect(text).toContain(key);
    }
  });
});
