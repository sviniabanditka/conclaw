import { useCallback, useState } from 'react';
import { AlertTriangle, Bookmark, Brain as BrainIcon, FileText, LayoutGrid, Search } from 'lucide-react';

import { Brain } from '@/components/Brain';
import { History } from '@/components/History';
import { Links } from '@/components/Links';
import { Notes } from '@/components/Notes';
import { Overview } from '@/components/Overview';
import { BottomNav, type NavItem } from '@/components/ui/nav';
import { tap } from '@/lib/telegram';

const TABS: NavItem[] = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'notes', label: 'Notes', icon: FileText },
  { value: 'links', label: 'Links', icon: Bookmark },
  { value: 'history', label: 'Search', icon: Search },
  { value: 'brain', label: 'Brain', icon: BrainIcon },
];

export function App() {
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState('overview');

  const onError = useCallback((e: Error) => setError(e.message), []);

  // Each panel is keyed by the tab, so switching remounts and refetches — the
  // counts on Overview must reflect whatever you just changed elsewhere.
  const panel = () => {
    if (error) {
      return (
        <div className="text-destructive flex items-center justify-center gap-2 px-1 py-12 text-center text-[14px]">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      );
    }
    switch (tab) {
      case 'notes':
        return <Notes onError={onError} />;
      case 'links':
        return <Links onError={onError} />;
      case 'history':
        return <History onError={onError} />;
      case 'brain':
        return <Brain onError={onError} />;
      default:
        return <Overview onError={onError} />;
    }
  };

  return (
    <>
      <div className="mx-auto flex max-w-lg flex-col gap-2 px-4 pt-4 pb-24">
        {panel()}
      </div>
      <BottomNav
        items={TABS}
        value={tab}
        onChange={(v) => {
          tap();
          setError(undefined);
          setTab(v);
        }}
      />
    </>
  );
}
