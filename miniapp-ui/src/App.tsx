import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Ask } from '@/components/Ask';
import { History } from '@/components/History';
import { Links } from '@/components/Links';
import { Overview } from '@/components/Overview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { tap } from '@/lib/telegram';

const TABS = [
  { value: 'overview', label: 'Обзор' },
  { value: 'links', label: 'Ссылки' },
  { value: 'history', label: 'История' },
  { value: 'ask', label: 'Спросить' },
];

export function App() {
  const [error, setError] = useState<string>();
  // Identity changes on every tab switch, which remounts the panel and so
  // refetches — the counts on Обзор must reflect what you just changed.
  const [tab, setTab] = useState('overview');

  const onError = useCallback((e: Error) => setError(e.message), []);

  return (
    <div className="mx-auto flex max-w-lg flex-col px-4 pt-4 pb-8">
      <h1 className="mb-3 px-1 text-xl font-semibold tracking-tight">ConClaw</h1>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          tap();
          setError(undefined);
          setTab(v);
        }}
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {error && (
          <div className="text-destructive flex items-center gap-2 px-1 py-8 text-center text-[14px]">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {!error && (
          <>
            <TabsContent value="overview">
              <Overview onError={onError} />
            </TabsContent>
            <TabsContent value="links">
              <Links onError={onError} />
            </TabsContent>
            <TabsContent value="history">
              <History onError={onError} />
            </TabsContent>
            <TabsContent value="ask">
              <Ask onError={onError} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
