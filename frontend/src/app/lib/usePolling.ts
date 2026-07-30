import { useEffect, useRef, useState } from "react";

/** Polls `fetcher` every `intervalMs`, exposing the latest result, loading and error state. */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const result = await fetcherRef.current();
        if (!cancelled) { setData(result); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return { data, loading, error };
}
