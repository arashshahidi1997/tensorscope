/**
 * Bokeh-style gesture-tool state. One active tool per category for
 * drag/scroll/tap gestures; inspectors stack (multiple at once). See
 * https://docs.bokeh.org/en/latest/docs/user_guide/interaction/tools.html
 *
 * Why a global store: previously each view shipped its own gesture state
 * (timeseries via `useChartTools`, spectrogram/PSDHeatmap via
 * `useHeatmapGestures`). Pan in one view didn't necessarily mean the
 * same as pan in the other, and there was no way for the reviewer to
 * pick "pan" once and have it apply everywhere. Centralising here keeps
 * the vocabulary identical across views.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DragTool = "pan" | "box_zoom" | "box_select";
export type ScrollTool = "wheel_zoom" | "off";
export type Inspector = "crosshair" | "hover";

export type GestureStore = {
  /** Active drag tool — exactly one. */
  drag: DragTool;
  /** Active scroll tool — exactly one (or "off"). */
  scroll: ScrollTool;
  /** Active inspectors — zero or more. */
  inspectors: Inspector[];
  setDrag: (t: DragTool) => void;
  setScroll: (t: ScrollTool) => void;
  toggleInspector: (i: Inspector) => void;
  setInspectorEnabled: (i: Inspector, enabled: boolean) => void;
};

/** True when the inspector is currently active. */
export function hasInspector(inspectors: Inspector[], i: Inspector): boolean {
  return inspectors.includes(i);
}

export const useGestureStore = create<GestureStore>()(
  persist(
    (set) => ({
      drag: "box_zoom",
      scroll: "wheel_zoom",
      inspectors: ["crosshair"],
      setDrag: (t) => set({ drag: t }),
      setScroll: (t) => set({ scroll: t }),
      toggleInspector: (i) =>
        set((s) => ({
          inspectors: s.inspectors.includes(i)
            ? s.inspectors.filter((x) => x !== i)
            : [...s.inspectors, i],
        })),
      setInspectorEnabled: (i, enabled) =>
        set((s) => ({
          inspectors: enabled
            ? s.inspectors.includes(i)
              ? s.inspectors
              : [...s.inspectors, i]
            : s.inspectors.filter((x) => x !== i),
        })),
    }),
    {
      name: "tensorscope:gestures",
      version: 1,
    },
  ),
);
