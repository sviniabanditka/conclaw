/**
 * The approval buttons for a self-written skill.
 *
 * The announcement can sit unread for hours, so the interesting cases are the
 * ones where the world moved on underneath it: the proposal is gone, or it now
 * replaces something. Neither may be answered with a cheerful success.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  announcement,
  applySkillAction,
  parseSkillAction,
  skillButtons,
  type SkillActionDeps,
} from './skill-actions.js';

const CHAT = 'tg:1';
const MSG = '90';

function deps(over: Partial<SkillActionDeps> = {}): SkillActionDeps {
  return {
    promote: vi.fn(() => ({ promoted: true, replaced: false })),
    reject: vi.fn(() => true),
    editMessage: vi.fn(async () => {}),
    ...over,
  };
}

function calls(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('buttons', () => {
  // The name rides in the payload so a proposal announced before a restart is
  // still actionable afterwards.
  it('round-trips the skill name', () => {
    const [accept, reject] = skillButtons('weather-jokes');
    expect(parseSkillAction(accept.action)).toEqual({
      type: 'accept',
      name: 'weather-jokes',
    });
    expect(parseSkillAction(reject.action)).toEqual({
      type: 'reject',
      name: 'weather-jokes',
    });
  });

  it('keeps payloads inside the Telegram limit for the longest allowed name', () => {
    const longest = 'a'.repeat(39);
    for (const b of skillButtons(longest)) {
      expect(Buffer.byteLength(b.action)).toBeLessThanOrEqual(64);
    }
  });

  it('ignores callbacks belonging to other features', () => {
    expect(parseSkillAction('rl:60')).toBeNull();
    expect(parseSkillAction('sn:task-1')).toBeNull();
    expect(parseSkillAction('sk:')).toBeNull();
  });
});

describe('announcement', () => {
  it('leads with what the skill is for', () => {
    const text = announcement('weather-jokes', 'Шутит про погоду.', false);
    expect(text).toContain('weather-jokes');
    expect(text).toContain('Шутит про погоду.');
    expect(text).not.toContain('⚠️');
  });

  // Replacing is a different decision from adding, and must look different.
  it('warns when approving would replace a shipped skill', () => {
    const text = announcement('notes', 'Новая версия.', true);
    expect(text).toMatch(/обновить/);
    expect(text).toContain('⚠️');
  });
});

describe('installing', () => {
  it('promotes the skill and says when it takes effect', async () => {
    const d = deps();
    const toast = await applySkillAction(CHAT, MSG, 'sk:weather-jokes', d);

    expect(toast).toBe('Installed');
    expect(calls(d.promote)[0][0]).toBe('weather-jokes');
    // Skills are copied in at container start; the running one still has the
    // old set, and not saying so reads as the button having done nothing.
    expect(calls(d.editMessage)[0][2]).toMatch(/следующего запуска/);
  });

  it('says when it replaced a previous version', async () => {
    const d = deps({ promote: vi.fn(() => ({ promoted: true, replaced: true })) });
    await applySkillAction(CHAT, MSG, 'sk:notes', d);
    expect(calls(d.editMessage)[0][2]).toMatch(/заменил/);
  });

  it('reports the refusal it actually got', async () => {
    const d = deps({
      promote: vi.fn(() => ({ promoted: false, reason: 'предложение не найдено' })),
    });
    const toast = await applySkillAction(CHAT, MSG, 'sk:weather-jokes', d);
    expect(toast).toMatch(/не найдено/);
    expect(calls(d.editMessage)[0][2]).toMatch(/не найдено/);
  });

  it('runs the post-install hook only on success', async () => {
    const onPromoted = vi.fn();
    await applySkillAction(CHAT, MSG, 'sk:a', deps({ onPromoted }));
    expect(onPromoted).toHaveBeenCalledWith('a');

    onPromoted.mockClear();
    await applySkillAction(
      CHAT,
      MSG,
      'sk:a',
      deps({ onPromoted, promote: vi.fn(() => ({ promoted: false, reason: 'x' })) }),
    );
    expect(onPromoted).not.toHaveBeenCalled();
  });
});

describe('rejecting', () => {
  it('deletes the proposal and never promotes', async () => {
    const d = deps();
    expect(await applySkillAction(CHAT, MSG, 'sx:weather-jokes', d)).toBe('Discarded');
    expect(calls(d.reject)[0][0]).toBe('weather-jokes');
    expect(d.promote).not.toHaveBeenCalled();
  });

  it('does not claim to have removed something already gone', async () => {
    const d = deps({ reject: vi.fn(() => false) });
    expect(await applySkillAction(CHAT, MSG, 'sx:weather-jokes', d)).toBe('Gone');
    expect(calls(d.editMessage)[0][2]).toMatch(/уже нет/);
  });
});

describe('actions that are not ours', () => {
  it('returns null so another handler can take them', async () => {
    const d = deps();
    expect(await applySkillAction(CHAT, MSG, 'rl:60', d)).toBeNull();
    expect(d.promote).not.toHaveBeenCalled();
    expect(d.reject).not.toHaveBeenCalled();
  });
});
