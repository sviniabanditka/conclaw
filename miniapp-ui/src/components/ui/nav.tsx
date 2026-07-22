import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface NavItem {
  value: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

/**
 * Bottom navigation.
 *
 * A row of tabs above the content is a desktop pattern: on a phone it sits at
 * the far end of the reach of a thumb, and it competes with Telegram's own
 * header right above it. Down here it is where every other app on the device
 * puts it.
 */
export function BottomNav({
  items,
  value,
  onChange,
}: {
  items: NavItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <nav
      className="bg-background/85 fixed inset-x-0 bottom-0 z-10 border-t border-border/60 backdrop-blur-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = item.value === value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              onClick={() => onChange(item.value)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="relative">
                <Icon className={cn('size-[22px]', active && 'stroke-[2.4]')} />
                {item.badge ? (
                  <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-2 min-w-4 rounded-full px-1 text-[9px] leading-4 font-semibold">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
