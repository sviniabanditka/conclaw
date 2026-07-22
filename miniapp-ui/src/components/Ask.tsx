import { useState } from 'react';
import { Check, SendHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';

export function Ask({ onError }: { onError: (e: Error) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [refused, setRefused] = useState<string>();

  async function send() {
    setBusy(true);
    setRefused(undefined);
    try {
      const res = await api.send(text);
      if (!res.sent) {
        haptic('error');
        setRefused(res.reason ?? 'not sent');
        setBusy(false);
        return;
      }
      haptic('success');
      setSent(true);
    } catch (e) {
      setBusy(false);
      onError(e as Error);
    }
  }

  if (sent) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-center text-[14px]">
        <Check className="text-primary size-8" />
        Sent. The reply arrives in the chat.
        <Button
          variant="secondary"
          onClick={() => {
            setText('');
            setSent(false);
            setBusy(false);
          }}
        >
          Write another
        </Button>
      </div>
    );
  }

  return (
    <>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask something, or hand over a task"
        autoFocus
      />
      {refused && <div className="text-destructive px-1 text-[13px]">{refused}</div>}
      <Button size="block" disabled={busy || !text.trim()} onClick={send}>
        <SendHorizontal className="size-4" />
        Send
      </Button>
      <p className="text-muted-foreground px-1 text-[12.5px]">
        Goes into the same queue as a chat message — the reply arrives in Telegram.
      </p>
    </>
  );
}
