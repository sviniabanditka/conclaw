import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { haptic } from '@/lib/telegram';
import { cn } from '@/lib/utils';

/** Past this drag distance a release triggers a refresh. */
const THRESHOLD = 70;
/** Beyond this the indicator stops following, so an over-pull does not stretch. */
const MAX = 110;

/**
 * Drag down from the top to refresh.
 *
 * Only arms when the scroll is already at the very top, so it never fights an
 * ordinary scroll-up in the middle of a list. Telegram's own vertical swipe is
 * disabled elsewhere, which is what makes the gesture ours to claim here.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);

  return (
    <div
      onTouchStart={(e) => {
        // atTop, not "near": arming mid-scroll would hijack a flick upward.
        const atTop = window.scrollY <= 0;
        startY.current = atTop ? e.touches[0].clientY : null;
      }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        const delta = e.touches[0].clientY - startY.current;
        if (delta <= 0) {
          setPull(0);
          return;
        }
        // Resist as it stretches, so the pull feels weighted rather than loose.
        setPull(Math.min(MAX, delta * 0.5));
      }}
      onTouchEnd={() => {
        if (pull >= THRESHOLD) {
          haptic('success');
          onRefresh();
        }
        startY.current = null;
        setPull(0);
      }}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height]"
        style={{ height: pull }}
      >
        <RefreshCw
          className={cn(
            'text-muted-foreground size-5 transition-transform',
            pull >= THRESHOLD && 'text-primary',
          )}
          style={{ transform: `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / 40) }}
        />
      </div>
      {children}
    </div>
  );
}
