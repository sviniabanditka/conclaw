import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Controls are 16px, and that is not a typographic choice.
 *
 * Safari zooms the whole page when a focused field's text is smaller, and
 * there is no one-handed way back out of that zoom. Anything overriding the
 * size here brings the zoom back with it.
 */

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'bg-card border-border/60 placeholder:text-muted-foreground flex h-11 w-full rounded-md border px-3 py-2 text-base outline-none transition-colors focus-visible:border-ring/60',
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'bg-card border-border/60 placeholder:text-muted-foreground field-sizing-content min-h-28 w-full resize-y rounded-md border px-3 py-2 text-base outline-none transition-colors focus-visible:border-ring/60',
        className,
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
