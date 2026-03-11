/**
 * useOverviewDetail — reusable hook for the overview↔detail navigation contract.
 *
 * Any linked view that participates in multiscale time navigation should use
 * this hook to read and publish cursor and window state.
 *
 * Contract:
 *
 *   timeCursor  — precise time point committed via server round-trip.
 *                 Use `onSelectTime` prop (→ commitSelection) to update it.
 *
 *   timeWindow  — visible range [t0, t1] in seconds. Store-local; no server
 *                 round-trip required. Drives slice requests for all time-based
 *                 views (timeseries, spectrogram, navigator).
 *
 * Publication flow:
 *
 *   Navigator drag       → setTimeWindow → store → timeseries re-fetches
 *   Timeseries pan/zoom  → setTimeWindow → store → navigator highlights range
 *   Any click            → onSelectTime  → commitSelection (server) → store
 *
 * To add a new view that participates in this contract:
 *   1. Call useOverviewDetail() to read timeCursor and timeWindow.
 *   2. Pass onTimeWindowChange={setTimeWindow} as a prop to your view.
 *   3. Wire the view's visible-range change event to onTimeWindowChange.
 *   4. Pass onSelectTime → commitSelection for cursor clicks.
 */
import { useSelectionStore } from "../../store/selectionStore";
import type { TimeWindow } from "../../types";

export type OverviewDetailContract = {
  /** Current committed time cursor in seconds. */
  timeCursor: number;
  /** Visible time range driving slice requests. */
  timeWindow: TimeWindow;
  /**
   * Publish a new visible range from any view.
   * Store-local — does not trigger a server round-trip.
   */
  setTimeWindow: (w: TimeWindow) => void;
};

export function useOverviewDetail(): OverviewDetailContract {
  const { timeCursor, timeWindow, setTimeWindow } = useSelectionStore();
  return { timeCursor, timeWindow, setTimeWindow };
}
