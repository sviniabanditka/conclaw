import { type Block, type Inline, parseMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

function InlineNode({ node, onWikilink }: { node: Inline; onWikilink?: (t: string) => void }) {
  switch (node.t) {
    case 'text':
      return <>{node.v}</>;
    case 'bold':
      return (
        <strong className="font-semibold">
          {node.children.map((c, i) => (
            <InlineNode key={i} node={c} onWikilink={onWikilink} />
          ))}
        </strong>
      );
    case 'italic':
      return (
        <em>
          {node.children.map((c, i) => (
            <InlineNode key={i} node={c} onWikilink={onWikilink} />
          ))}
        </em>
      );
    case 'code':
      return (
        <code className="bg-secondary rounded px-1 py-0.5 font-mono text-[0.85em]">
          {node.v}
        </code>
      );
    case 'link':
      return (
        <a href={node.href} target="_blank" rel="noopener" className="text-link break-words">
          {node.label}
        </a>
      );
    case 'wikilink':
      // Resolved by the parent against the loaded notes; a target that does not
      // exist is still shown, styled, so a broken link is visible rather than
      // vanishing into plain text.
      return (
        <button
          className="text-link underline decoration-dotted underline-offset-2"
          onClick={() => onWikilink?.(node.target)}
        >
          {node.target}
        </button>
      );
  }
}

function Inlines({ nodes, onWikilink }: { nodes: Inline[]; onWikilink?: (t: string) => void }) {
  return (
    <>
      {nodes.map((n, i) => (
        <InlineNode key={i} node={n} onWikilink={onWikilink} />
      ))}
    </>
  );
}

function BlockNode({ block, onWikilink }: { block: Block; onWikilink?: (t: string) => void }) {
  switch (block.t) {
    case 'heading': {
      const size = ['text-lg', 'text-lg', 'text-base', 'text-[15px]', 'text-[15px]', 'text-[15px]'][
        block.level - 1
      ];
      return (
        <div className={cn('mt-3 mb-1 font-semibold first:mt-0', size)}>
          <Inlines nodes={block.children} onWikilink={onWikilink} />
        </div>
      );
    }
    case 'paragraph':
      return (
        <p className="my-1.5 leading-relaxed first:mt-0">
          <Inlines nodes={block.children} onWikilink={onWikilink} />
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol className="my-1.5 list-decimal space-y-0.5 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines nodes={item} onWikilink={onWikilink} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="my-1.5 list-disc space-y-0.5 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines nodes={item} onWikilink={onWikilink} />
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className="bg-secondary my-2 overflow-x-auto rounded-md p-3 font-mono text-[12.5px] leading-relaxed">
          {block.v}
        </pre>
      );
    case 'quote':
      return (
        <blockquote className="border-border/70 text-muted-foreground my-2 border-l-2 pl-3">
          <Inlines nodes={block.children} onWikilink={onWikilink} />
        </blockquote>
      );
    case 'hr':
      return <hr className="border-border/60 my-3" />;
  }
}

/**
 * Render a note's markdown.
 *
 * Text nodes are the only thing that carries note content, and React escapes
 * every one — nothing here builds an HTML string, so a note body cannot inject
 * markup no matter what the agent wrote into the vault.
 */
export function Markdown({
  children,
  onWikilink,
  className,
}: {
  children: string;
  onWikilink?: (target: string) => void;
  className?: string;
}) {
  const blocks = parseMarkdown(children);
  return (
    <div className={cn('text-[14px]', className)}>
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} onWikilink={onWikilink} />
      ))}
    </div>
  );
}
