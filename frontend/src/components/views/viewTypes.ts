import type { EventRecordDTO, SelectionDTO, TensorSliceDTO } from "../../api/types";

export type SliceViewProps = {
  slice: TensorSliceDTO;
  selection?: SelectionDTO;
  events?: EventRecordDTO[];
  /**
   * Called when the user clicks / commits a new time cursor.
   * Triggers a server round-trip; use for precise point selection.
   */
  onSelectTime?: (time: number) => void;
  onSelectCell?: (ap: number, ml: number) => void;
  /**
   * Called when the user clicks a frequency position in a view that has a freq axis.
   * Store-local update — no server round-trip needed (spectrogram and PSD already
   * render the full freq range; only the cursor position changes).
   * Views that publish freq changes participate in the spectrogram ↔ PSD
   * crosshair contract.
   */
  onSelectFreq?: (freq: number) => void;
  /**
   * Called when the view's visible time range changes (pan, zoom, drag).
   * Store-local update — no server round-trip.
   * Views that publish window changes participate in the overview↔detail
   * multiscale contract: navigator ↔ timeseries ↔ spectrogram.
   */
  onTimeWindowChange?: (window: [number, number]) => void;
  /**
   * The currently authoritative time window from the store.
   * Time-axis-bearing views (timeseries, spectrogram) use this to sync their
   * internal x-scale when an *external* push (SSE / agent / navigator brush)
   * changes the visible window. Without this, internal viewport caches
   * (e.g. uPlot's xRangeRef, useHeatmapGestures' viewport) shadow the store
   * and the chart visually pins despite the new slice range.
   *
   * See docs/log/issue/issue-arash-20260508-142724-956601.md.
   */
  timeWindow?: [number, number];
};
