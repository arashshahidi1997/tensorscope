/**
 * Stable slot-based view layout.
 *
 * Each view type has a permanent "home slot" in a row-based layout.
 * Toggling a view shows/hides it in its slot without reflowing siblings.
 */
import type { ViewSlotLayout, ViewRow, ViewSlot } from "../../store/layoutStore";

export type { ViewSlotLayout, ViewRow, ViewSlot };

/**
 * Overview layout (the default) — the rebalanced "see the tensor spatially AND
 * temporally" arrangement (docs/design/panel-layout-redesign.md). Signal row
 * gives the spatial map near-equal weight (40%, was 25%); the spectral row
 * pairs the spectrogram with the *spatial* frequency view (psd_spatial) instead
 * of the full PSD trio (that lives in the `spectral` preset). raster / event /
 * trajectory rows auto-collapse when their data is absent.
 */
export const DEFAULT_SLOT_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "signal",
      label: "Signal",
      slots: [
        { viewId: "timeseries", region: "left", widthFraction: 0.6 },
        { viewId: "spatial_map", region: "right", widthFraction: 0.4 },
        // depth_map is the linear-probe (Neuropixels) analogue of spatial_map;
        // a tensor is grid OR linear, so they never both appear — share the slot.
        { viewId: "depth_map", region: "right", widthFraction: 0.4 },
      ],
      minHeight: 260,
    },
    {
      id: "spectral",
      label: "Spectral",
      slots: [
        // Precomputed `spectrogram` (4-D) OR live multitaper `spectrogram_live`
        // (3-D LFP) — mutually exclusive, share the left slot.
        { viewId: "spectrogram", region: "left", widthFraction: 0.65 },
        { viewId: "spectrogram_live", region: "left", widthFraction: 0.65 },
        // The *spatial* frequency view sits beside the spectrogram so frequency
        // and space are read together (the full PSD trio is in the `spectral` preset).
        { viewId: "psd_spatial", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 240,
    },
    {
      id: "raster",
      label: "Raster",
      slots: [{ viewId: "raster", region: "left", widthFraction: 1.0 }],
      minHeight: 220,
    },
    {
      id: "event",
      label: "Event",
      slots: [{ viewId: "event_average", region: "left", widthFraction: 1.0 }],
      minHeight: 220,
    },
    {
      id: "trajectory",
      label: "Trajectory",
      slots: [{ viewId: "trajectory", region: "left", widthFraction: 1.0 }],
      minHeight: 260,
    },
  ],
};

/**
 * Signal + Space — spatial emphasis: traces and the electrode map near-equal,
 * with the propagation *movie* (spatial dynamics over time) below.
 */
export const SIGNAL_SPACE_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "signal",
      label: "Signal",
      slots: [
        { viewId: "timeseries", region: "left", widthFraction: 0.55 },
        { viewId: "spatial_map", region: "right", widthFraction: 0.45 },
        { viewId: "depth_map", region: "right", widthFraction: 0.45 },
      ],
      minHeight: 280,
    },
    {
      id: "dynamics",
      label: "Spatial dynamics",
      slots: [{ viewId: "propagation_frame", region: "left", widthFraction: 1.0 }],
      minHeight: 280,
    },
  ],
};

/**
 * Spectral — the frequency deep-dive; the only place the full PSD trio
 * (heatmap + curve + spatial) and the precomputed `psd_average` live.
 */
export const SPECTRAL_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "tf",
      label: "Time–frequency",
      slots: [
        { viewId: "spectrogram", region: "left", widthFraction: 1.0 },
        { viewId: "spectrogram_live", region: "left", widthFraction: 1.0 },
      ],
      minHeight: 240,
    },
    {
      id: "psd",
      label: "PSD",
      slots: [
        { viewId: "psd_heatmap", region: "left", widthFraction: 0.5 },
        // psd_curve (live) and psd_average (precomputed) are mutually exclusive
        // power-vs-freq curves — share the center slot.
        { viewId: "psd_curve", region: "center", widthFraction: 0.25 },
        { viewId: "psd_average", region: "center", widthFraction: 0.25 },
        { viewId: "psd_spatial", region: "right", widthFraction: 0.25 },
      ],
      minHeight: 240,
    },
  ],
};

/**
 * Events — review/triggered-stats: traces with the event overlay, plus the
 * event-triggered average beside the raster.
 */
export const EVENTS_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "signal",
      label: "Signal",
      slots: [{ viewId: "timeseries", region: "left", widthFraction: 1.0 }],
      minHeight: 260,
    },
    {
      id: "triggered",
      label: "Triggered",
      slots: [
        { viewId: "event_average", region: "left", widthFraction: 0.6 },
        { viewId: "raster", region: "right", widthFraction: 0.4 },
      ],
      minHeight: 240,
    },
  ],
};

/**
 * Multi-probe "Probe lanes" layout (Track C3, D-LAYOUT): ecog + neuropixels on
 * the shared time axis. Three rows — cortex (ecog timeseries + its event
 * overlay), hippocampus (npx depth map + npx timeseries), and both
 * spectrograms. The `_npx` slots reuse a view type a second time (distinct
 * slotId) and are routed to the neuropixels tensor via PROBE_LANES_OVERRIDES.
 */
export const PROBE_LANES_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "cortex",
      label: "Cortex (ECoG)",
      slots: [
        { slotId: "timeseries", viewId: "timeseries", region: "left", widthFraction: 0.65 },
        { slotId: "spatial_map", viewId: "spatial_map", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 240,
    },
    {
      id: "hippocampus",
      label: "Hippocampus (Neuropixels)",
      slots: [
        { slotId: "depth_map", viewId: "depth_map", region: "left", widthFraction: 0.35 },
        { slotId: "timeseries_npx", viewId: "timeseries", region: "right", widthFraction: 0.65 },
      ],
      minHeight: 240,
    },
    {
      id: "spectra",
      label: "Spectra",
      slots: [
        { slotId: "spectrogram_live", viewId: "spectrogram_live", region: "left", widthFraction: 0.5 },
        { slotId: "spectrogram_npx", viewId: "spectrogram_live", region: "right", widthFraction: 0.5 },
      ],
      minHeight: 220,
    },
  ],
};

/** Resolve a slot's stable identity (defaults to its viewId). */
export function slotKey(slot: ViewSlot): string {
  return slot.slotId ?? slot.viewId;
}

/**
 * The selectable grid layouts (docs/design/panel-layout-redesign.md). Keyed by
 * `GridLayoutId` (appStore). `ViewGrid` renders `GRID_LAYOUTS[gridLayout]`; the
 * active-view set is scoped to the chosen layout's slots in WorkspaceMain.
 */
export const GRID_LAYOUTS: Record<string, ViewSlotLayout> = {
  default: DEFAULT_SLOT_LAYOUT,
  signal_space: SIGNAL_SPACE_LAYOUT,
  spectral: SPECTRAL_LAYOUT,
  events: EVENTS_LAYOUT,
  probe_lanes: PROBE_LANES_LAYOUT,
};

/** Human labels + descriptions for the layout picker. `probe_lanes` is gated on ≥2 tensors. */
export const GRID_LAYOUT_OPTIONS: { id: string; label: string; description: string; multiProbe?: boolean }[] = [
  { id: "default", label: "Overview", description: "Signal + spatial map + spectrogram & spatial PSD." },
  { id: "signal_space", label: "Signal + Space", description: "Traces and electrode map co-equal, plus the propagation movie." },
  { id: "spectral", label: "Spectral", description: "Spectrogram + the full PSD set (heatmap / curve / spatial)." },
  { id: "events", label: "Events", description: "Traces with event overlay + event-triggered average & raster." },
  { id: "probe_lanes", label: "Probe lanes", description: "ECoG + Neuropixels on a shared time axis (multi-probe).", multiProbe: true },
];

/** View ids slotted by a layout, intersected with availability → the active set for that preset. */
export function layoutViewIds(layoutId: string): Set<string> {
  return getSlottedViewIds(GRID_LAYOUTS[layoutId] ?? DEFAULT_SLOT_LAYOUT);
}

/**
 * Check if a row has any active views.
 */
export function isRowActive(row: ViewRow, activeViewIds: string[]): boolean {
  return row.slots.some((slot) => activeViewIds.includes(slot.viewId));
}

/**
 * Find the row containing a given view ID.
 */
export function findRowForView(layout: ViewSlotLayout, viewId: string): ViewRow | undefined {
  return layout.rows.find((row) => row.slots.some((s) => s.viewId === viewId));
}

/**
 * Get all view IDs that are defined in the slot layout (for determining
 * which views have a slot vs. which would go to overflow).
 */
export function getSlottedViewIds(layout: ViewSlotLayout): Set<string> {
  const ids = new Set<string>();
  for (const row of layout.rows) {
    for (const slot of row.slots) {
      ids.add(slot.viewId);
    }
  }
  return ids;
}

/**
 * Returns view IDs that are active but not assigned to any slot in the layout.
 */
export function getOverflowViews(activeViewIds: string[], layout: ViewSlotLayout): string[] {
  const slotted = getSlottedViewIds(layout);
  return activeViewIds.filter((id) => id !== "navigator" && !slotted.has(id));
}
