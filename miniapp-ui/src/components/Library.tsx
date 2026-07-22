import { useEffect, useState } from 'react';

import { Links } from '@/components/Links';
import { Notes } from '@/components/Notes';
import { Segmented } from '@/components/ui/segmented';
import { api } from '@/lib/api';
import { tap } from '@/lib/telegram';

type View = 'notes' | 'links';

/**
 * Notes and links, under one item in the bottom bar.
 *
 * They are the same gesture — things you kept — and two of five slots on a
 * phone was too much of the bar for one idea. The counts are on the switch
 * because the reason to come here is usually "how much is waiting".
 */
export function Library({ onError }: { onError: (e: Error) => void }) {
  const [view, setView] = useState<View>('notes');
  const [counts, setCounts] = useState<{ notes?: number; links?: number }>({});

  useEffect(() => {
    // Both counts are totals. Showing unread for one and a total for the other
    // made the number mean two different things depending on which half you
    // were looking at — and "Unread" read as the name of the tab.
    api.overview().then(
      (o) => setCounts((c) => ({ ...c, links: o.linkCount })),
      () => {},
    );
    api.notes().then(
      (d) => setCounts((c) => ({ ...c, notes: d.notes.length })),
      () => {},
    );
  }, []);

  return (
    <>
      <Segmented
        value={view}
        onChange={(v) => {
          tap();
          setView(v);
        }}
        items={[
          { value: 'notes', label: 'Notes', count: counts.notes },
          { value: 'links', label: 'Links', count: counts.links },
        ]}
      />
      {view === 'notes' ? <Notes onError={onError} /> : <Links onError={onError} />}
    </>
  );
}
