/**
 * viewQueryStatus — derive per-view status flags from a record of
 * React-Query result snapshots.
 *
 * Today every view uses `placeholderData: keepPreviousData` and `retry: false`
 * on its slice query. That means on an error the panel keeps painting the
 * PREVIOUS window's data with no signal, and during a refetch it paints
 * stale data the same way. Both are silent for a scientific tool — the user
 * has no way to tell the panel is showing the wrong window. (refactor-plan N2.)
 *
 * Pure, testable derivation: tests live in `viewQueryStatus.test.ts`.
 */

/** Minimal subset of a React-Query result needed for status derivation. */
export type ViewQuerySnapshot = {
  isFetching: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
};

export type ViewStatusMaps = {
  /** Currently in flight (covers initial load + revalidation). */
  fetchingByView: Record<string, boolean>;
  /** The latest query errored. The panel still has its last successful slice
   *  pinned by `keepPreviousData`, but the data on screen is now provably
   *  stale. */
  erroredByView: Record<string, boolean>;
  /** The panel is currently painting placeholder (previous-window) data
   *  because the new fetch hasn't resolved yet. Distinct from `fetching`:
   *  every stale view is fetching, but not every fetching view is stale
   *  (the initial load fetches with no placeholder). */
  staleByView: Record<string, boolean>;
};

/**
 * Build status maps from a record of per-view query snapshots.
 *
 * Skips entries whose snapshot is null/undefined — callers can pass partial
 * records (e.g. only the views with active queries this render) without
 * polluting the map with `false` keys.
 */
export function buildViewQueryStatusMaps(
  snapshots: Record<string, ViewQuerySnapshot | null | undefined>,
): ViewStatusMaps {
  const fetchingByView: Record<string, boolean> = {};
  const erroredByView: Record<string, boolean> = {};
  const staleByView: Record<string, boolean> = {};
  for (const [viewId, snap] of Object.entries(snapshots)) {
    if (!snap) continue;
    fetchingByView[viewId] = snap.isFetching;
    erroredByView[viewId] = snap.isError;
    staleByView[viewId] = snap.isPlaceholderData;
  }
  return { fetchingByView, erroredByView, staleByView };
}
