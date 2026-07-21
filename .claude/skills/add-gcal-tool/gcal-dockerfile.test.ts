/**
 * Dependency guard for the Google Calendar MCP server in the container image.
 *
 * `@cocal/google-calendar-mcp` is a stdio CLI installed globally in the image,
 * not an imported module, so `tsc` and the runtime tests never reference it —
 * only the Dockerfile edit proves it is present. Structural guard: assert the
 * pinned ARG and the npm global-install line both exist. Drop either and the
 * container starts without the `google-calendar-mcp` binary; nothing else fails,
 * so this test is the only red-on-drift signal.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

function dockerfile(): string {
  const p = path.resolve(process.cwd(), 'container/Dockerfile');
  return fs.readFileSync(p, 'utf8');
}

describe('container/Dockerfile installs @cocal/google-calendar-mcp', () => {
  const text = dockerfile();

  it('pins the version via an ARG', () => {
    expect(text).toMatch(/^\s*ARG\s+CALENDAR_MCP_VERSION=/m);
  });

  it('installs the package pinned to that ARG via npm -g', () => {
    const installs =
      /npm\s+install\s+-g[\s\S]*?@cocal\/google-calendar-mcp@\$\{CALENDAR_MCP_VERSION\}/.test(
        text,
      );
    expect(installs).toBe(true);
  });
});
