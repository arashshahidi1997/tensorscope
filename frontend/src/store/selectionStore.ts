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
  viewportDuration: number;
  setViewportDuration: (d: number) => void;
  setTimeCursor: (t: number) => void;
  setTimeWindow: (w: TimeWindow) => void;
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
  timeWindow: [0, 2],
  spatial: { ap: 0, ml: 0, channel: null, hoveredId: null, selectedIds: [] },
  freq: { freq: 0 },
  event: { eventId: null, streamName: null },
};

export const useSelectionStore = create<SelectionStore>((set) => ({
  ...DEFAULT_STATE,
  viewportDuration: 1,

  setViewportDuration: (d) =>
    set((s) => ({
      viewportDuration: d,
      timeWindow: [Math.max(0, s.timeCursor - d / 2), s.timeCursor + d / 2],
    })),

  setTimeCursor: (t) =>
    set((s) => {
      const half = s.viewportDuration / 2;
      return {
        timeCursor: t,
        // Re-center window when cursor jumps outside the visible range.
        timeWindow:
          t < s.timeWindow[0] || t > s.timeWindow[1]
            ? [Math.max(0, t - half), t + half]
            : s.timeWindow,
      };
    }),

  setTimeWindow: (timeWindow) => set({ timeWindow }),

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
        if (p.time < s.timeWindow[0] || p.time > s.timeWindow[1]) {
          const half = s.viewportDuration / 2;
          next.timeWindow = [Math.max(0, p.time - half), p.time + half];
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
      // Compute the desired time window:
      // 1. If an explicit timeWindow argument was provided, use it.
      // 2. If this is the first load (window is still DEFAULT_STATE [0,2]),
      //    apply a 1s default centered on the cursor.
      // 3. If cursor jumps outside the visible range, re-center with 1s window.
      // 4. Otherwise preserve the current window.
      const half = s.viewportDuration / 2;
      let nextWindow: TimeWindow;
      if (timeWindow) {
        nextWindow = timeWindow;
      } else if (s.timeWindow[0] === 0 && s.timeWindow[1] === 2) {
        // First load — apply viewportDuration initial scale
        nextWindow = [Math.max(0, dto.time - half), dto.time + half];
      } else if (dto.time < s.timeWindow[0] || dto.time > s.timeWindow[1]) {
        nextWindow = [Math.max(0, dto.time - half), dto.time + half];
      } else {
        nextWindow = s.timeWindow;
      }
      return {
        timeCursor: dto.time,
        timeWindow: nextWindow,
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
