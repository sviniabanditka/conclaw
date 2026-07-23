/**
 * The note renderer.
 *
 * It produces a token tree, not HTML — notes come from the vault the agent
 * writes to, so an HTML string here would be one bug away from running whatever
 * a note said. The tests pin the two things that matter: the vocabulary the
 * skill actually emits parses, and markup inside code and text is inert.
 */
import { describe, it, expect } from 'vitest';

import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('**a** *b* `c`')).toEqual([
      { t: 'bold', children: [{ t: 'text', v: 'a' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', children: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'c' },
    ]);
  });

  // A backtick pair should swallow a `*` inside it, not the other way round.
  it('does not read emphasis inside a code span', () => {
    expect(parseInline('`a*b*c`')).toEqual([{ t: 'code', v: 'a*b*c' }]);
  });

  it('reads a wikilink and a plain link', () => {
    expect(parseInline('see [[Domain]] and https://a.com')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'wikilink', target: 'Domain' },
      { t: 'text', v: ' and ' },
      { t: 'link', href: 'https://a.com', label: 'https://a.com' },
    ]);
  });

  it('reads a labelled link', () => {
    expect(parseInline('[docs](https://a.com/x)')).toEqual([
      { t: 'link', href: 'https://a.com/x', label: 'docs' },
    ]);
  });

  // A lone marker is just a character, not the start of anything.
  it('leaves an unpaired asterisk as text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, lists and paragraphs', () => {
    const blocks = parseMarkdown('# Title\n\n- one\n- two\n\nA paragraph.');
    expect(blocks[0]).toMatchObject({ t: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ t: 'list', ordered: false });
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[2]).toMatchObject({ t: 'paragraph' });
  });

  it('reads an ordered list', () => {
    const [list] = parseMarkdown('1. first\n2. second');
    expect(list).toMatchObject({ t: 'list', ordered: true });
  });

  // Nothing inside a fence is markup, or a note pasting a code sample would
  // have its own contents reinterpreted.
  it('takes a fenced block whole', () => {
    const [block] = parseMarkdown('```\n# not a heading\n**not bold**\n```');
    expect(block).toEqual({ t: 'code', v: '# not a heading\n**not bold**' });
  });

  it('joins wrapped paragraph lines', () => {
    const [p] = parseMarkdown('one\ntwo\nthree');
    expect(p).toMatchObject({ t: 'paragraph' });
    expect((p as { children: { v: string }[] }).children[0].v).toBe('one two three');
  });

  it('reads quotes and rules', () => {
    const blocks = parseMarkdown('> a quote\n\n---');
    expect(blocks[0]).toMatchObject({ t: 'quote' });
    expect(blocks[1]).toEqual({ t: 'hr' });
  });

  it('is empty for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });
});
