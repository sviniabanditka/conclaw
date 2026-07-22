/**
 * Skills the assistant writes for itself.
 *
 * The project root is mounted read-only into containers so an agent cannot
 * edit host code. These tests exist to make sure self-extension goes round
 * that wall rather than through it: nothing lands anywhere but the skills
 * directory, and nothing lands at all without the name having been validated
 * first.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  MAX_SKILL_BYTES,
  listProposals,
  markAnnounced,
  parseFrontmatter,
  promoteProposal,
  proposalsDir,
  rejectProposal,
  validateProposal,
} from './skill-proposals.js';

let root: string;
let groupDir: string;
let skillsDir: string;

const GOOD = `---
name: weather-jokes
description: Tell a joke about the weather.
---

# Weather jokes

Do the thing.
`;

function propose(name: string, content = GOOD, extra?: Record<string, string>) {
  const dir = path.join(proposalsDir(groupDir), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  for (const [file, body] of Object.entries(extra ?? {})) {
    fs.writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  groupDir = path.join(root, 'group');
  skillsDir = path.join(root, 'container', 'skills');
  fs.mkdirSync(groupDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('validateProposal', () => {
  it('accepts a well-formed skill', () => {
    expect(validateProposal('weather-jokes', GOOD)).toEqual({ ok: true });
  });

  // Refused rather than sanitised: a name that had to be cleaned up is not the
  // name the assistant meant, and quietly renaming it is worse than saying no.
  it('refuses names that could escape the skills directory', () => {
    for (const name of ['../evil', 'a/b', '..', '.hidden', 'Weather', 'a']) {
      expect(validateProposal(name, GOOD).ok, name).toBe(false);
    }
  });

  it('refuses a skill with no usable frontmatter', () => {
    expect(validateProposal('weather-jokes', '# Just a heading').ok).toBe(false);
    expect(
      validateProposal('weather-jokes', '---\nname: weather-jokes\n---\nhi').ok,
    ).toBe(false);
  });

  // The directory is what the loader keys on, so a mismatch means one of the
  // two is a typo and nothing can tell which.
  it('refuses when the frontmatter name disagrees with the folder', () => {
    const res = validateProposal('weather-jokes', GOOD.replace('weather-jokes', 'other'));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/не совпадает/);
  });

  it('refuses a skill too long for anyone to read before approving', () => {
    const huge = GOOD + 'x'.repeat(MAX_SKILL_BYTES);
    expect(validateProposal('weather-jokes', huge).ok).toBe(false);
  });
});

describe('parseFrontmatter', () => {
  it('reads the fields it needs', () => {
    expect(parseFrontmatter(GOOD)).toMatchObject({
      name: 'weather-jokes',
      description: 'Tell a joke about the weather.',
    });
  });

  it('is empty for a file with no frontmatter', () => {
    expect(parseFrontmatter('# hi')).toEqual({});
  });
});

describe('listProposals', () => {
  it('is empty when nothing was proposed', () => {
    expect(listProposals(groupDir, skillsDir)).toEqual([]);
  });

  it('lists a valid proposal with what it says it does', () => {
    propose('weather-jokes');
    const [p] = listProposals(groupDir, skillsDir);
    expect(p.name).toBe('weather-jokes');
    expect(p.description).toBe('Tell a joke about the weather.');
    expect(p.replaces).toBe(false);
    expect(p.announced).toBe(false);
  });

  // Half-written directories appear while the agent is still working.
  it('ignores a directory with no SKILL.md yet', () => {
    fs.mkdirSync(path.join(proposalsDir(groupDir), 'half-done'), { recursive: true });
    expect(listProposals(groupDir, skillsDir)).toEqual([]);
  });

  it('ignores a proposal that would not validate', () => {
    propose('weather-jokes', '# no frontmatter');
    expect(listProposals(groupDir, skillsDir)).toEqual([]);
  });

  // Approving it replaces a shipped skill, which the user must be told.
  it('flags a proposal that would replace an existing skill', () => {
    fs.mkdirSync(path.join(skillsDir, 'weather-jokes'), { recursive: true });
    propose('weather-jokes');
    expect(listProposals(groupDir, skillsDir)[0].replaces).toBe(true);
  });

  it('remembers that a proposal was already announced', () => {
    propose('weather-jokes');
    markAnnounced(listProposals(groupDir, skillsDir)[0]);
    expect(listProposals(groupDir, skillsDir)[0].announced).toBe(true);
  });
});

describe('promoteProposal', () => {
  it('moves the skill into the skills directory and clears the proposal', () => {
    propose('weather-jokes');
    expect(promoteProposal(groupDir, skillsDir, 'weather-jokes')).toEqual({
      promoted: true,
      replaced: false,
    });
    expect(
      fs.readFileSync(path.join(skillsDir, 'weather-jokes', 'SKILL.md'), 'utf-8'),
    ).toContain('Weather jokes');
    expect(fs.existsSync(path.join(proposalsDir(groupDir), 'weather-jokes'))).toBe(false);
  });

  it('brings bundled files along', () => {
    propose('weather-jokes', GOOD, { 'helper.sh': '#!/bin/sh\necho hi\n' });
    promoteProposal(groupDir, skillsDir, 'weather-jokes');
    expect(fs.existsSync(path.join(skillsDir, 'weather-jokes', 'helper.sh'))).toBe(true);
  });

  it('does not carry the announcement marker into the shipped skill', () => {
    propose('weather-jokes');
    markAnnounced(listProposals(groupDir, skillsDir)[0]);
    promoteProposal(groupDir, skillsDir, 'weather-jokes');
    expect(fs.readdirSync(path.join(skillsDir, 'weather-jokes'))).toEqual(['SKILL.md']);
  });

  it('replaces an existing skill and says that it did', () => {
    fs.mkdirSync(path.join(skillsDir, 'weather-jokes'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'weather-jokes', 'SKILL.md'), 'old');
    fs.writeFileSync(path.join(skillsDir, 'weather-jokes', 'stale.txt'), 'gone');
    propose('weather-jokes');

    expect(promoteProposal(groupDir, skillsDir, 'weather-jokes').replaced).toBe(true);
    // The old directory goes wholesale — a leftover file from the previous
    // version would be loaded alongside the new one.
    expect(fs.readdirSync(path.join(skillsDir, 'weather-jokes'))).toEqual(['SKILL.md']);
  });

  // The name is re-validated inside listProposals, so a crafted one never
  // reaches the copy at all.
  it('refuses a name that never validated', () => {
    const res = promoteProposal(groupDir, skillsDir, '../evil');
    expect(res.promoted).toBe(false);
    expect(fs.existsSync(path.join(root, 'container', 'evil'))).toBe(false);
  });

  it('refuses a proposal that is not there', () => {
    expect(promoteProposal(groupDir, skillsDir, 'weather-jokes').promoted).toBe(false);
  });
});

describe('rejectProposal', () => {
  it('deletes the proposal and leaves the skills alone', () => {
    propose('weather-jokes');
    expect(rejectProposal(groupDir, 'weather-jokes')).toBe(true);
    expect(fs.existsSync(path.join(proposalsDir(groupDir), 'weather-jokes'))).toBe(false);
    expect(fs.readdirSync(skillsDir)).toEqual([]);
  });

  it('refuses a name that could point outside the proposals directory', () => {
    expect(rejectProposal(groupDir, '../group')).toBe(false);
    expect(fs.existsSync(groupDir)).toBe(true);
  });

  it('reports when there was nothing to reject', () => {
    expect(rejectProposal(groupDir, 'weather-jokes')).toBe(false);
  });
});
