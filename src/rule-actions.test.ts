/**
 * The 🎓 loop.
 *
 * The property worth guarding is that nothing reaches the rules file without a
 * second, explicit tap — the agent proposes, the person decides. Everything
 * else here is about not lying to that person: a refusal has to say which
 * refusal it was, because "already there" and "the file is full" call for
 * opposite responses.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  applyRuleAction,
  isLearnAction,
  isProposalAction,
  learnButton,
  proposalButtons,
  proposalPrompt,
  type RuleActionDeps,
} from './rule-actions.js';

const CHAT = 'tg:1';
const MSG = '77';

function deps(over: Partial<RuleActionDeps> = {}): RuleActionDeps {
  return {
    getText: () => 'Заметку я записал в корень conclaw/',
    sendToAgent: vi.fn(),
    awaitProposal: vi.fn(),
    addRule: vi.fn(() => ({ added: true })),
    editMessage: vi.fn(async () => {}),
    ...over,
  };
}

function calls(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('buttons', () => {
  it('keeps callback payloads inside the Telegram limit', () => {
    for (const b of [learnButton(), ...proposalButtons()]) {
      expect(Buffer.byteLength(b.action)).toBeLessThanOrEqual(64);
    }
  });

  it('tells the two action kinds apart', () => {
    expect(isLearnAction(learnButton().action)).toBe(true);
    expect(isProposalAction(learnButton().action)).toBe(false);
    for (const b of proposalButtons()) {
      expect(isProposalAction(b.action)).toBe(true);
      expect(isLearnAction(b.action)).toBe(false);
    }
  });

  it('ignores callbacks belonging to other features', () => {
    expect(isLearnAction('rl:60')).toBe(false);
    expect(isProposalAction('sn:task-1')).toBe(false);
  });
});

describe('asking for a rule', () => {
  it('sends the wrong answer to the agent and waits for a proposal', async () => {
    const d = deps();
    const toast = await applyRuleAction(CHAT, MSG, 'lr:1', d);

    expect(toast).toBe('Learning');
    expect(calls(d.awaitProposal)[0][0]).toBe(CHAT);
    expect(calls(d.sendToAgent)[0][1]).toContain('в корень conclaw/');
    // Nothing is written on the way in.
    expect(d.addRule).not.toHaveBeenCalled();
  });

  it('shows that it is working, so a slow agent does not read as a dead button', async () => {
    const d = deps();
    await applyRuleAction(CHAT, MSG, 'lr:1', d);
    expect(calls(d.editMessage)[0][2]).toContain('🎓');
  });

  it('says so when the reply has aged out of the index', async () => {
    const d = deps({ getText: () => undefined });
    expect(await applyRuleAction(CHAT, MSG, 'lr:1', d)).toBe('Reply no longer tracked');
    expect(d.sendToAgent).not.toHaveBeenCalled();
    expect(d.awaitProposal).not.toHaveBeenCalled();
  });

  // A rule about one turn is not a rule; the prompt has to say so.
  it('asks for a general, checkable rule and nothing else', () => {
    const p = proposalPrompt('что-то не то');
    expect(p).toMatch(/ОДНО/);
    expect(p).toMatch(/общим/);
    expect(p).toMatch(/обратных кавычках/);
  });
});

describe('accepting a proposal', () => {
  it('stores the backticked rule', async () => {
    const d = deps({ getText: () => 'Правило: `Не делегировать сабагенту`' });
    const toast = await applyRuleAction(CHAT, MSG, 'ra:1', d);

    expect(toast).toBe('Saved');
    expect(calls(d.addRule)[0][0]).toBe('Не делегировать сабагенту');
    expect(calls(d.editMessage)[0][2]).toContain('Запомнил');
  });

  it('reports the refusal it actually got', async () => {
    const d = deps({
      getText: () => '`Не делегировать`',
      addRule: vi.fn(() => ({ added: false, reason: 'такое правило уже есть' })),
    });
    const toast = await applyRuleAction(CHAT, MSG, 'ra:1', d);

    expect(toast).toMatch(/уже есть/);
    expect(calls(d.editMessage)[0][2]).toMatch(/уже есть/);
  });

  // Two different failures that must not be conflated: the proposal is gone,
  // versus the proposal is here and contains no rule.
  it('says so when the proposal has aged out of the index', async () => {
    const d = deps({ getText: () => undefined });
    expect(await applyRuleAction(CHAT, MSG, 'ra:1', d)).toBe(
      'Proposal no longer tracked',
    );
    expect(d.addRule).not.toHaveBeenCalled();
  });

  it('does not pretend to have saved a reply with no rule in it', async () => {
    const d = deps({ getText: () => '   ' });
    const toast = await applyRuleAction(CHAT, MSG, 'ra:1', d);
    expect(toast).toBe('Nothing to save');
    expect(d.addRule).not.toHaveBeenCalled();
    expect(calls(d.editMessage)[0][2]).toContain('Не разобрал');
  });
});

describe('rejecting a proposal', () => {
  it('writes nothing and says so', async () => {
    const d = deps({ getText: () => '`Не делегировать`' });
    const toast = await applyRuleAction(CHAT, MSG, 'rd:1', d);

    expect(toast).toBe('Discarded');
    expect(d.addRule).not.toHaveBeenCalled();
    expect(calls(d.editMessage)[0][2]).toContain('Не запомнил');
  });
});

describe('actions that are not ours', () => {
  it('returns null so another handler can take them', async () => {
    const d = deps();
    expect(await applyRuleAction(CHAT, MSG, 'rl:60', d)).toBeNull();
    expect(await applyRuleAction(CHAT, MSG, 'sn:task-1', d)).toBeNull();
  });
});
