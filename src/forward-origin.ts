/**
 * Where a forwarded message came from.
 *
 * A forward carries someone else's words, and the assistant treated it as if
 * the user had said them — so "созвон в четверг" from a colleague became the
 * user's own plan. Telegram knows the origin; nothing was reading it.
 *
 * Attribution goes into the message text rather than a separate field because
 * that is what reaches the model: the prompt is built from `content`, and a
 * column nobody renders explains nothing.
 */

/** The shape Telegram sends (Bot API 7.0+), narrowed to what is used. */
export interface ForwardOrigin {
  type?: string;
  sender_user?: { first_name?: string; last_name?: string; username?: string };
  sender_user_name?: string;
  sender_chat?: { title?: string; username?: string };
  chat?: { title?: string; username?: string };
  author_signature?: string;
  date?: number;
}

function personName(user: {
  first_name?: string;
  last_name?: string;
  username?: string;
}): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || '';
}

/**
 * A human-readable source, or null when there is nothing worth saying.
 *
 * `hidden_user` is a real case with a real meaning — the original sender
 * blocked attribution — and reporting it as unknown is more honest than
 * dropping the fact that it was forwarded at all.
 */
export function describeOrigin(origin: ForwardOrigin | undefined): string | null {
  if (!origin) return null;

  switch (origin.type) {
    case 'user':
      return origin.sender_user ? personName(origin.sender_user) || null : null;
    case 'hidden_user':
      return origin.sender_user_name || 'скрытый отправитель';
    case 'chat':
      return origin.sender_chat?.title || origin.sender_chat?.username || null;
    case 'channel': {
      const channel = origin.chat?.title || origin.chat?.username;
      if (!channel) return null;
      // A signed post names a person as well as the channel; both matter.
      return origin.author_signature
        ? `${channel} · ${origin.author_signature}`
        : channel;
    }
    default:
      return null;
  }
}

/**
 * Mark content as forwarded.
 *
 * Prefixed rather than appended: the model reads the first line first, and a
 * long forward whose attribution sits at the bottom is a long forward read as
 * the user's own words.
 */
export function markForwarded(
  content: string,
  origin: ForwardOrigin | undefined,
): string {
  if (!origin) return content;
  const from = describeOrigin(origin);
  const head = from ? `[Переслано от: ${from}]` : '[Переслано]';
  return content ? `${head}\n${content}` : head;
}
