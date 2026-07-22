/**
 * The 🎓 loop: an answer was wrong, and the lesson should outlive the moment.
 *
 * Tapping 🎓 does not write anything. It asks the agent to name, in one line,
 * the rule that would have prevented the answer you just read — and the reply
 * that comes back carries ✅ and 🗑 instead of the usual buttons. Only ✅ writes.
 *
 * The separation is deliberate. The agent is good at spotting what it got
 * wrong and bad at judging whether that is a general rule or one bad turn; you
 * are the reverse. So it proposes in words and never touches the file.
 */
import { MessageButton } from './types.js';
import { AddResult, parseProposal } from './rules.js';

/** Kept short: Telegram caps callback payloads at 64 bytes. */
const LEARN_PREFIX = 'lr:';
const ACCEPT_PREFIX = 'ra:';
const REJECT_PREFIX = 'rd:';

/** Offered under every reply, next to the reminder and note buttons. */
export function learnButton(): MessageButton {
  return { label: '🎓', action: `${LEARN_PREFIX}1` };
}

/**
 * Buttons on the proposal itself. They replace the usual set rather than
 * joining it: a proposed rule is not something to be reminded about or filed
 * as a note, and the only two useful answers are yes and no.
 */
export function proposalButtons(): MessageButton[] {
  return [
    { label: '✅ Запомнить', action: `${ACCEPT_PREFIX}1` },
    { label: '🗑', action: `${REJECT_PREFIX}1` },
  ];
}

export function isLearnAction(action: string): boolean {
  return action.startsWith(LEARN_PREFIX);
}

export function isProposalAction(action: string): boolean {
  return (
    action.startsWith(ACCEPT_PREFIX) || action.startsWith(REJECT_PREFIX)
  );
}

/** What the agent is asked when 🎓 is tapped. */
export function proposalPrompt(reply: string): string {
  return [
    'Этот твой ответ оказался неправильным:',
    '',
    reply,
    '',
    'Назови ОДНО короткое правило, которое не дало бы тебе так ответить.',
    'Правило должно быть общим — про поведение, а не про этот случай, — и',
    'проверяемым. Не оправдывайся и не объясняй, что произошло.',
    'Ответь только правилом, в обратных кавычках, одной строкой.',
  ].join('\n');
}

export interface RuleActionDeps {
  /** The text of the message the button is attached to. */
  getText: (chatJid: string, messageId: string) => string | undefined;
  /** Hand text to the agent as though it had arrived in the chat. */
  sendToAgent: (chatJid: string, text: string) => void;
  /** Remember that the next reply here is a rule proposal. */
  awaitProposal: (chatJid: string) => void;
  addRule: (text: string) => AddResult;
  editMessage: (chatJid: string, messageId: string, text: string) => Promise<void>;
}

/**
 * Apply a 🎓 / ✅ / 🗑 action. Returns the toast, or null if the action belongs
 * to something else.
 */
export async function applyRuleAction(
  chatJid: string,
  messageId: string,
  action: string,
  deps: RuleActionDeps,
): Promise<string | null> {
  if (isLearnAction(action)) {
    const reply = deps.getText(chatJid, messageId);
    if (!reply) return 'Reply no longer tracked';
    deps.awaitProposal(chatJid);
    deps.sendToAgent(chatJid, proposalPrompt(reply));
    await deps.editMessage(chatJid, messageId, `${reply}\n\n🎓 Разбираю…`);
    return 'Learning';
  }

  if (!isProposalAction(action)) return null;

  const proposal = deps.getText(chatJid, messageId);
  if (!proposal) return 'Proposal no longer tracked';

  if (action.startsWith(REJECT_PREFIX)) {
    await deps.editMessage(chatJid, messageId, `${proposal}\n\n🗑 Не запомнил`);
    return 'Discarded';
  }

  const text = parseProposal(proposal);
  if (!text) {
    await deps.editMessage(
      chatJid,
      messageId,
      `${proposal}\n\n⚠️ Не разобрал правило в этом ответе`,
    );
    return 'Nothing to save';
  }

  const result = deps.addRule(text);
  if (!result.added) {
    // The reason is shown rather than swallowed: "already there" and "the file
    // is full" call for opposite responses from the user.
    await deps.editMessage(
      chatJid,
      messageId,
      `${proposal}\n\n⚠️ Не добавил: ${result.reason}`,
    );
    return result.reason ?? 'Not added';
  }

  await deps.editMessage(chatJid, messageId, `✅ Запомнил:\n\n${text}`);
  return 'Saved';
}
