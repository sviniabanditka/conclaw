/**
 * Rules learned from mistakes.
 *
 * Everything here guards one property: the file can only grow in ways someone
 * chose. Every rule is loaded on every turn, so an unbounded or duplicated one
 * degrades every future answer — quietly, and in a way that looks like the
 * model getting worse.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  MAX_RULES,
  MAX_RULE_LENGTH,
  addRule,
  parseProposal,
  readRules,
  removeRule,
  rulesFilePath,
  rulesPromptBlock,
} from './rules.js';

const dirs: string[] = [];
function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
  dirs.push(dir);
  return rulesFilePath(dir);
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('addRule', () => {
  it('round-trips a rule with the date it was learned', () => {
    const file = tmpFile();
    expect(addRule(file, 'Заметки писать самому', '2026-07-22T10:00:00Z')).toEqual({
      added: true,
    });
    expect(readRules(file)).toEqual([
      { text: 'Заметки писать самому', learnedAt: '2026-07-22' },
    ]);
  });

  it('keeps rules across additions', () => {
    const file = tmpFile();
    addRule(file, 'Первое');
    addRule(file, 'Второе');
    expect(readRules(file).map((r) => r.text)).toEqual(['Первое', 'Второе']);
  });

  it('is empty rather than failing when nothing was ever learned', () => {
    expect(readRules(tmpFile())).toEqual([]);
  });

  // The same lesson learned twice is one rule, not two lines of prompt.
  it('refuses a duplicate regardless of case or trailing punctuation', () => {
    const file = tmpFile();
    addRule(file, 'Не делегировать сабагенту');
    const again = addRule(file, 'не делегировать сабагенту.');
    expect(again.added).toBe(false);
    expect(again.reason).toMatch(/уже есть/);
    expect(readRules(file)).toHaveLength(1);
  });

  it('normalises whitespace so two spellings are one rule', () => {
    const file = tmpFile();
    addRule(file, 'Писать  в   General');
    expect(readRules(file)[0].text).toBe('Писать в General');
  });

  // Refuses rather than trims: half a rule is worse than none.
  it('refuses a rule longer than the cap', () => {
    const file = tmpFile();
    const res = addRule(file, 'я'.repeat(MAX_RULE_LENGTH + 1));
    expect(res.added).toBe(false);
    expect(res.reason).toMatch(/длиннее/);
    expect(readRules(file)).toHaveLength(0);
  });

  it('refuses an empty rule', () => {
    expect(addRule(tmpFile(), '   ').added).toBe(false);
  });

  // Unbounded growth makes every future answer worse, so the cap is a refusal
  // and not a silent eviction of something that might still matter.
  it('stops at the cap and says why', () => {
    const file = tmpFile();
    for (let i = 0; i < MAX_RULES; i++) addRule(file, `Правило ${i}`);
    const over = addRule(file, 'Ещё одно');
    expect(over.added).toBe(false);
    expect(over.reason).toMatch(/потолок/);
    expect(readRules(file)).toHaveLength(MAX_RULES);
  });
});

describe('removeRule', () => {
  it('removes by text and leaves the rest', () => {
    const file = tmpFile();
    addRule(file, 'Первое');
    addRule(file, 'Второе');
    expect(removeRule(file, 'Первое')).toBe(true);
    expect(readRules(file).map((r) => r.text)).toEqual(['Второе']);
  });

  it('reports when there was nothing to remove', () => {
    const file = tmpFile();
    addRule(file, 'Первое');
    expect(removeRule(file, 'Другое')).toBe(false);
    expect(readRules(file)).toHaveLength(1);
  });

  it('frees a slot at the cap', () => {
    const file = tmpFile();
    for (let i = 0; i < MAX_RULES; i++) addRule(file, `Правило ${i}`);
    removeRule(file, 'Правило 0');
    expect(addRule(file, 'Новое').added).toBe(true);
  });
});

describe('the file itself', () => {
  it('explains where it came from, for whoever opens it', () => {
    const file = tmpFile();
    addRule(file, 'Первое');
    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).toContain('🎓');
    expect(raw).toContain('после подтверждения');
  });

  it('survives hand-editing that leaves the list intact', () => {
    const file = tmpFile();
    addRule(file, 'Первое');
    addRule(file, 'Второе');
    const raw = fs.readFileSync(file, 'utf-8').replace('- 2026', '# заметка\n- 2026');
    fs.writeFileSync(file, raw);
    expect(readRules(file).length).toBeGreaterThanOrEqual(1);
  });
});

describe('rulesPromptBlock', () => {
  it('is empty when nothing was learned', () => {
    // An empty heading would still cost tokens and read as an invitation to
    // invent rules.
    expect(rulesPromptBlock([])).toBe('');
  });

  it('numbers the rules and tells the agent what to do with them', () => {
    const block = rulesPromptBlock([
      { text: 'Первое', learnedAt: '2026-07-22' },
      { text: 'Второе', learnedAt: '2026-07-22' },
    ]);
    expect(block).toContain('1. Первое');
    expect(block).toContain('2. Второе');
    expect(block).toContain('<learned-rules>');
    // A rule that cannot be followed should surface, not be dropped silently.
    expect(block).toMatch(/скажи об этом/);
  });

  it('leaves out the date — it is provenance, not instruction', () => {
    expect(rulesPromptBlock([{ text: 'Первое', learnedAt: '2026-07-22' }])).not.toContain(
      '2026-07-22',
    );
  });
});

describe('parseProposal', () => {
  it('takes the backticked rule the agent was asked for', () => {
    expect(parseProposal('Вот правило:\n\n`Заметки писать самому`\n\nПодойдёт?')).toBe(
      'Заметки писать самому',
    );
  });

  it('falls back to the first real line when the agent forgot the backticks', () => {
    expect(parseProposal('\n\n- Заметки писать самому\n')).toBe('Заметки писать самому');
  });

  it('rejects a proposal too long to be a rule', () => {
    expect(parseProposal(`\`${'я'.repeat(MAX_RULE_LENGTH + 1)}\``)).toBeNull();
    expect(parseProposal('я'.repeat(MAX_RULE_LENGTH + 1))).toBeNull();
  });

  it('rejects a reply with nothing usable in it', () => {
    expect(parseProposal('')).toBeNull();
    expect(parseProposal('  \n \n')).toBeNull();
  });
});
