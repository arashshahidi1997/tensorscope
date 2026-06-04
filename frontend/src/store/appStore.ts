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
  /**
   * Per-track lane visibility in the context-track stack (brainstate band,
   * speed lane, …). Keyed by track name; a missing key means visible (lanes
   * show by default for a multimodal session). See TrackStack.
   */
  trackVisibility: Record<string, boolean>;
  /** Per-panel tensor overrides: slotId → tensorName */
  panelTensorOverrides: Record<string, string>;
  /** Active view-grid layout (Track C3). "probe_lanes" = the multi-probe preset. */
  gridLayout: GridLayoutId;
  /**
   * Multi-probe mode (Track C5). When on, switching the navigation tensor does
   * NOT wipe the per-slot tensor map / active views — the per-lane overrides (+
   * the fixed probe-lanes layout) are the source of truth.
   */
  multiProbeMode: boolean;
  /**
   * Per-view heatmap axis encoding: viewId → {x, y} dim names. When unset a
   * view uses its default encoding (see HEATMAP_DEFAULT_ENCODING). Lets the
   * user reassign which data dim is on which axis, live. See
   * docs/design/encoding-heatmap.md.
   */
  heatmapEncodings: Record<string, { x: string; y: string }>;
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
   * Spectrogram-live frequency range + window length. These are the only
   * frontend control over the `spectrogram_live` view's band: without them the
   * TF panel was pinned to the server defaults (0.5–30 Hz), making ripples
   * (100–250 Hz) literally unviewable. Threaded into `makeSpectrogramLiveRequest`
   * via `useWorkspaceData` → `spectrogram_live_params`. Defaults mirror the
   * server DTO (`SpectrogramLiveParamsDTO`: fmin 0.5 / fmax 30 / nperseg_s 1.0)
   * so the default render is unchanged. See oscillation-coupling-plan.md A1.
   */
  specFmin: number;
  specFmax: number;
  specNpersegS: number;
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
  /**
   * "Focus on one channel" mode for the timeseries + spectrogram_live
   * views. When non-null, both views slice with ap_range/ml_range
   * restricted to this single cell — the reviewer clicked a spatial
   * cell to drill into that electrode's trace + spectrogram. Click
   * another cell to swap, hit Escape to clear.
   */
  focusChannel: { ap: number; ml: number } | null;
  workspaceObjects: WorkspaceObject[];
  setWorkspaceObjects: (objs: WorkspaceObject[]) => void;
  setObjectVisible: (id: string, visible: boolean) => void;
  objectLayoutMode: "single" | "row" | "column";
  setObjectLayoutMode: (m: "single" | "row" | "column") => void;
  setSelectedTensor: (value: string) => void;
  setPanelTensor: (slotId: string, tensorName: string) => void;
  clearPanelTensor: (slotId: string) => void;
  /** Set the heatmap axis encoding for a view (viewId → {x, y}). */
  setHeatmapAxes: (viewId: string, x: string, y: string) => void;
  toggleView: (view: string, availableViews: string[]) => void;
  setActiveViews: (views: string[]) => void;
  /** Switch the view-grid layout; "probe_lanes" also flips multiProbeMode + seeds npx overrides. */
  setGridLayout: (layout: GridLayoutId) => void;
  setLayoutDraft: (value: LayoutDTO) => void;
  setTheme: (value: ThemeId) => void;
  toggleBrainstateOverlay: () => void;
  /** Flip a context-track lane's visibility (defaults to visible). */
  toggleTrackVisible: (name: string) => void;
  setPsdFmax: (value: number) => void;
  setPsdNW: (value: number) => void;
  setPsdWindowS: (value: number) => void;
  togglePsdLockToEvent: () => void;
  toggleFreqLogScale: () => void;
  setSpecFmin: (value: number) => void;
  setSpecFmax: (value: number) => void;
  setSpecNpersegS: (value: number) => void;
  setBandPreset: (preset: BandPreset) => void;
  setBandCustom: (lo: number, hi: number) => void;
  /**
   * Scroll the channel viewport. Always clamps to [0, max(0, total - nVisible)].
   * Total/nVisible are passed in by the view since the store doesn't know
   * the slice's channel count.
   */
  scrollChannels: (delta: number, total: number, nVisible: number) => void;
  setTsFirstChannel: (idx: number) => void;
  /** Enter / leave focus-channel mode. Pass `null` to clear. */
  setFocusChannel: (coord: { ap: number; ml: number } | null) => void;
};

/** View-grid layout id (Track C3). */
export type GridLayoutId = "default" | "probe_lanes";

/**
 * Default per-slot tensor routing for the "Probe lanes" layout (Track C3):
 * the npx lanes pull from "neuropixels"; the ecog lanes fall back to the
 * global navigation tensor. Slot ids match PROBE_LANES_LAYOUT in
 * viewGridLayout.ts. Tensor names match io.assemble_session's session keys.
 */
export const PROBE_LANES_OVERRIDES: Record<string, string> = {
  depth_map: "neuropixels",
  timeseries_npx: "neuropixels",
  spectrogram_npx: "neuropixels",
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
  gridLayout: "default",
  multiProbeMode: false,
  heatmapEncodings: {},
  layoutDraft: null,
  theme: getInitialTheme(),
  brainstateOverlay: true,
  trackVisibility: {},
  setSelectedTensor: (value) =>
    set((s) =>
      // In multi-probe mode the per-slot tensor map + fixed layout are the
      // source of truth, so a nav-tensor switch keeps them (Track C5).
      s.multiProbeMode
        ? { selectedTensor: value }
        : { selectedTensor: value, activeViews: [], panelTensorOverrides: {} },
    ),
  setGridLayout: (layout) =>
    set(() =>
      layout === "probe_lanes"
        ? {
            gridLayout: "probe_lanes",
            multiProbeMode: true,
            panelTensorOverrides: { ...PROBE_LANES_OVERRIDES },
            // Scope active views to the probe lanes so the focused 3-row layout
            // doesn't dump every other view into the overflow area.
            activeViews: ["timeseries", "spatial_map", "depth_map", "spectrogram_live"],
          }
        : { gridLayout: "default", multiProbeMode: false, panelTensorOverrides: {}, activeViews: [] },
    ),
  setPanelTensor: (slotId, tensorName) =>
    set((s) => ({ panelTensorOverrides: { ...s.panelTensorOverrides, [slotId]: tensorName } })),
  clearPanelTensor: (slotId) =>
    set((s) => {
      const { [slotId]: _, ...rest } = s.panelTensorOverrides;
      return { panelTensorOverrides: rest };
    }),
  setHeatmapAxes: (viewId, x, y) =>
    set((s) => ({ heatmapEncodings: { ...s.heatmapEncodings, [viewId]: { x, y } } })),
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
  toggleTrackVisible: (name) =>
    set((s) => ({
      // Missing key = visible, so the first toggle hides it.
      trackVisibility: { ...s.trackVisibility, [name]: !(s.trackVisibility[name] ?? true) },
    })),
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
  specFmin: 0.5,
  specFmax: 30,
  specNpersegS: 1.0,
  setPsdFmax: (value) => set({ psdFmax: value }),
  setPsdNW: (value) => set({ psdNW: value }),
  setPsdWindowS: (value) => set({ psdWindowS: value }),
  togglePsdLockToEvent: () => set((s) => ({ psdLockToEvent: !s.psdLockToEvent })),
  toggleFreqLogScale: () => set((s) => ({ freqLogScale: !s.freqLogScale })),
  setSpecFmin: (value) => set({ specFmin: value }),
  setSpecFmax: (value) => set({ specFmax: value }),
  setSpecNpersegS: (value) => set({ specNpersegS: value }),
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
  focusChannel: null,
  setFocusChannel: (coord) => set({ focusChannel: coord }),
}));
