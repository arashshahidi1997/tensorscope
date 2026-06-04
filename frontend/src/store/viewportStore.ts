/**
 * Transient (non-persisted) viewport geometry the data layer needs but can't
 * measure itself. The timeseries panel publishes its measured CSS width here
 * (via a ResizeObserver in `TimeseriesSliceView`); `useWorkspaceData` reads it
 * to derive the LOD point budget (`timeseriesPointBudget`, P6).
 *
 * Not persisted — width is a property of the current render, not session state.
 */
import { create } from "zustand";

export type ViewportStore = {
  /** Measured timeseries panel width in CSS px, or null before first measure. */
  timeseriesWidthPx: number | null;
  setTimeseriesWidthPx: (px: number) => void;
};

export const useViewportStore = create<ViewportStore>()((set) => ({
  timeseriesWidthPx: null,
  // Only publish on a real change so a resize that re-fires the observer with
  // the same width doesn't notify subscribers (and rebuild the request key).
  setTimeseriesWidthPx: (px) =>
    set((s) => (s.timeseriesWidthPx === px ? s : { timeseriesWidthPx: px })),
}));
