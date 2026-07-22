/**
 * Rules the assistant learned from its own mistakes.
 *
 * The loop is: something goes wrong, you tap 🎓 under the reply, the agent
 * proposes one short rule in words, and — only if you accept it — the
 * orchestrator writes it here. From then on it is prepended to every prompt.
 *
 * Two decisions carry most of the safety:
 *
 * **The agent never writes this file.** It proposes in prose; this module does
 * the writing. An agent that can edit its own standing instructions is a
 * feedback loop with no damping, and the failure is silent — you end up with a
 * bot whose behaviour you can no longer explain.
 *
 * **Rules go in the prompt, not in CLAUDE.md.** CLAUDE.md is read when a
 * session starts, so a rule added mid-session would not apply until the next
 * one — which is exactly when it is least likely to be remembered and most
 * likely to be needed. Prepending costs a few hundred tokens a turn and works
 * immediately.
 *
 * The budget is the third: rules accumulate, every one of them is loaded on
 * every turn, and a file of two hundred special cases makes the assistant
 * worse, not better. Past the cap it refuses and says so, rather than quietly
 * growing.
 */
import fs from 'fs';
import path from 'path';

/**
 * Enough for the lessons that actually recur, small enough to stay readable
 * and to keep the per-turn cost bounded.
 */
export const MAX_RULES = 40;

/** A rule longer than this is a paragraph, and a paragraph is not a rule. */
export const MAX_RULE_LENGTH = 200;

export interface Rule {
  text: string;
  learnedAt: string;
}

const HEADER = `# Выученные правила

<!-- Ведётся ConClaw автоматически. Правила предлагает агент по кнопке 🎓 и
     добавляются только после подтверждения; сам агент этот файл не пишет.
     Удалить правило можно, убрав строку. -->
`;

const RULE_LINE = /^-\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+?)\s*$/;

export function rulesFilePath(groupDir: string): string {
  return path.join(groupDir, 'RULES.md');
}

export function readRules(file: string): Rule[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const rules: Rule[] = [];
  for (const line of raw.split('\n')) {
    const m = RULE_LINE.exec(line.trim());
    if (m) rules.push({ learnedAt: m[1], text: m[2] });
  }
  return rules;
}

function writeRules(file: string, rules: Rule[]): void {
  const body = rules.map((r) => `- ${r.learnedAt} — ${r.text}`).join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${HEADER}\n${body}${body ? '\n' : ''}`);
}

/** Compare on content, ignoring case and trailing punctuation. */
function normalise(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/[.!;]+$/, '');
}

export interface AddResult {
  added: boolean;
  reason?: string;
}

/**
 * Add a rule, if it is one.
 *
 * Refuses rather than trims: a rule that had to be cut to fit was not a rule,
 * and silently storing half of it would be worse than storing none.
 */
export function addRule(
  file: string,
  text: string,
  now: string = new Date().toISOString(),
): AddResult {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return { added: false, reason: 'пустое правило' };
  if (clean.length > MAX_RULE_LENGTH) {
    return { added: false, reason: `правило длиннее ${MAX_RULE_LENGTH} символов` };
  }

  const rules = readRules(file);
  if (rules.some((r) => normalise(r.text) === normalise(clean))) {
    return { added: false, reason: 'такое правило уже есть' };
  }
  if (rules.length >= MAX_RULES) {
    return {
      added: false,
      reason: `достигнут потолок в ${MAX_RULES} правил — сначала убери устаревшие`,
    };
  }

  rules.push({ text: clean, learnedAt: now.slice(0, 10) });
  writeRules(file, rules);
  return { added: true };
}

/** Remove by exact text. Returns false when nothing matched. */
export function removeRule(file: string, text: string): boolean {
  const rules = readRules(file);
  const kept = rules.filter((r) => normalise(r.text) !== normalise(text));
  if (kept.length === rules.length) return false;
  writeRules(file, kept);
  return true;
}

/**
 * The block prepended to every prompt.
 *
 * Empty when there are no rules — an empty heading would still cost tokens and
 * would read as an instruction to invent some.
 */
export function rulesPromptBlock(rules: Rule[]): string {
  if (rules.length === 0) return '';
  const lines = rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n');
  return [
    '<learned-rules>',
    'Правила, выведенные из твоих прошлых ошибок в этом чате.',
    'Соблюдай их все. Если правило мешает выполнить просьбу — скажи об этом,',
    'а не нарушай молча.',
    lines,
    '</learned-rules>',
    '',
  ].join('\n');
}

/**
 * Pull the proposed rule out of the agent's reply.
 *
 * The agent is asked for one line in backticks. Falling back to the first
 * non-empty line keeps a well-meant answer usable, but anything that looks
 * like prose rather than a rule is rejected — a paragraph accepted here would
 * be prepended to every future prompt.
 */
export function parseProposal(reply: string): string | null {
  const fenced = /`([^`\n]{4,})`/.exec(reply);
  if (fenced) {
    const text = fenced[1].trim();
    return text.length <= MAX_RULE_LENGTH ? text : null;
  }
  const first = reply
    .split('\n')
    .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
    .find((l) => l.length > 3);
  if (!first) return null;
  return first.length <= MAX_RULE_LENGTH ? first : null;
}
