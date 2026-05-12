/**
 * Transient hover position shared across views.
 *
 * The committed selection (`useSelectionStore.timeCursor`, etc.) is a
 * sticky pointer the user has clicked on. The hover position is the
 * `mousemove`-tracked pointer the user is currently *over*, used to
 * draw a Bokeh-style crosshair line on every linked view.
 *
 * NOT persisted — clears on reload. Pure UI state.
 */
import { create } from "zustand";

export type HoverState = {
  /** Time (seconds) the cursor is over on a time-bearing view, or null. */
  hoverTime: number | null;
  /** Frequency (Hz) the cursor is over on a freq-bearing view, or null. */
  hoverFreq: number | null;
  /** AP/ML indices the cursor is over on the spatial map, or null. */
  hoverAP: number | null;
  hoverML: number | null;
  setHover: (patch: Partial<Omit<HoverState, "setHover" | "clearHover">>) => void;
  clearHover: () => void;
};

export const useHoverStore = create<HoverState>((set) => ({
  hoverTime: null,
  hoverFreq: null,
  hoverAP: null,
  hoverML: null,
  setHover: (patch) => set(patch),
  clearHover: () => set({ hoverTime: null, hoverFreq: null, hoverAP: null, hoverML: null }),
}));
