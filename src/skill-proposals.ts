/**
 * Skills the assistant wrote for itself, pending approval.
 *
 * The project root is mounted into agent containers read-only on purpose: an
 * agent that can edit host application code has escaped the sandbox by the
 * next restart. Self-extension must not chip at that, so it goes the long way
 * round — the agent writes a *proposal* into its own group folder, which is
 * writable, and the orchestrator promotes it into `container/skills/` only
 * after the user says yes.
 *
 * A skill is prose, not code, so nothing here executes. But it is prose that
 * instructs an agent holding a shell, which makes it about as consequential as
 * CLAUDE.md — hence the name check, the size cap, and the rule that the user
 * sees it before it takes effect.
 */
import fs from 'fs';
import path from 'path';

/**
 * Long enough to be descriptive, short enough that `sk:<name>` fits Telegram's
 * 64-byte callback payload with room to spare.
 */
const NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}$/;

/** A skill longer than this is a manual, and nobody will read it to approve it. */
export const MAX_SKILL_BYTES = 40 * 1024;

/** Written into a proposal once announced, so a restart does not re-announce it. */
const ANNOUNCED_MARKER = '.announced';

export interface SkillProposal {
  name: string;
  dir: string;
  /** From the SKILL.md frontmatter — what the assistant says it is for. */
  description: string;
  bytes: number;
  /** True when a skill of this name already ships; approving replaces it. */
  replaces: boolean;
  announced: boolean;
}

export function proposalsDir(groupDir: string): string {
  return path.join(groupDir, 'proposed-skills');
}

/** Read `name:` and `description:` out of the YAML frontmatter. */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Check a proposal before it is ever shown, let alone promoted.
 *
 * The name is checked against a pattern rather than sanitised: a name that had
 * to be cleaned up is a name the assistant did not mean, and quietly renaming
 * someone's skill is worse than refusing it.
 */
export function validateProposal(
  name: string,
  content: string,
): ValidationResult {
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      reason: 'имя должно быть вида my-skill — строчные латинские, цифры, дефис',
    };
  }
  if (Buffer.byteLength(content) > MAX_SKILL_BYTES) {
    return { ok: false, reason: `SKILL.md больше ${MAX_SKILL_BYTES / 1024} КБ` };
  }
  const fm = parseFrontmatter(content);
  if (!fm.name || !fm.description) {
    return { ok: false, reason: 'во frontmatter нужны name и description' };
  }
  if (fm.name !== name) {
    // The directory is what the loader keys on; a mismatch means one of the
    // two is a typo and there is no way to tell which.
    return {
      ok: false,
      reason: `name во frontmatter (${fm.name}) не совпадает с папкой (${name})`,
    };
  }
  return { ok: true };
}

/** Proposals sitting in a group's folder, newest first. */
export function listProposals(
  groupDir: string,
  skillsDir: string,
): SkillProposal[] {
  const dir = proposalsDir(groupDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const out: SkillProposal[] = [];
  for (const name of names) {
    const proposalDir = path.join(dir, name);
    const skillFile = path.join(proposalDir, 'SKILL.md');
    let content: string;
    try {
      if (!fs.statSync(proposalDir).isDirectory()) continue;
      content = fs.readFileSync(skillFile, 'utf-8');
    } catch {
      // A directory with no SKILL.md is half-written, not a proposal yet.
      continue;
    }
    if (!validateProposal(name, content).ok) continue;

    out.push({
      name,
      dir: proposalDir,
      description: parseFrontmatter(content).description ?? '',
      bytes: Buffer.byteLength(content),
      replaces: fs.existsSync(path.join(skillsDir, name)),
      announced: fs.existsSync(path.join(proposalDir, ANNOUNCED_MARKER)),
    });
  }
  return out;
}

export function markAnnounced(proposal: SkillProposal): void {
  fs.writeFileSync(path.join(proposal.dir, ANNOUNCED_MARKER), '');
}

export interface PromoteResult {
  promoted: boolean;
  reason?: string;
  replaced?: boolean;
}

/**
 * Move an approved proposal into the shipped skills directory.
 *
 * Copies the whole proposal directory, so a skill that brings a script or a
 * template along keeps it. The destination is rebuilt from the skills root and
 * the validated name, never from anything in the proposal, so there is no path
 * for a crafted name to write outside it.
 */
export function promoteProposal(
  groupDir: string,
  skillsDir: string,
  name: string,
): PromoteResult {
  const proposal = listProposals(groupDir, skillsDir).find((p) => p.name === name);
  if (!proposal) return { promoted: false, reason: 'предложение не найдено' };

  const dest = path.join(skillsDir, name);
  if (!dest.startsWith(skillsDir + path.sep)) {
    return { promoted: false, reason: 'некорректное имя' };
  }

  const replaced = proposal.replaces;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(proposal.dir, dest, {
    recursive: true,
    filter: (src) => path.basename(src) !== ANNOUNCED_MARKER,
  });
  fs.rmSync(proposal.dir, { recursive: true, force: true });
  return { promoted: true, replaced };
}

export function rejectProposal(groupDir: string, name: string): boolean {
  if (!NAME_PATTERN.test(name)) return false;
  const dir = path.join(proposalsDir(groupDir), name);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export interface InstalledSkill {
  name: string;
  description: string;
}

/** Skills currently shipped to containers, so the app can show what exists. */
export function listSkills(skillsDir: string): InstalledSkill[] {
  let names: string[];
  try {
    names = fs.readdirSync(skillsDir);
  } catch {
    return [];
  }
  const out: InstalledSkill[] = [];
  for (const name of names.sort()) {
    try {
      const content = fs.readFileSync(
        path.join(skillsDir, name, 'SKILL.md'),
        'utf-8',
      );
      out.push({ name, description: parseFrontmatter(content).description ?? '' });
    } catch {
      // A directory without a SKILL.md is not a skill the loader will see.
    }
  }
  return out;
}

/** The full text of a proposal, for reading before approving it. */
export function readProposal(groupDir: string, name: string): string | null {
  if (!NAME_PATTERN.test(name)) return null;
  try {
    return fs.readFileSync(
      path.join(proposalsDir(groupDir), name, 'SKILL.md'),
      'utf-8',
    );
  } catch {
    return null;
  }
}
