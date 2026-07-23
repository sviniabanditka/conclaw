/**
 * Just enough Markdown for what the notes skill writes.
 *
 * A library would render more, and cost a hundred kilobytes to do it — the
 * bundle is already 256 KB and this runs on a phone over mobile data. The
 * skill produces a known, small vocabulary: headings, lists, bold/italic,
 * inline and fenced code, links and `[[wikilinks]]`. That is what this covers,
 * and anything outside it falls through as its own text rather than breaking.
 *
 * The output is a token tree, not an HTML string. Notes come from the vault,
 * which the agent writes to, so building HTML here would be one injection bug
 * away from running whatever a note's body said; React renders the tree and
 * escapes every text node by construction.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; children: Inline[] }
  | { t: 'italic'; children: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; label: string }
  | { t: 'wikilink'; target: string };

export type Block =
  | { t: 'heading'; level: number; children: Inline[] }
  | { t: 'paragraph'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'code'; v: string }
  | { t: 'quote'; children: Inline[] }
  | { t: 'hr' };

/**
 * Inline spans within one line.
 *
 * Ordered so the greediest, least ambiguous markers win first: code spans
 * before emphasis, because a backtick pair should swallow any `*` inside it
 * rather than the other way round.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;

  const patterns: {
    re: RegExp;
    make: (m: RegExpExecArray) => Inline;
  }[] = [
    { re: /^`([^`]+)`/, make: (m) => ({ t: 'code', v: m[1] }) },
    {
      re: /^\*\*([^*]+)\*\*/,
      make: (m) => ({ t: 'bold', children: parseInline(m[1]) }),
    },
    {
      re: /^\*([^*]+)\*/,
      make: (m) => ({ t: 'italic', children: parseInline(m[1]) }),
    },
    {
      re: /^\[\[([^\]]+)\]\]/,
      make: (m) => ({ t: 'wikilink', target: m[1].trim() }),
    },
    {
      re: /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/,
      make: (m) => ({ t: 'link', href: m[2], label: m[1] }),
    },
    {
      re: /^(https?:\/\/[^\s)]+)/,
      make: (m) => ({ t: 'link', href: m[1], label: m[1] }),
    },
  ];

  let buffer = '';
  const flush = () => {
    if (buffer) {
      out.push({ t: 'text', v: buffer });
      buffer = '';
    }
  };

  while (rest) {
    let matched = false;
    for (const { re, make } of patterns) {
      const m = re.exec(rest);
      if (m) {
        flush();
        out.push(make(m));
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Consume one character and try again; a lone `*` is just an asterisk.
      buffer += rest[0];
      rest = rest.slice(1);
    }
  }
  flush();
  return out;
}

/** Block structure, line by line. */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code — taken whole, so nothing inside it is parsed as markup.
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      blocks.push({ t: 'code', v: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        t: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      const body: string[] = [quote[1]];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i++].replace(/^>\s?/, ''));
      }
      blocks.push({ t: 'quote', children: parseInline(body.join(' ')) });
      continue;
    }

    const listItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
    if (listItem) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')));
        i++;
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    // Paragraph: run of non-blank lines that started nothing else.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>\s?|\s*(?:[-*+]|\d+[.)])\s)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ t: 'paragraph', children: parseInline(para.join(' ')) });
  }

  return blocks;
}
