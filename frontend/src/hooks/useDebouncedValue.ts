import { useEffect, useState } from "react";

/**
 * Returns `value` trailing by `delayMs`. Updates are coalesced: during a burst
 * of changes the timer keeps resetting, so only the LAST value is published
 * once the burst goes quiet for `delayMs`.
 *
 * Used to decouple the live (optimistic) time window — which drives the chart
 * x-scale instantly — from the slice-fetch query key, so a pan/zoom drag fires
 * one fetch after it settles instead of one per animation frame. This is the
 * "optimistic transform + debounced fetch" pattern from HiGlass (~100 ms). See
 * docs/design/time-transport.md (Phase D).
 *
 * `value` is compared by reference across renders, so for tuples/objects pass a
 * stable identity that only changes when the content changes (e.g. a Zustand
 * store slice, which keeps the same array reference until it is replaced).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
