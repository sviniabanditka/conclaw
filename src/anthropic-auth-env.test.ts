/**
 * The whole point of this module is that a *present* `ANTHROPIC_API_KEY` is
 * fatal for api.anthropic.com. So the tests care about two things: it is gone,
 * and something is left in its place — dropping it without a replacement
 * leaves the CLI unable to log in at all.
 */
import { describe, it, expect } from 'vitest';

import { useOAuthPlaceholder } from './anthropic-auth-env.js';

describe('useOAuthPlaceholder', () => {
  it('removes the API-key placeholder and its flag together', () => {
    const got = useOAuthPlaceholder([
      'run',
      '-e',
      'ANTHROPIC_API_KEY=placeholder',
      '-e',
      'TZ=Europe/Kyiv',
    ]);
    expect(got).not.toContain('ANTHROPIC_API_KEY=placeholder');
    // The flag must go with the value, or docker reads `TZ=...` as the -e arg
    // and the timezone silently vanishes.
    expect(got).toEqual([
      'run',
      '-e',
      'TZ=Europe/Kyiv',
      '-e',
      'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
    ]);
  });

  it('adds the OAuth placeholder even when there was no API key to remove', () => {
    expect(useOAuthPlaceholder(['run'])).toEqual([
      'run',
      '-e',
      'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
    ]);
  });

  it('handles the long --env form', () => {
    const got = useOAuthPlaceholder(['--env', 'ANTHROPIC_API_KEY=x', 'img']);
    expect(got).toEqual([
      'img',
      '-e',
      'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
    ]);
  });

  // Overwriting a token someone set on purpose would be a worse bug than the
  // one this fixes.
  it('leaves an existing OAuth token alone', () => {
    const got = useOAuthPlaceholder([
      '-e',
      'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-real',
      '-e',
      'ANTHROPIC_API_KEY=placeholder',
    ]);
    expect(got).toEqual(['-e', 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-real']);
  });

  it('does not touch variables that merely start similarly', () => {
    const got = useOAuthPlaceholder(['-e', 'ANTHROPIC_API_KEY_FILE=/x']);
    expect(got).toContain('ANTHROPIC_API_KEY_FILE=/x');
  });

  it('ignores a value that is not preceded by an env flag', () => {
    // e.g. a volume path that happens to contain the string
    const got = useOAuthPlaceholder(['-v', 'ANTHROPIC_API_KEY=/tmp/x']);
    expect(got).toContain('ANTHROPIC_API_KEY=/tmp/x');
  });
});
