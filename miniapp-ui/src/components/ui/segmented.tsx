import { cn } from '@/lib/utils';

/**
 * A two-or-three way switch between views of the same kind of thing.
 *
 * Distinct from the bottom bar on purpose: that moves you between parts of the
 * app, this picks which slice of one part you are looking at. Giving them the
 * same shape would make the hierarchy unreadable.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="bg-secondary/70 flex gap-1 rounded-lg p-1">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            aria-pressed={active}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-[13.5px] font-medium transition-colors',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn('ml-1.5', !active && 'opacity-70')}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
