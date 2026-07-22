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
        // Only surface the failure when there is nothing to show. A refresh
        // that fails while the previous answer is on screen is not worth
        // replacing that answer with an error.
        if (cache.get(key) === undefined) {
          forgetCached(key);
          onError(err as Error);
        }
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
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  return { data, refresh, refreshing };
}
