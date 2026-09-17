import { create } from "zustand";
import type {
  SelectionState,
  SelectionPatch,
  TimeWindow,
  SpatialSelection,
  FreqSelection,
  EventSelection,
} from "../types";
import type { SelectionDTO } from "../api/types";

type SelectionStore = SelectionState & {
  /** True once the store has been bootstrapped from a server selection DTO. */
  hasInitialized: boolean;
  /**
   * Inspect-event mode (additive, "inspect one detected event at full
   * resolution"). When true, the timeseries fetch switches to an un-decimated
   * `downsample:"none"` request over the (already tight, ≤ 8 s) visible window
   * so fast oscillations show individual cycles. Normal navigation leaves this
   * false and is unchanged. Toggling it off restores the decimated LOD path.
   */
  inspectMode: boolean;
  setInspectMode: (on: boolean) => void;
  /** Set the visible-window width (s), centered on the current cursor. */
  setDuration: (seconds: number) => void;
  setTimeCursor: (t: number) => void;
  setTimeWindow: (w: TimeWindow) => void;
  /**
   * Re-center the visible window on time `t`, preserving the current width.
   * Unlike `setTimeCursor` (which only re-centers when the cursor leaves the
   * window), this ALWAYS centers — for "jump to time" actions like event
   * navigation, where the target must be brought into view even if it's
   * already inside the current window.
   */
  recenterWindowOn: (t: number) => void;
  /**
   * Snap the cursor + window into the data's real time extent when they fall
   * entirely outside it (first contact on a non-zero-origin recording).
   * No-op when the current transport already intersects the data.
   */
  applyTimeBounds: (bounds: [number, number]) => void;
  setSpatial: (s: SpatialSelection) => void;
  patchSpatial: (p: Partial<SpatialSelection>) => void;
  /**
   * Update transient hover electrode. Does NOT trigger a server round-trip.
   * Call from mousemove handlers on the canvas.
   */
  setHoveredElectrode: (id: number | null) => void;
  /**
   * Commit a multi-electrode selection by electrode ids.
   */
  setSelectedElectrodes: (ids: number[]) => void;
  /**
   * Toggle one electrode in/out of the multi-selection.
   */
  toggleElectrodeSelection: (id: number) => void;
  /**
   * Select all electrodes whose apIdx and mlIdx fall within the brush bounds.
   * electrodes: the layout's electrode list to filter from.
   */
  setSpatialBrush: (
    apIdxRange: [number, number],
    mlIdxRange: [number, number],
    electrodes: import("../types/spatialLayout").ElectrodeCoord[],
  ) => void;
  setFreq: (f: FreqSelection) => void;
  setEvent: (e: EventSelection) => void;
  patch: (p: SelectionPatch) => void;
  /**
   * Apply a partial SelectionDTO patch from legacy callers (e.g. SelectionPanel).
   * Maps DTO fields onto the structured SelectionState shape.
   */
  patchFromDTO: (p: Partial<SelectionDTO>) => void;
  /** Bootstrap or synchronise state from an API SelectionDTO response. */
  initFromDTO: (dto: SelectionDTO, timeWindow?: TimeWindow) => void;
};

const DEFAULT_STATE: SelectionState = {
  timeCursor: 0,
  // 1 s initial scale. The window's WIDTH is the single source of truth for
  // "duration" — there is no separate viewportDuration field to drift from it.
  timeWindow: [0, 1],
  spatial: { ap: 0, ml: 0, channel: null, hoveredId: null, selectedIds: [] },
  freq: { freq: 0 },
  event: { eventId: null, streamName: null },
};

/** Visible-window width in seconds — the single source of truth for "duration". */
export const windowDuration = (w: TimeWindow): number => w[1] - w[0];

/** True when `t` falls within the visible window (inclusive). */
const within = (t: number, w: TimeWindow): boolean => t >= w[0] && t <= w[1];

/**
 * Maximum visible-window width (seconds) — bounded zoom (ADR-0011). The high-res
 * trace is for oscillation timescales (≤ ~1 min); the whole session is the
 * navigator's job (via its coarse overview). Crucially this also keeps every
 * view's FETCH window under the server's memmap read cap — a long memory-mapped
 * `.lfp` cannot be read whole, so an unbounded window would 400 ("zoom in").
 */
export const MAX_WINDOW_S = 60;

/** Cap a width at `MAX_WINDOW_S` (lower bound left free so you can zoom in to ms). */
const clampWidth = (width: number): number => Math.min(MAX_WINDOW_S, Math.max(0, width));

/** Cap a window's width at `MAX_WINDOW_S`, keeping it centered on its midpoint. */
function clampWindowWidth(w: TimeWindow): TimeWindow {
  const width = w[1] - w[0];
  if (width <= MAX_WINDOW_S) return w;
  const center = (w[0] + w[1]) / 2;
  const lo = Math.max(0, center - MAX_WINDOW_S / 2);
  return [lo, lo + MAX_WINDOW_S];
}

/**
 * A window of the given width centered on `t`, clamped so it never starts
 * before 0 and never wider than `MAX_WINDOW_S`. Width is preserved exactly
 * (after the cap) even at the t=0 edge.
 */
function centeredWindow(t: number, width: number): TimeWindow {
  const w = clampWidth(width);
  const lo = Math.max(0, t - w / 2);
  return [lo, lo + w];
}

/** First-contact window width (s) when the current window is degenerate. */
const INIT_WINDOW_S = 10;

/**
 * Bounds-aware transport correction (1c). The server's default selection is
 * `time = 0`, so a recording whose time coord starts elsewhere (e.g. a
 * session-clock slab at t = 1080 s) opened on an empty window: every view
 * sliced a void and the spatial map showed an ERROR badge until the user
 * typed a valid time by hand.
 *
 * Returns the corrected `{timeCursor, timeWindow}` when the current cursor
 * or window falls outside the data's real time extent, or `null` when the
 * current transport already intersects the data (never stomps a real
 * position — URL restore, pair echo, and user navigation win).
 */
export function boundsAwareTransport(
  cursor: number,
  window: TimeWindow,
  bounds: [number, number],
): { timeCursor: number; timeWindow: TimeWindow } | null {
  const [lo, hi] = bounds;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const cursorIn = cursor >= lo && cursor <= hi;
  const intersects = window[1] > lo && window[0] < hi;
  if (cursorIn && intersects) return null;
  const currentWidth = windowDuration(window);
  const width = Math.min(
    clampWidth(currentWidth > 0 && Number.isFinite(currentWidth) ? currentWidth : INIT_WINDOW_S),
    hi - lo,
  );
  return { timeCursor: lo, timeWindow: [lo, lo + width] };
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  ...DEFAULT_STATE,
  hasInitialized: false,
  inspectMode: false,

  setInspectMode: (on) => set({ inspectMode: on }),

  // Width is the single source of truth: setting a duration recenters the
  // window on the current cursor; nothing stores a second "viewportDuration".
  setDuration: (seconds) =>
    set((s) => ({ timeWindow: centeredWindow(s.timeCursor, seconds) })),

  setTimeCursor: (t) =>
    set((s) => ({
      timeCursor: t,
      // Re-center (preserving the current window WIDTH) only when the cursor
      // leaves the visible range.
      timeWindow: within(t, s.timeWindow)
        ? s.timeWindow
        : centeredWindow(t, windowDuration(s.timeWindow)),
    })),

  setTimeWindow: (timeWindow) => set({ timeWindow: clampWindowWidth(timeWindow) }),

  recenterWindowOn: (t) =>
    set((s) => ({ timeWindow: centeredWindow(t, windowDuration(s.timeWindow)) })),

  applyTimeBounds: (bounds) =>
    set((s) => boundsAwareTransport(s.timeCursor, s.timeWindow, bounds) ?? {}),

  setSpatial: (spatial) => set({ spatial }),

  patchSpatial: (p) => set((s) => ({ spatial: { ...s.spatial, ...p } })),

  setHoveredElectrode: (id) =>
    set((s) => ({ spatial: { ...s.spatial, hoveredId: id } })),

  setSelectedElectrodes: (ids) =>
    set((s) => ({ spatial: { ...s.spatial, selectedIds: ids } })),

  toggleElectrodeSelection: (id) =>
    set((s) => {
      const has = s.spatial.selectedIds.includes(id);
      const selectedIds = has
        ? s.spatial.selectedIds.filter((x) => x !== id)
        : [...s.spatial.selectedIds, id];
      return { spatial: { ...s.spatial, selectedIds } };
    }),

  setSpatialBrush: (apIdxRange, mlIdxRange, electrodes) =>
    set((s) => {
      const [apLo, apHi] = apIdxRange;
      const [mlLo, mlHi] = mlIdxRange;
      const selectedIds = electrodes
        .filter(
          (e) =>
            e.apIdx >= apLo && e.apIdx <= apHi &&
            e.mlIdx >= mlLo && e.mlIdx <= mlHi,
        )
        .map((e) => e.id);
      return { spatial: { ...s.spatial, selectedIds } };
    }),

  setFreq: (freq) => set({ freq }),

  setEvent: (event) => set({ event }),

  patch: (p) =>
    set((s) => ({
      timeCursor: p.timeCursor ?? s.timeCursor,
      timeWindow: p.timeWindow ? clampWindowWidth(p.timeWindow) : s.timeWindow,
      spatial: p.spatial ? { ...s.spatial, ...p.spatial } : s.spatial,
      freq: p.freq ? { ...s.freq, ...p.freq } : s.freq,
      event: p.event ? { ...s.event, ...p.event } : s.event,
    })),

  patchFromDTO: (p) =>
    set((s) => {
      const next: Partial<SelectionState> = {};
      if (p.time !== undefined) {
        next.timeCursor = p.time;
        if (!within(p.time, s.timeWindow)) {
          next.timeWindow = centeredWindow(p.time, windowDuration(s.timeWindow));
        }
      }
      if (p.freq !== undefined) {
        next.freq = { ...s.freq, freq: p.freq };
      }
      if (p.ap !== undefined || p.ml !== undefined || p.channel !== undefined) {
        next.spatial = {
          ap: p.ap ?? s.spatial.ap,
          ml: p.ml ?? s.spatial.ml,
          channel: p.channel !== undefined ? p.channel : s.spatial.channel,
          hoveredId: s.spatial.hoveredId,
          selectedIds: s.spatial.selectedIds,
        };
      }
      return next;
    }),

  initFromDTO: (dto, timeWindow) =>
    set((s) => {
      // Desired window:
      // 1. an explicit argument wins;
      // 2. first load (not yet initialized) OR cursor outside the visible
      //    range → recenter, preserving the current window WIDTH (the single
      //    source of truth — no separate viewportDuration to drift from it);
      // 3. otherwise preserve the current window.
      let nextWindow: TimeWindow;
      if (timeWindow) {
        nextWindow = clampWindowWidth(timeWindow);
      } else if (!s.hasInitialized || !within(dto.time, s.timeWindow)) {
        nextWindow = centeredWindow(dto.time, windowDuration(s.timeWindow));
      } else {
        nextWindow = s.timeWindow;
      }
      return {
        timeCursor: dto.time,
        timeWindow: nextWindow,
        hasInitialized: true,
        spatial: { ap: dto.ap, ml: dto.ml, channel: dto.channel, hoveredId: null, selectedIds: [] },
        freq: { freq: dto.freq },
        event: s.event, // preserve existing event selection across API round-trips
      };
    }),
}));

/** Convert SelectionState back to the wire DTO format for API calls. */
export function toSelectionDTO(s: SelectionState): SelectionDTO {
  return {
    time: s.timeCursor,
    freq: s.freq.freq,
    ap: s.spatial.ap,
    ml: s.spatial.ml,
    channel: s.spatial.channel,
  };
}
