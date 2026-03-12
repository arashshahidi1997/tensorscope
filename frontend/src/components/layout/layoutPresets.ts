import type { ViewGridLayout } from "../../store/layoutStore";

export type LayoutPreset = {
  id: string;
  label: string;
  description: string;
  layout: {
    sidebarWidth: number;
    sidebarCollapsed: boolean;
    activeSidebarTab: string;
    inspectorWidth: number;
    inspectorCollapsed: boolean;
    bottomPanelHeight: number;
    bottomPanelCollapsed: boolean;
    viewGridLayout: ViewGridLayout | null;
  };
};

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "signal",
    label: "Signal Inspection",
    description: "Detailed time-domain analysis with maximum trace visibility.",
    layout: {
      sidebarWidth: 220,
      sidebarCollapsed: false,
      activeSidebarTab: "explore",
      inspectorWidth: 260,
      inspectorCollapsed: true,
      bottomPanelHeight: 200,
      bottomPanelCollapsed: false,
      viewGridLayout: {
        columns: 1,
        rows: 1,
        cells: [{ viewId: "timeseries", row: 0, col: 0 }],
        colWidths: [1],
        rowHeights: [1],
      },
    },
  },
  {
    id: "spatial",
    label: "Spatial Exploration",
    description: "Spatial and temporal views side-by-side with electrode map prominent.",
    layout: {
      sidebarWidth: 220,
      sidebarCollapsed: false,
      activeSidebarTab: "explore",
      inspectorWidth: 260,
      inspectorCollapsed: false,
      bottomPanelHeight: 200,
      bottomPanelCollapsed: false,
      viewGridLayout: {
        columns: 2,
        rows: 1,
        cells: [
          { viewId: "timeseries", row: 0, col: 0 },
          { viewId: "spatial_map", row: 0, col: 1 },
        ],
        colWidths: [0.65, 0.35],
        rowHeights: [1],
      },
    },
  },
  {
    id: "spectral",
    label: "Spectral Analysis",
    description: "Frequency-domain analysis with spectrogram and PSD visible.",
    layout: {
      sidebarWidth: 220,
      sidebarCollapsed: false,
      activeSidebarTab: "explore",
      inspectorWidth: 260,
      inspectorCollapsed: true,
      bottomPanelHeight: 200,
      bottomPanelCollapsed: false,
      viewGridLayout: {
        columns: 1,
        rows: 2,
        cells: [
          { viewId: "spectrogram", row: 0, col: 0 },
          { viewId: "psd_average", row: 1, col: 0 },
        ],
        colWidths: [1],
        rowHeights: [0.5, 0.5],
      },
    },
  },
  {
    id: "overview",
    label: "Overview",
    description: "Balanced view of all available data types.",
    layout: {
      sidebarWidth: 220,
      sidebarCollapsed: false,
      activeSidebarTab: "explore",
      inspectorWidth: 260,
      inspectorCollapsed: false,
      bottomPanelHeight: 200,
      bottomPanelCollapsed: false,
      viewGridLayout: null,
    },
  },
];

export function getPresetById(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}
