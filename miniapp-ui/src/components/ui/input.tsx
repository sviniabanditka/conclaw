import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'bg-card border-border/60 placeholder:text-muted-foreground flex h-10 w-full rounded-md border px-3 py-2 text-[15px] outline-none transition-colors focus-visible:border-ring/60',
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
        'bg-card border-border/60 placeholder:text-muted-foreground field-sizing-content min-h-28 w-full resize-y rounded-md border px-3 py-2 text-[15px] outline-none transition-colors focus-visible:border-ring/60',
        className,
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
