import { useCallback, useMemo, useRef } from "react";
import { clampWindow, snapWindowToLodTiles } from "../../api/queries";
import type { CoordSummary, SelectionDTO } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { toSelectionDTO, useSelectionStore } from "../../store/selectionStore";

/** Debounce (ms) between a window gesture settling and the slice refetch.
 * HiGlass uses ~100 ms; the live window still drives the chart x-scale. */
const WINDOW_FETCH_DEBOUNCE_MS = 100;

/** Longer debounce (ms) for the Tier-2 (expensive) views — `psd_live` and
 * `spectrogram_live`. A scrub/pan settles the cheap window at ~100 ms but the
 * multitaper compute must not be enqueued per intermediate step; this window
 * only publishes the FINAL position so a burst of window changes triggers one
 * spectral compute, not one per frame (perf-navigation-plan P5). */
const EXPENSIVE_WINDOW_FETCH_DEBOUNCE_MS = 350;

/** Overscan factor (P7): the timeseries query fetches this multiple of the
 * visible window so small pans/zoom-ins land inside already-loaded data and
 * don't refetch — the Neuroscope/HiGlass "local pan" feel. `2` gives half a
 * visible window of slack on each side. */
const TIMESERIES_OVERSCAN_FACTOR = 2;

/**
 * Tile-snapped overscan buffer around a visible window (P7). Widens the window
 * by `(factor − 1)/2` on each side, then snaps to the LOD-tile grid so the
 * buffer is a stable, cache-aligned key (the same grid the server LOD ladder
 * uses, P2/P6). Returns the input unchanged for a non-positive duration.
 */
export function overscanBuffer(
  visible: [number, number],
  factor = TIMESERIES_OVERSCAN_FACTOR,
): [number, number] {
  const [t0, t1] = visible;
  const duration = t1 - t0;
  if (!(duration > 0)) return visible;
  const margin = (duration * (factor - 1)) / 2;
  return snapWindowToLodTiles([t0 - margin, t1 + margin]);
}

/** True when the live visible window is fully inside the loaded buffer (P7) —
 * the client already holds data covering it, so a pan/zoom to `visible` needs
 * no refetch. */
export function isWithinLoadedBuffer(
  visible: [number, number],
  buffer: [number, number],
): boolean {
  return buffer[0] <= visible[0] && visible[1] <= buffer[1];
}

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
  /** Tile-snapped overscan buffer feeding the timeseries fetch (P7). Wider than
   *  the visible window and held stable while the visible window pans/zooms
   *  inside it, so a local pan reuses the same key (no refetch). A fresh buffer
   *  is computed only when the gesture leaves the loaded buffer. */
  timeseriesFetchWindow: [number, number];
  /** Longer-debounced + clamped window feeding the Tier-2 expensive views
   *  (`psd_live`, `spectrogram_live`) so a scrub doesn't enqueue a multitaper
   *  compute per intermediate step (P5). */
  expensiveSafeWindow: [number, number];
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

  // Tier-2 (expensive) window: a longer-debounced copy of the same live window.
  // Feeds psd_live / spectrogram_live so a scrub coalesces to one spectral
  // compute on the final position instead of one per intermediate step (P5).
  const expensiveFetchWindow = useDebouncedValue(timeWindow, EXPENSIVE_WINDOW_FETCH_DEBOUNCE_MS);

  // Clamp the (debounced) window to data bounds so panning outside the recording
  // never triggers a "slice returned no data" 400 from the server.
  const safeWindow = clampWindow(fetchWindow, timeCoord);
  const expensiveSafeWindow = clampWindow(expensiveFetchWindow, timeCoord);

  // Overscan buffer for the timeseries view (P7). The timeseries renderer is
  // overscan-ready — its x-scale is driven by the live `timeWindow`, not the
  // data extent (setData(…, false)) — so we fetch a window WIDER than what's
  // visible and keep that same buffer while the visible window pans/zooms
  // inside it: a local-only pan with zero network. A fresh, tile-snapped
  // buffer is computed only when the gesture leaves the loaded buffer. Other
  // window-bound views (raster / spectrogram) keep `safeWindow` because their
  // renderers draw exactly the fetched window — widening them would desync the
  // stacked panels.
  const bufferRef = useRef<[number, number] | null>(null);
  const timeseriesFetchWindow = useMemo<[number, number]>(() => {
    const visible = clampWindow(fetchWindow, timeCoord);
    const prev = bufferRef.current;
    if (prev && isWithinLoadedBuffer(visible, prev)) return prev;
    const next = clampWindow(overscanBuffer(visible), timeCoord);
    bufferRef.current = next;
    return next;
  }, [fetchWindow, timeCoord]);

  return {
    selectionDraft,
    timeWindow,
    setTimeWindow,
    viewportDuration,
    setDuration,
    handleSelectFreq,
    setHoveredElectrode,
    safeWindow,
    timeseriesFetchWindow,
    expensiveSafeWindow,
    selectedEventId: selectionState.event.eventId,
    selectedStreamName: selectionState.event.streamName,
  };
}
