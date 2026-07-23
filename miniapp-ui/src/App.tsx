import { useCallback, useState } from 'react';
import { Brain as BrainIcon, CalendarClock, LayoutGrid, Library as LibraryIcon, Search } from 'lucide-react';

import { Brain } from '@/components/Brain';
import { History } from '@/components/History';
import { Library } from '@/components/Library';
import { Tasks } from '@/components/Tasks';
import { Overview } from '@/components/Overview';
import { BottomNav, type NavItem } from '@/components/ui/nav';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { tap } from '@/lib/telegram';
import { broadcastRefresh } from '@/lib/use-resource';

const TABS: NavItem[] = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'library', label: 'Library', icon: LibraryIcon },
  { value: 'tasks', label: 'Tasks', icon: CalendarClock },
  { value: 'history', label: 'Search', icon: Search },
  { value: 'brain', label: 'Brain', icon: BrainIcon },
];

function Shell() {
  const [tab, setTab] = useState('overview');
  const toast = useToast();
  const onError = useCallback((e: Error) => toast(e.message), [toast]);

  // Keyed by tab, so a switch remounts and refetches — the counts on Overview
  // must reflect whatever was just changed elsewhere.
  const panel = () => {
    switch (tab) {
      case 'library':
        return <Library key="library" onError={onError} />;
      case 'tasks':
        return <Tasks key="tasks" onError={onError} />;
      case 'history':
        return <History key="history" onError={onError} />;
      case 'brain':
        return <Brain key="brain" onError={onError} />;
      default:
        return <Overview key="overview" onError={onError} />;
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={broadcastRefresh}>
        <div className="mx-auto flex max-w-lg flex-col gap-2 px-4 pt-4 pb-24">
          {panel()}
        </div>
      </PullToRefresh>
      <BottomNav
        items={TABS}
        value={tab}
        onChange={(v) => {
          tap();
          setTab(v);
        }}
      />
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
