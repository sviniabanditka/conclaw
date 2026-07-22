import { useEffect } from 'react';

import { cn } from '@/lib/utils';

/**
 * A bottom sheet.
 *
 * Editing a link used to expand the row in place, which pushed everything
 * below it down and lost your place in a long list. A sheet leaves the list
 * where it was.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  // A phone's back gesture should close the sheet, not the whole app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        className={cn(
          'bg-card animate-in-up relative max-h-[85vh] overflow-y-auto rounded-t-2xl px-4 pt-3 pb-6',
        )}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="bg-muted-foreground/40 mx-auto mb-3 h-1 w-9 rounded-full" />
        <div className="mb-3 text-[15px] font-medium">{title}</div>
        {children}
      </div>
    </div>
  );
}
