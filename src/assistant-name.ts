/**
 * Renaming the assistant inside a CLAUDE.md template.
 *
 * The templates are written for one name, and an install that chose another
 * has to have every mention rewritten — a file that says "You are Bob" under a
 * heading naming someone else produces an assistant that answers to both and
 * is sure of neither.
 *
 * Shared by registration and by the setup CLI, which were doing this with two
 * copies of the same pair of regexes.
 */
import { TEMPLATE_ASSISTANT_NAME } from './config.js';

/** Replace the template's name with `name` throughout a CLAUDE.md. */
export function renameAssistant(
  content: string,
  name: string,
  from: string = TEMPLATE_ASSISTANT_NAME,
): string {
  if (!name || name === from) return content;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content
    .replace(new RegExp(`^# ${escaped}$`, 'm'), `# ${name}`)
    .replace(new RegExp(`You are ${escaped}\\b`, 'g'), `You are ${name}`);
}
