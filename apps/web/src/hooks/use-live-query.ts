"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LiveQuery<T> {
  /** Last successful payload — retained while a refetch is in flight. */
  data: T | null;
  error: string | null;
  /** In flight with no data yet (initial load or retry after an error). */
  loading: boolean;
  /** In flight with stale data still on screen — dim it, don't hide it. */
  refreshing: boolean;
  reload: () => Promise<void>;
}

/**
 * Minimal fetch-state wrapper for the live Supabase plane. Guarantees the two
 * invariants the hand-rolled effects kept getting wrong: rejections always land
 * in `error` (never a silent all-zeros render), and stale data survives a
 * refetch so the UI can dim instead of collapsing to a spinner. Deliberately
 * has no cache or dedupe — a proper query library can replace it mechanically.
 */
export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
): LiveQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(true);
  // Monotonic token: a stale response (scope changed mid-flight) is ignored.
  const token = useRef(0);
  const hasData = data !== null;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    const ticket = ++token.current;
    setInFlight(true);
    setError(null);
    try {
      const result = await fetcher();
      if (token.current === ticket) setData(result);
    } catch (e) {
      if (token.current === ticket) setError((e as Error).message);
    } finally {
      if (token.current === ticket) setInFlight(false);
    }
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  return {
    data,
    error,
    loading: inFlight && !hasData,
    refreshing: inFlight && hasData,
    reload: run,
  };
}
