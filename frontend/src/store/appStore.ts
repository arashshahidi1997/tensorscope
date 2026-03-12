import { create } from "zustand";
import type { LayoutDTO } from "../api/types";

export type ThemeId = "plotly-dark" | "bokeh-dark" | "panel-light";

const THEME_IDS: ThemeId[] = ["plotly-dark", "bokeh-dark", "panel-light"];

function getInitialTheme(): ThemeId {
  if (typeof window === "undefined") return "plotly-dark";
  const saved = window.localStorage.getItem("tensorscope-theme");
  return THEME_IDS.includes(saved as ThemeId) ? (saved as ThemeId) : "plotly-dark";
}

type AppStore = {
  selectedTensor: string | null;
  /** Set of view types the user has toggled ON. Empty = use defaults (all available). */
  activeViews: string[];
  layoutDraft: LayoutDTO | null;
  theme: ThemeId;
  /** Whether to show brainstate color overlay on timeseries/navigator. */
  brainstateOverlay: boolean;
  /** Whether to show the hypnogram view. */
  showHypnogram: boolean;
  /** Per-panel tensor overrides: slotId → tensorName */
  panelTensorOverrides: Record<string, string>;
  /** PSD settings */
  psdFmax: number;
  psdNW: number;
  freqLogScale: boolean;
  setSelectedTensor: (value: string) => void;
  setPanelTensor: (slotId: string, tensorName: string) => void;
  clearPanelTensor: (slotId: string) => void;
  toggleView: (view: string, availableViews: string[]) => void;
  setActiveViews: (views: string[]) => void;
  setLayoutDraft: (value: LayoutDTO) => void;
  setTheme: (value: ThemeId) => void;
  toggleBrainstateOverlay: () => void;
  toggleHypnogram: () => void;
  setPsdFmax: (value: number) => void;
  setPsdNW: (value: number) => void;
  toggleFreqLogScale: () => void;
};

export const useAppStore = create<AppStore>((set) => ({
  selectedTensor: null,
  activeViews: [],
  panelTensorOverrides: {},
  layoutDraft: null,
  theme: getInitialTheme(),
  brainstateOverlay: true,
  showHypnogram: true,
  setSelectedTensor: (value) => set({ selectedTensor: value, activeViews: [], panelTensorOverrides: {} }),
  setPanelTensor: (slotId, tensorName) =>
    set((s) => ({ panelTensorOverrides: { ...s.panelTensorOverrides, [slotId]: tensorName } })),
  clearPanelTensor: (slotId) =>
    set((s) => {
      const { [slotId]: _, ...rest } = s.panelTensorOverrides;
      return { panelTensorOverrides: rest };
    }),
  toggleView: (view, availableViews) =>
    set((state) => {
      // If activeViews is empty it means "all on"; clicking a pill switches to explicit mode
      const current = state.activeViews.length === 0 ? availableViews : state.activeViews;
      const next = current.includes(view)
        ? current.filter((v) => v !== view)
        : [...current, view];
      // If all are selected, collapse back to empty (= all)
      return { activeViews: next.length === availableViews.length ? [] : next };
    }),
  setActiveViews: (views) => set({ activeViews: views }),
  setLayoutDraft: (value) => set({ layoutDraft: value }),
  setTheme: (value) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("tensorscope-theme", value);
    }
    set({ theme: value });
  },
  toggleBrainstateOverlay: () => set((s) => ({ brainstateOverlay: !s.brainstateOverlay })),
  toggleHypnogram: () => set((s) => ({ showHypnogram: !s.showHypnogram })),
  psdFmax: 100,
  psdNW: 4,
  freqLogScale: false,
  setPsdFmax: (value) => set({ psdFmax: value }),
  setPsdNW: (value) => set({ psdNW: value }),
  toggleFreqLogScale: () => set((s) => ({ freqLogScale: !s.freqLogScale })),
}));
