/**
 * Per-stream event property filters (event-filtering-plan.md E1).
 *
 * The second axis of event control: not *which types* to show (that's
 * `eventStreamsStore`'s pin/unpin), but *which events within a type* — keep
 * spindles with `peak_z > x` and `12 < freq < 15`, ripples with
 * `duration > 30 ms`, etc. Filters are **per-stream** (a spindle's properties
 * are not a ripple's) and **client-side** over the already-loaded,
 * window-bounded records, so threshold tweaks are instant (no refetch).
 *
 * Persisted so the reviewer's thresholds survive reload. Filtering is
 * non-destructive — clearing restores; it is orthogonal to the accept/reject
 * review status (a persisted curation decision).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Per-stream numeric property filters: stream → canonical property → [min,max] (inclusive). */
export type EventFilters = Record<string, Record<string, [number, number]>>;

export type EventFilterState = {
  filters: EventFilters;
};

export type EventFilterActions = {
  /** Set (or replace) the inclusive [min,max] range for one property on one stream. */
  setFilter: (stream: string, property: string, range: [number, number]) => void;
  /** Remove one property's filter; drops the stream entry when it becomes empty. */
  clearFilter: (stream: string, property: string) => void;
  /** Remove all filters for one stream. */
  clearStreamFilters: (stream: string) => void;
  /** Remove every filter on every stream. */
  clearAllFilters: () => void;
};

export const useEventFilterStore = create<EventFilterState & EventFilterActions>()(
  persist(
    (set) => ({
      filters: {},

      setFilter: (stream, property, range) =>
        set((s) => ({
          filters: {
            ...s.filters,
            [stream]: { ...(s.filters[stream] ?? {}), [property]: range },
          },
        })),

      clearFilter: (stream, property) =>
        set((s) => {
          const cur = s.filters[stream];
          if (!cur || !(property in cur)) return s;
          const { [property]: _drop, ...rest } = cur;
          const next = { ...s.filters };
          if (Object.keys(rest).length === 0) delete next[stream];
          else next[stream] = rest;
          return { filters: next };
        }),

      clearStreamFilters: (stream) =>
        set((s) => {
          if (!(stream in s.filters)) return s;
          const { [stream]: _drop, ...rest } = s.filters;
          return { filters: rest };
        }),

      clearAllFilters: () => set({ filters: {} }),
    }),
    {
      name: "tensorscope:event-filters",
      version: 1,
    },
  ),
);
