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
  setTimeCursor: (t: number) => void;
  setTimeWindow: (w: TimeWindow) => void;
  setSpatial: (s: SpatialSelection) => void;
  patchSpatial: (p: Partial<SpatialSelection>) => void;
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
  spatial: { ap: 0, ml: 0, channel: null },
  freq: { freq: 0 },
  event: { eventId: null, streamName: null },
};

export const useSelectionStore = create<SelectionStore>((set) => ({
  ...DEFAULT_STATE,

  setTimeCursor: (t) =>
    set((s) => ({
      timeCursor: t,
      // Re-center window when cursor jumps outside the visible range.
      timeWindow:
        t < s.timeWindow[0] || t > s.timeWindow[1]
          ? [Math.max(0, t - 1), t + 1]
          : s.timeWindow,
    })),

  setTimeWindow: (timeWindow) => set({ timeWindow }),

  setSpatial: (spatial) => set({ spatial }),

  patchSpatial: (p) => set((s) => ({ spatial: { ...s.spatial, ...p } })),

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
          next.timeWindow = [Math.max(0, p.time - 1), p.time + 1];
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
        };
      }
      return next;
    }),

  initFromDTO: (dto, timeWindow) =>
    set((s) => ({
      timeCursor: dto.time,
      // Preserve window unless an explicit one is provided or time changed.
      timeWindow:
        timeWindow ??
        (dto.time !== s.timeCursor
          ? [Math.max(0, dto.time - 1), dto.time + 1]
          : s.timeWindow),
      spatial: { ap: dto.ap, ml: dto.ml, channel: dto.channel },
      freq: { freq: dto.freq },
      event: s.event, // preserve existing event selection across API round-trips
    })),
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
