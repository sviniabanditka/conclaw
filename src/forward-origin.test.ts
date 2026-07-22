/**
 * Attribution on forwarded messages.
 *
 * The failure it prevents is quiet and expensive: a colleague's "созвон в
 * четверг", forwarded, was read as the user's own plan because nothing said
 * whose words they were.
 */
import { describe, it, expect } from 'vitest';

import { describeOrigin, markForwarded } from './forward-origin.js';

describe('describeOrigin', () => {
  it('names a person by their full name', () => {
    expect(
      describeOrigin({
        type: 'user',
        sender_user: { first_name: 'Тарас', last_name: 'Ковальчук' },
      }),
    ).toBe('Тарас Ковальчук');
  });

  it('falls back to the username when there is no name', () => {
    expect(
      describeOrigin({ type: 'user', sender_user: { username: 'taras' } }),
    ).toBe('taras');
  });

  it('names a group or channel by its title', () => {
    expect(describeOrigin({ type: 'chat', sender_chat: { title: 'Brights' } })).toBe(
      'Brights',
    );
    expect(describeOrigin({ type: 'channel', chat: { title: 'Хроники' } })).toBe(
      'Хроники',
    );
  });

  // A signed post is by a person *in* a channel, and both halves matter.
  it('names the author of a signed channel post alongside the channel', () => {
    expect(
      describeOrigin({
        type: 'channel',
        chat: { title: 'Хроники' },
        author_signature: 'Аня',
      }),
    ).toBe('Хроники · Аня');
  });

  // The sender blocked attribution — a real fact, not missing data.
  it('reports a hidden sender rather than pretending there was none', () => {
    expect(describeOrigin({ type: 'hidden_user', sender_user_name: 'Аноним' })).toBe(
      'Аноним',
    );
    expect(describeOrigin({ type: 'hidden_user' })).toBe('скрытый отправитель');
  });

  it('is null for a message that was not forwarded', () => {
    expect(describeOrigin(undefined)).toBeNull();
    expect(describeOrigin({ type: 'something-new' })).toBeNull();
  });
});

describe('markForwarded', () => {
  it('leaves an ordinary message untouched', () => {
    expect(markForwarded('привет', undefined)).toBe('привет');
  });

  // The model reads the first line first; attribution at the bottom of a long
  // forward is a long forward read as the user's own words.
  it('puts the attribution first', () => {
    const marked = markForwarded('созвон в четверг', {
      type: 'user',
      sender_user: { first_name: 'Тарас' },
    });
    expect(marked.split('\n')[0]).toBe('[Переслано от: Тарас]');
    expect(marked).toContain('созвон в четверг');
  });

  it('still says it was forwarded when the source is unknown', () => {
    expect(markForwarded('текст', { type: 'something-new' })).toBe(
      '[Переслано]\nтекст',
    );
  });

  it('handles a forward with no text of its own', () => {
    expect(markForwarded('', { type: 'user', sender_user: { first_name: 'Тарас' } })).toBe(
      '[Переслано от: Тарас]',
    );
  });
});
