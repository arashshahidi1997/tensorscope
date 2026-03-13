import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarTabId = "explore" | "graph" | "tensors" | "events" | "pipeline";

export type ViewSlot = {
  viewId: string;
  region: "left" | "right" | "center";
  widthFraction: number; // e.g. 0.65
};

export type ViewRow = {
  id: string;          // "signal", "psd", "spectrogram"
  label: string;
  slots: ViewSlot[];
  minHeight: number;   // px, when row is visible
};

export type ViewSlotLayout = {
  rows: ViewRow[];
};

// Keep old types as aliases for backward compat with layoutPresets
export type GridCell = {
  viewId: string;
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
};

export type ViewGridLayout = {
  columns: number;
  rows: number;
  cells: GridCell[];
  colWidths: number[];
  rowHeights: number[];
};

export type LayoutState = {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarTab: SidebarTabId;
  inspectorWidth: number;
  inspectorCollapsed: boolean;
  bottomPanelHeight: number;
  bottomPanelCollapsed: boolean;
  viewGridLayout: ViewGridLayout | null;
  maximizedView: string | null;
  activePreset: string | null;
};

type LayoutActions = {
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setActiveSidebarTab: (tab: SidebarTabId) => void;
  setInspectorWidth: (width: number) => void;
  toggleInspector: () => void;
  setBottomPanelHeight: (height: number) => void;
  toggleBottomPanel: () => void;
  setViewGridLayout: (layout: ViewGridLayout | null) => void;
  setMaximizedView: (viewId: string | null) => void;
  toggleMaximizeView: (viewId: string) => void;
  applyPreset: (preset: {
    sidebarWidth: number;
    sidebarCollapsed: boolean;
    activeSidebarTab: string;
    inspectorWidth: number;
    inspectorCollapsed: boolean;
    bottomPanelHeight: number;
    bottomPanelCollapsed: boolean;
    viewGridLayout: ViewGridLayout | null;
  }, presetId: string) => void;
};

const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 480;
const INSPECTOR_MIN = 200;
const INSPECTOR_MAX = 500;
const BOTTOM_MIN = 100;

function clampSidebar(w: number): number {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w));
}

function clampInspector(w: number): number {
  return Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, w));
}

function clampBottom(h: number): number {
  const maxH = typeof window !== "undefined" ? window.innerHeight * 0.5 : 400;
  return Math.max(BOTTOM_MIN, Math.min(maxH, h));
}

export const useLayoutStore = create<LayoutState & LayoutActions>()(
  persist(
    (set) => ({
      sidebarWidth: 260,
      sidebarCollapsed: false,
      activeSidebarTab: "explore",
      inspectorWidth: 260,
      inspectorCollapsed: false,
      bottomPanelHeight: 120,
      bottomPanelCollapsed: false,
      viewGridLayout: null,
      maximizedView: null,
      activePreset: null,

      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebar(width), activePreset: null }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed, activePreset: null })),
      setActiveSidebarTab: (tab) =>
        set((s) => {
          if (s.activeSidebarTab === tab) {
            return { sidebarCollapsed: !s.sidebarCollapsed, activePreset: null };
          }
          return { activeSidebarTab: tab, sidebarCollapsed: false, activePreset: null };
        }),
      setInspectorWidth: (width) => set({ inspectorWidth: clampInspector(width), activePreset: null }),
      toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed, activePreset: null })),
      setBottomPanelHeight: (height) => set({ bottomPanelHeight: clampBottom(height), activePreset: null }),
      toggleBottomPanel: () => set((s) => ({ bottomPanelCollapsed: !s.bottomPanelCollapsed, activePreset: null })),
      setViewGridLayout: (layout) => set({ viewGridLayout: layout, activePreset: null }),
      setMaximizedView: (viewId) => set({ maximizedView: viewId }),
      toggleMaximizeView: (viewId) =>
        set((s) => ({ maximizedView: s.maximizedView === viewId ? null : viewId })),
      applyPreset: (preset, presetId) =>
        set({
          sidebarWidth: clampSidebar(preset.sidebarWidth),
          sidebarCollapsed: preset.sidebarCollapsed,
          activeSidebarTab: preset.activeSidebarTab as SidebarTabId,
          inspectorWidth: clampInspector(preset.inspectorWidth),
          inspectorCollapsed: preset.inspectorCollapsed,
          bottomPanelHeight: clampBottom(preset.bottomPanelHeight),
          bottomPanelCollapsed: preset.bottomPanelCollapsed,
          viewGridLayout: preset.viewGridLayout,
          maximizedView: null,
          activePreset: presetId,
        }),
    }),
    {
      name: "tensorscope:layout",
      version: 1,
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        activeSidebarTab: state.activeSidebarTab,
        inspectorWidth: state.inspectorWidth,
        inspectorCollapsed: state.inspectorCollapsed,
        bottomPanelHeight: state.bottomPanelHeight,
        bottomPanelCollapsed: state.bottomPanelCollapsed,
        viewGridLayout: state.viewGridLayout,
        activePreset: state.activePreset,
        // Do NOT persist maximizedView — always start un-maximized
      }),
    },
  ),
);
