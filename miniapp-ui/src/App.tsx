import { useCallback, useState } from 'react';
import { AlertTriangle, Brain as BrainIcon, CalendarClock, LayoutGrid, Library as LibraryIcon } from 'lucide-react';

import { Brain } from '@/components/Brain';
import { Library } from '@/components/Library';
import { Tasks } from '@/components/Tasks';
import { Overview } from '@/components/Overview';
import { BottomNav, type NavItem } from '@/components/ui/nav';
import { tap } from '@/lib/telegram';

const TABS: NavItem[] = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'library', label: 'Library', icon: LibraryIcon },
  { value: 'tasks', label: 'Tasks', icon: CalendarClock },
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
      case 'library':
        return <Library onError={onError} />;
      case 'tasks':
        return <Tasks onError={onError} />;
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
