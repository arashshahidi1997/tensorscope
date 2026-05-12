import { create } from "zustand";
import type { LayoutDTO } from "../api/types";

export type ThemeId = "plotly-dark" | "bokeh-dark" | "panel-light";

export type WorkspaceObject = {
  id: string;
  name: string;
  tensorName: string;
  type: "source" | "derived";
  visible: boolean;
};

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
  psdWindowS: number;
  /**
   * When true and an event is selected, the PSD live request uses the
   * event's `[t_start, t_end]` span (plus a small margin) instead of the
   * cursor-centered `psdWindowS` window. See `docs/design/...` G8.
   * Session-local — not persisted.
   */
  psdLockToEvent: boolean;
  freqLogScale: boolean;
  /**
   * Per-view bandpass overlay (timeseries view). Controls the
   * filtered-band feature from `docs/design/filtered-band-overlay.md`.
   * `preset === "off"` disables the overlay entirely.
   */
  bandPreset: BandPreset;
  /** Active band [lo, hi] when preset === "custom"; ignored otherwise. */
  bandCustom: [number, number];
  /**
   * First channel index visible in the timeseries view.
   * `nVisible` is currently fixed at 32 (perf). See
   * `docs/design/channel-viewport.md` G2.
   */
  tsFirstChannel: number;
  workspaceObjects: WorkspaceObject[];
  setWorkspaceObjects: (objs: WorkspaceObject[]) => void;
  setObjectVisible: (id: string, visible: boolean) => void;
  objectLayoutMode: "single" | "row" | "column";
  setObjectLayoutMode: (m: "single" | "row" | "column") => void;
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
  setPsdWindowS: (value: number) => void;
  togglePsdLockToEvent: () => void;
  toggleFreqLogScale: () => void;
  setBandPreset: (preset: BandPreset) => void;
  setBandCustom: (lo: number, hi: number) => void;
  /**
   * Scroll the channel viewport. Always clamps to [0, max(0, total - nVisible)].
   * Total/nVisible are passed in by the view since the store doesn't know
   * the slice's channel count.
   */
  scrollChannels: (delta: number, total: number, nVisible: number) => void;
  setTsFirstChannel: (idx: number) => void;
};

export type BandPreset = "off" | "spindle" | "ripple" | "slow" | "custom";

/** Band [lo_hz, hi_hz] for each preset. `off` returns null = no filter. */
export const BAND_PRESETS: Record<Exclude<BandPreset, "off" | "custom">, [number, number]> = {
  spindle: [11, 16],
  ripple: [100, 250],
  slow: [0.5, 4],
};

/** Resolve a preset + custom value to a concrete band, or null when off. */
export function resolveBand(
  preset: BandPreset,
  custom: [number, number],
): [number, number] | null {
  if (preset === "off") return null;
  if (preset === "custom") return custom;
  return BAND_PRESETS[preset];
}

export const useAppStore = create<AppStore>((set) => ({
  selectedTensor: null,
  activeViews: [],
  panelTensorOverrides: {},
  layoutDraft: null,
  theme: getInitialTheme(),
  brainstateOverlay: true,
  showHypnogram: false,
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
  workspaceObjects: [],
  setWorkspaceObjects: (objs) => set({ workspaceObjects: objs }),
  setObjectVisible: (id, visible) =>
    set((s) => ({
      workspaceObjects: s.workspaceObjects.map((o) =>
        o.id === id ? { ...o, visible } : o,
      ),
    })),
  objectLayoutMode: "single",
  setObjectLayoutMode: (m) => set({ objectLayoutMode: m }),
  psdFmax: 100,
  psdNW: 4,
  psdWindowS: 1,
  psdLockToEvent: false,
  freqLogScale: false,
  setPsdFmax: (value) => set({ psdFmax: value }),
  setPsdNW: (value) => set({ psdNW: value }),
  setPsdWindowS: (value) => set({ psdWindowS: value }),
  togglePsdLockToEvent: () => set((s) => ({ psdLockToEvent: !s.psdLockToEvent })),
  toggleFreqLogScale: () => set((s) => ({ freqLogScale: !s.freqLogScale })),
  bandPreset: "off",
  bandCustom: [11, 16],
  setBandPreset: (preset) => set({ bandPreset: preset }),
  setBandCustom: (lo, hi) => set({ bandCustom: [lo, hi] }),
  tsFirstChannel: 0,
  setTsFirstChannel: (idx) => set({ tsFirstChannel: Math.max(0, Math.floor(idx)) }),
  scrollChannels: (delta, total, nVisible) =>
    set((s) => {
      const maxStart = Math.max(0, total - nVisible);
      const next = Math.max(0, Math.min(maxStart, s.tsFirstChannel + delta));
      return next === s.tsFirstChannel ? s : { tsFirstChannel: next };
    }),
}));
