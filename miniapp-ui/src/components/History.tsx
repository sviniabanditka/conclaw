import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

import { Card, CardMeta } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type MessageView } from '@/lib/api';
import { when } from '@/lib/format';
import { cn } from '@/lib/utils';

/** One character matches nearly everything and is never what was meant. */
const MIN_QUERY = 2;

export function History({ onError }: { onError: (e: Error) => void }) {
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState<MessageView[] | null>(null);
  const [assistant, setAssistant] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < MIN_QUERY) {
      setMessages(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      api.history(q).then(
        (d) => {
          setMessages(d.messages);
          setAssistant(d.assistantName);
          setSearching(false);
        },
        (e) => {
          setSearching(false);
          onError(e);
        },
      );
    }, 250);
    return () => clearTimeout(id);
  }, [q, onError]);

  return (
    <>
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по переписке"
          className="pl-9"
        />
      </div>

      {q.trim().length < MIN_QUERY ? (
        <div className="text-muted-foreground py-12 text-center text-[14px]">
          Ищет и по твоим сообщениям, и по ответам бота.
        </div>
      ) : searching && !messages ? (
        <>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </>
      ) : messages && messages.length > 0 ? (
        messages.map((m, i) => (
          <Card key={`${m.at}-${i}`}>
            <CardMeta className={cn('mt-0', !m.fromBot && 'text-link')}>
              {m.fromBot ? assistant : 'Ты'} · {when(m.at)}
            </CardMeta>
            <div className="mt-1.5 text-[14px] leading-snug whitespace-pre-wrap">
              {m.text.length > 600 ? `${m.text.slice(0, 600)}…` : m.text}
            </div>
          </Card>
        ))
      ) : (
        <div className="text-muted-foreground py-12 text-center text-[14px]">
          Ничего не нашлось.
        </div>
      )}
    </>
  );
}
