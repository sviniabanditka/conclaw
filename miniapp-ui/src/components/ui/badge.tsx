import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Also used as a tag filter, so it has to be pressable — `asButton` swaps the
 * element rather than nesting a button inside a span.
 */
function Badge({
  className,
  active,
  asButton,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean; asButton?: boolean }) {
  const Comp = asButton ? 'button' : 'span';
  return (
    <Comp
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1.5 text-[13px] leading-none transition-colors select-none',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-muted-foreground',
        className,
      )}
      {...(props as React.ComponentProps<'button'>)}
    />
  );
}

export { Badge };
