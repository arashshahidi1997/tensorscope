import { useCallback, useMemo } from "react";
import { clampWindow } from "../../api/queries";
import type { CoordSummary, SelectionDTO } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { toSelectionDTO, useSelectionStore } from "../../store/selectionStore";

/** Debounce (ms) between a window gesture settling and the slice refetch.
 * HiGlass uses ~100 ms; the live window still drives the chart x-scale. */
const WINDOW_FETCH_DEBOUNCE_MS = 100;

export type TimeNavigation = {
  /** Memoised selection DTO — stable identity across renders that don't change
   *  the underlying cursor/freq/spatial primitives. */
  selectionDraft: SelectionDTO;
  /** Live visible window (drives chart x-scales instantly). */
  timeWindow: [number, number];
  setTimeWindow: (w: [number, number]) => void;
  /** Visible-window width (s), derived from the window. */
  viewportDuration: number;
  setDuration: (seconds: number) => void;
  /** Store-local freq update (no server round-trip). */
  handleSelectFreq: (freq: number) => void;
  setHoveredElectrode: (id: number | null) => void;
  /** Debounced + data-bounds-clamped window that feeds slice FETCHES. */
  safeWindow: [number, number];
  /** Event selection (for PSD-lock-to-event derivation). */
  selectedEventId: string | number | null;
  selectedStreamName: string | null;
};

/**
 * Time / cursor navigation controller for the workspace.
 *
 * Owns the visible window (live + debounced/clamped fetch window), the memoised
 * selection draft, and the freq/duration/hover handlers. The live `timeWindow`
 * drives chart x-scales instantly while `safeWindow` trails (debounced) so a
 * pan/zoom drag fires one request after it settles — the HiGlass "optimistic
 * transform + debounced fetch" pattern. See docs/design/time-transport.md (D).
 */
export function useTimeNavigation(timeCoord: CoordSummary | undefined): TimeNavigation {
  const selectionState = useSelectionStore();
  const { timeWindow, setTimeWindow, setFreq, setHoveredElectrode, setDuration } = selectionState;

  // Visible-window width (s) — DERIVED from the window, not stored. Highlights
  // the matching TimeScaleBar preset; the single source of truth for duration.
  const viewportDuration = timeWindow[1] - timeWindow[0];

  // Store-local freq update — no server round-trip; spectrogram and PSD already
  // render the full freq range and project the cursor client-side.
  const handleSelectFreq = useCallback((freq: number) => setFreq({ freq }), [setFreq]);

  // Memoise selectionDraft on the underlying primitives so its identity is
  // stable across renders that don't actually change the selection. Without
  // this, every store mutation (including hover-only events on the canvas
  // that touch `spatial.hoveredId`) produces a fresh DTO and invalidates
  // every downstream memo.
  const selectionDraft = useMemo(
    () => toSelectionDTO(selectionState),
    [
      selectionState.timeCursor,
      selectionState.freq.freq,
      selectionState.spatial.ap,
      selectionState.spatial.ml,
      selectionState.spatial.channel,
    ],
  );

  // Debounce the window that feeds slice FETCHES (~100 ms) so a pan/zoom drag
  // fires one request after it settles, not one per frame. The live `timeWindow`
  // still drives the chart x-scale instantly (TimeseriesSliceView reads it
  // directly), so the pan stays smooth while the data trails.
  const fetchWindow = useDebouncedValue(timeWindow, WINDOW_FETCH_DEBOUNCE_MS);

  // Clamp the (debounced) window to data bounds so panning outside the recording
  // never triggers a "slice returned no data" 400 from the server.
  const safeWindow = clampWindow(fetchWindow, timeCoord);

  return {
    selectionDraft,
    timeWindow,
    setTimeWindow,
    viewportDuration,
    setDuration,
    handleSelectFreq,
    setHoveredElectrode,
    safeWindow,
    selectedEventId: selectionState.event.eventId,
    selectedStreamName: selectionState.event.streamName,
  };
}
