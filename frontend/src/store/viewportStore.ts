/**
 * Transient (non-persisted) viewport geometry the data layer needs but can't
 * measure itself. The timeseries panel publishes its measured CSS width here
 * (via a ResizeObserver in `TimeseriesSliceView`); `useWorkspaceData` reads it
 * to derive the LOD point budget (`timeseriesPointBudget`, P6).
 *
 * Not persisted — width is a property of the current render, not session state.
 */
import { create } from "zustand";

/** uPlot plot-area insets (CSS px) of the timeseries panel, relative to its
 *  own view root. Published by `TimeseriesSliceView` so other time-axis views
 *  (the spectrogram) can match their data region to it — making the same time
 *  land at the same x across vertically-stacked panels. Null when no timeseries
 *  is mounted (e.g. the Spectral layout). */
export type TimeAxisInset = { left: number; right: number };

export type ViewportStore = {
  /** Measured timeseries panel width in CSS px, or null before first measure. */
  timeseriesWidthPx: number | null;
  setTimeseriesWidthPx: (px: number) => void;
  timeAxisInset: TimeAxisInset | null;
  setTimeAxisInset: (inset: TimeAxisInset | null) => void;
};

export const useViewportStore = create<ViewportStore>()((set) => ({
  timeseriesWidthPx: null,
  // Only publish on a real change so a resize that re-fires the observer with
  // the same width doesn't notify subscribers (and rebuild the request key).
  setTimeseriesWidthPx: (px) =>
    set((s) => (s.timeseriesWidthPx === px ? s : { timeseriesWidthPx: px })),
  timeAxisInset: null,
  // Dedupe within 0.5px so uPlot's sub-pixel relayouts don't churn subscribers.
  setTimeAxisInset: (inset) =>
    set((s) => {
      const a = s.timeAxisInset;
      if (a === inset) return s;
      if (a && inset && Math.abs(a.left - inset.left) < 0.5 && Math.abs(a.right - inset.right) < 0.5) {
        return s;
      }
      return { timeAxisInset: inset };
    }),
}));
