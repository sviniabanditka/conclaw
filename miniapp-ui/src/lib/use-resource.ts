import { useCallback, useEffect, useState } from 'react';

/**
 * Fetched data that survives a tab switch, and refreshes when you come back.
 *
 * Two problems, one cause. Switching tabs remounts the panel, so every switch
 * threw the data away and redrew a skeleton for something the app had fetched
 * seconds earlier. And a panel fetched once on mount, so anything the bot
 * wrote while the app sat open was invisible until you switched away and back.
 *
 * So: the last result is kept per key and returned immediately, then
 * revalidated in the background — the screen never goes blank for data it
 * already has. Coming back to the app revalidates too, since that is exactly
 * when it is most likely to be stale.
 */
const cache = new Map<string, unknown>();

/** Broadcast by a manual refresh; every mounted resource re-fetches. */
export const REFRESH_EVENT = 'conclaw:refresh';

export function broadcastRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

/** Cleared on a hard error so a stale view is not left looking authoritative. */
export function forgetCached(key: string): void {
  cache.delete(key);
}

export function useResource<T>(
  key: string,
  load: () => Promise<T>,
  onError: (e: Error) => void,
): { data: T | undefined; refresh: () => void; refreshing: boolean } {
  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load().then(
      (result) => {
        cache.set(key, result);
        setData(result);
        setRefreshing(false);
      },
      (err) => {
        setRefreshing(false);
        // The error is always reported — as a toast now, not a full-screen
        // wall — but the data on screen is left alone. A background request
        // that times out should not blank a correct answer.
        onError(err as Error);
      },
    );
  }, [key, load, onError]);

  useEffect(() => {
    setData(cache.get(key) as T | undefined);
    refresh();
  }, [key, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // A manual pull-to-refresh anywhere refreshes whatever is mounted, which
    // is only the visible panel.
    window.addEventListener(REFRESH_EVENT, refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(REFRESH_EVENT, refresh);
    };
  }, [refresh]);

  return { data, refresh, refreshing };
}
