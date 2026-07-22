/**
 * Approving or rejecting a skill the assistant wrote for itself.
 *
 * The name rides in the callback payload rather than an index, so a proposal
 * announced before a restart is still actionable afterwards — the announcement
 * may sit unread for hours, and a button that quietly stops working in that
 * window is worse than no button.
 */
import { MessageButton } from './types.js';
import { PromoteResult } from './skill-proposals.js';

const ACCEPT_PREFIX = 'sk:';
const REJECT_PREFIX = 'sx:';

export function skillButtons(name: string): MessageButton[] {
  return [
    { label: '✅ Установить', action: `${ACCEPT_PREFIX}${name}` },
    { label: '🗑', action: `${REJECT_PREFIX}${name}` },
  ];
}

export type SkillAction =
  | { type: 'accept'; name: string }
  | { type: 'reject'; name: string };

export function parseSkillAction(action: string): SkillAction | null {
  if (action.startsWith(ACCEPT_PREFIX)) {
    const name = action.slice(ACCEPT_PREFIX.length);
    return name ? { type: 'accept', name } : null;
  }
  if (action.startsWith(REJECT_PREFIX)) {
    const name = action.slice(REJECT_PREFIX.length);
    return name ? { type: 'reject', name } : null;
  }
  return null;
}

/** The message that asks for approval. */
export function announcement(
  name: string,
  description: string,
  replaces: boolean,
): string {
  const head = replaces
    ? `🧩 Хочу *обновить* скилл \`${name}\``
    : `🧩 Написал себе скилл \`${name}\``;
  const warning = replaces
    ? '\n\n⚠️ Заменит существующий целиком.'
    : '';
  return `${head}\n\n${description}${warning}`;
}

export interface SkillActionDeps {
  promote: (name: string) => PromoteResult;
  reject: (name: string) => boolean;
  editMessage: (chatJid: string, messageId: string, text: string) => Promise<void>;
  /** Restart is not automatic; say what still has to happen. */
  onPromoted?: (name: string) => void;
}

export async function applySkillAction(
  chatJid: string,
  messageId: string,
  action: string,
  deps: SkillActionDeps,
): Promise<string | null> {
  const parsed = parseSkillAction(action);
  if (!parsed) return null;

  if (parsed.type === 'reject') {
    const removed = deps.reject(parsed.name);
    await deps.editMessage(
      chatJid,
      messageId,
      removed
        ? `🗑 Скилл \`${parsed.name}\` не установлен`
        : `🗑 Предложения \`${parsed.name}\` уже нет`,
    );
    return removed ? 'Discarded' : 'Gone';
  }

  const result = deps.promote(parsed.name);
  if (!result.promoted) {
    await deps.editMessage(
      chatJid,
      messageId,
      `⚠️ Не установил \`${parsed.name}\`: ${result.reason}`,
    );
    return result.reason ?? 'Not installed';
  }

  deps.onPromoted?.(parsed.name);
  // Skills are copied into a container at start, so the running one still has
  // the old set. Saying so beats the user wondering why nothing changed.
  await deps.editMessage(
    chatJid,
    messageId,
    `✅ Установил \`${parsed.name}\`${result.replaced ? ' (заменил прежний)' : ''}\n\n` +
      'Заработает со следующего запуска контейнера.',
  );
  return 'Installed';
}
