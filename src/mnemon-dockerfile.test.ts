/**
 * Structural guard for the mnemon reach-ins into container/Dockerfile.
 *
 * mnemon ships as a GitHub-release binary (not an npm package), and ConClaw's
 * container entrypoint is generated inline by a `printf` in the Dockerfile — so
 * neither reach-in is importable or typed. A single Dockerfile read covers both:
 * the install layer (ARG + release download + MNEMON_DATA_DIR) and the entrypoint
 * `mnemon setup` line. Drop the install on an upgrade and the container starts
 * with "mnemon: command not found"; drop the setup line and the memory hooks
 * silently never register. Either regression turns this red.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

function dockerfile(): string {
  const p = path.resolve(process.cwd(), 'container/Dockerfile');
  return fs.readFileSync(p, 'utf8');
}

describe('container/Dockerfile installs and wires mnemon', () => {
  const text = dockerfile();

  it('declares the MNEMON_VERSION build arg', () => {
    expect(text).toMatch(/ARG\s+MNEMON_VERSION/);
  });

  it('downloads the mnemon release binary', () => {
    expect(text).toContain('mnemon-dev/mnemon/releases/download');
  });

  it('sets MNEMON_DATA_DIR into the .claude mount', () => {
    expect(text).toMatch(/ENV\s+MNEMON_DATA_DIR=\/home\/node\/\.claude/);
  });

  it('runs mnemon setup in the printf entrypoint', () => {
    expect(text).toMatch(/mnemon\s+setup\s+--target\s+claude-code/);
  });

  // The entrypoint runs under `set -e`, and mnemon setup sits before the `cat`
  // that reads the handshake JSON. Without a fallback, any setup failure kills
  // the container before it ever reads stdin — the agent stops answering at all
  // rather than merely losing memory. Deliberate deviation from the skill.
  // Memory is on by default, but an install that does not want it should not
  // have to edit the image to say so.
  it('can be switched off without rebuilding', () => {
    expect(dockerfile()).toContain('MNEMON_DISABLED');
  });

  it('degrades gracefully when mnemon setup fails', () => {
    expect(text).toMatch(/mnemon setup --target claude-code[^\\]*\|\|/);
  });
});
