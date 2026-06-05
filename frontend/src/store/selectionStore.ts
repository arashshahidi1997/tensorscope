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
 * A window of the given width centered on `t`, clamped so it never starts
 * before 0. Width is preserved exactly even at the t=0 edge.
 */
function centeredWindow(t: number, width: number): TimeWindow {
  const lo = Math.max(0, t - width / 2);
  return [lo, lo + width];
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  ...DEFAULT_STATE,
  hasInitialized: false,

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

  setTimeWindow: (timeWindow) => set({ timeWindow }),

  recenterWindowOn: (t) =>
    set((s) => ({ timeWindow: centeredWindow(t, windowDuration(s.timeWindow)) })),

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
      timeWindow: p.timeWindow ?? s.timeWindow,
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
        nextWindow = timeWindow;
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
