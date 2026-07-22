import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, GraduationCap, Puzzle, Trash2, Wrench } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMeta, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { History } from '@/components/History';
import {
  api,
  type Brain as BrainData,
  type ProposalView,
  type TurnTrace,
} from '@/lib/api';
import { when } from '@/lib/format';
import { haptic, tap } from '@/lib/telegram';

/**
 * A proposed skill, with its whole text.
 *
 * Collapsed by default but always openable: approving prose that instructs an
 * agent, having read one line of description, is a formality rather than a
 * decision — and this screen is the only place the text can be read at all.
 */
function Proposal({
  proposal,
  onChanged,
  onError,
}: {
  proposal: ProposalView;
  onChanged: () => void;
  onError: (e: Error) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(run: () => Promise<{ installed?: boolean; discarded?: boolean }>) {
    setBusy(true);
    try {
      const res = await run();
      if (res.installed === false || res.discarded === false) {
        haptic('error');
        setBusy(false);
        return;
      }
      haptic('success');
      onChanged();
    } catch (e) {
      setBusy(false);
      onError(e as Error);
    }
  }

  return (
    <Card className="border-ring/40">
      <div className="flex items-start gap-2">
        <Puzzle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <CardTitle className="font-mono text-[14px]">{proposal.name}</CardTitle>
          <CardMeta>{proposal.description}</CardMeta>
          {proposal.replaces && (
            <CardMeta className="text-destructive">
              replaces the existing skill entirely
            </CardMeta>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-2 px-0"
        onClick={() => {
          tap();
          setOpen((v) => !v);
        }}
      >
        <ChevronDown
          className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        {open ? 'Collapse' : 'Read in full'}
      </Button>

      {open && (
        <pre className="bg-background animate-in-up mt-2 max-h-96 overflow-auto rounded-md p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
          {proposal.content}
        </pre>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="block"
          disabled={busy}
          onClick={() => act(() => api.installSkill(proposal.name))}
        >
          Install
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          disabled={busy}
          title="Discard"
          onClick={() => act(() => api.discardSkill(proposal.name))}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

/**
 * What went into one answer. Answering "why did it do that" used to mean
 * reading container logs — which is how this install found a skill that had
 * never loaded while everyone assumed its contents were wrong.
 */
function Turn({ turn }: { turn: TurnTrace }) {
  const tools = Object.entries(turn.tools).sort((a, b) => b[1] - a[1]);
  return (
    <Card>
      <CardMeta className="mt-0">
        {when(turn.startedAt)} · {(turn.durationMs / 1000).toFixed(1)}s ·{' '}
        {turn.rules} rules
      </CardMeta>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {turn.skills.length === 0 ? (
          <span className="text-muted-foreground text-[13px]">
            no skills loaded
          </span>
        ) : (
          turn.skills.map((s) => <Badge key={s}>{s}</Badge>)
        )}
      </div>
      {tools.length > 0 && (
        <CardMeta className="flex flex-wrap items-center gap-x-2">
          <Wrench className="size-3" />
          {tools.map(([name, n]) => (
            <span key={name}>
              {name}
              {n > 1 ? ` ×${n}` : ''}
            </span>
          ))}
        </CardMeta>
      )}
    </Card>
  );
}

export function Brain({ onError }: { onError: (e: Error) => void }) {
  const [data, setData] = useState<BrainData | null>(null);

  const load = useCallback(() => {
    api.brain().then(setData, onError);
  }, [onError]);

  useEffect(load, [load]);

  if (!data) {
    return (
      <>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </>
    );
  }

  async function forget(text: string) {
    try {
      const res = await api.forgetRule(text);
      haptic(res.removed ? 'success' : 'error');
      if (res.removed) load();
    } catch (e) {
      onError(e as Error);
    }
  }

  return (
    <>
      {/* The conversation belongs with the rest of what the assistant did and
          learned, and a sixth item in the bottom bar does not fit a phone. */}
      <div className="text-muted-foreground px-1 text-[12px] tracking-wide uppercase">
        Conversation
      </div>
      <History onError={onError} />

      {data.proposals.length > 0 && (
        <>
          <div className="text-muted-foreground mt-3 px-1 text-[12px] tracking-wide uppercase">
            Awaiting your call
          </div>
          {data.proposals.map((p) => (
            <Proposal key={p.name} proposal={p} onChanged={load} onError={onError} />
          ))}
        </>
      )}

      {data.turns.length > 0 && (
        <>
          <div className="text-muted-foreground mt-2 px-1 text-[12.5px] tracking-wide uppercase">
            Recent answers
          </div>
          {data.turns.map((t) => (
            <Turn key={t.startedAt} turn={t} />
          ))}
        </>
      )}

      <div className="text-muted-foreground mt-3 flex items-center gap-1.5 px-1 text-[12.5px] tracking-wide uppercase">
        <GraduationCap className="size-3.5" />
        Rules ({data.rules.length})
      </div>
      {data.rules.length === 0 ? (
        <div className="text-muted-foreground py-6 text-center text-[14px]">
          Nothing learned yet.
          <br />
          Tap 🎓 under an answer that went wrong.
        </div>
      ) : (
        data.rules.map((rule) => (
          <Card key={rule.text}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-[14px] font-normal">{rule.text}</CardTitle>
                <CardMeta>learned {when(`${rule.learnedAt}T12:00:00.000Z`)}</CardMeta>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                title="Forget"
                onClick={() => forget(rule.text)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </Card>
        ))
      )}

      <div className="text-muted-foreground mt-3 px-1 text-[12.5px] tracking-wide uppercase">
        Skills ({data.skills.length})
      </div>
      <div className="flex flex-wrap gap-1.5 px-1">
        {data.skills.map((s) => (
          <Badge key={s.name} title={s.description}>
            {s.name}
          </Badge>
        ))}
      </div>
    </>
  );
}
