/**
 * Fix up the credential env OneCLI hands to agent containers.
 *
 * OneCLI's `applyContainerConfig` sets `ANTHROPIC_API_KEY=placeholder` so that
 * tools believe they are authenticated and actually send a request, which the
 * gateway then injects the real credential into. For every other host that
 * works. For api.anthropic.com it backfires: Claude Code turns that variable
 * into an `x-api-key` header, and Anthropic rejects any request carrying
 * `x-api-key` — 401 — even when a valid `Authorization: Bearer <oauth token>`
 * is present alongside it. The gateway injects into `Authorization`, so the
 * placeholder is not merely useless here, it is what breaks the request.
 *
 * Verified against the live API, identical request otherwise:
 *
 *   x-api-key absent   → 200
 *   x-api-key present  → 401
 *
 * Dropping it alone is not enough — with no credential variable at all the CLI
 * never attempts the call ("Not logged in · Please run /login"). So we swap in
 * the OAuth-shaped equivalent: `CLAUDE_CODE_OAUTH_TOKEN=placeholder` makes the
 * CLI send `Authorization: Bearer placeholder`, which is exactly the header the
 * gateway replaces. The container still holds no real secret.
 */

const API_KEY_VAR = 'ANTHROPIC_API_KEY';
const OAUTH_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';

/**
 * Replace OneCLI's `ANTHROPIC_API_KEY` placeholder with an OAuth-shaped one.
 *
 * Takes the docker `run` argument list as built so far and returns a new one.
 * A pre-existing `CLAUDE_CODE_OAUTH_TOKEN` is left alone — if something
 * upstream set a real token deliberately, overwriting it would be worse than
 * the bug this fixes.
 */
export function useOAuthPlaceholder(args: string[]): string[] {
  const out: string[] = [];
  let sawOAuthVar = false;

  for (let i = 0; i < args.length; i++) {
    const isEnvFlag = args[i] === '-e' || args[i] === '--env';
    const value = args[i + 1];

    if (isEnvFlag && typeof value === 'string') {
      if (value.startsWith(`${API_KEY_VAR}=`)) {
        i++; // drop the flag and its value together
        continue;
      }
      if (value.startsWith(`${OAUTH_VAR}=`)) sawOAuthVar = true;
    }

    out.push(args[i]);
  }

  if (!sawOAuthVar) out.push('-e', `${OAUTH_VAR}=placeholder`);
  return out;
}
