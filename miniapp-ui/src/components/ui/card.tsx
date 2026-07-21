import * as React from 'react';

import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-lg border border-border/60 px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('font-medium leading-snug break-words', className)} {...props} />;
}

function CardMeta({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('text-muted-foreground mt-1 text-[12.5px] leading-snug', className)}
      {...props}
    />
  );
}

export { Card, CardTitle, CardMeta };
