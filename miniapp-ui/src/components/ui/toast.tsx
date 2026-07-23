import { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * A transient error, over the content rather than instead of it.
 *
 * The app used to replace the whole panel with a red message on any failed
 * request, so one timed-out fetch made everything look broken and the only way
 * out was switching tabs. A request that fails while there is data on screen is
 * usually transient — the data is the thing worth keeping visible, and the
 * error is worth saying, briefly, without taking the screen.
 */
const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string>();

  const show = useCallback((m: string) => {
    setMessage(m);
    // Long enough to read, short enough not to linger over data that has since
    // loaded fine.
    window.setTimeout(() => setMessage(undefined), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div
          className="fixed inset-x-0 z-50 flex justify-center px-4"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
          role="alert"
          onClick={() => setMessage(undefined)}
        >
          <div className="bg-card animate-in-up flex max-w-sm items-center gap-2 rounded-xl border border-destructive/40 px-4 py-2.5 text-[13.5px] shadow-lg">
            <AlertTriangle className="text-destructive size-4 shrink-0" />
            <span className="text-foreground">{message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
