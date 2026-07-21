/**
 * Structural guard for the Google Calendar SDK wiring in the agent-runner.
 *
 * ConClaw has no per-group MCP registry — the `mcpServers` map and `allowedTools`
 * list are hardcoded in container/agent-runner/src/index.ts and passed to the
 * SDK's query(). Registering calendar means editing that object literal. It is
 * container-runner source (a different tsconfig, not built by the host `tsc`), so
 * a text guard is the red-on-drift signal: drop the `calendar` server or the
 * `mcp__calendar__*` allow-pattern and calendar tools silently stop working.
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

  it('allows the mcp__calendar__* tool pattern', () => {
    expect(text).toContain('mcp__calendar__*');
  });

  it('registers a calendar MCP server running google-calendar-mcp', () => {
    expect(text).toMatch(/calendar:\s*\{/);
    expect(text).toContain('google-calendar-mcp');
  });

  it('points the server at the mounted stub credentials', () => {
    expect(text).toContain('/workspace/extra/.calendar-mcp/credentials.json');
  });
});
