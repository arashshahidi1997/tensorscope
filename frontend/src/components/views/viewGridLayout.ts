/**
 * Stable slot-based view layout.
 *
 * Each view type has a permanent "home slot" in a row-based layout.
 * Toggling a view shows/hides it in its slot without reflowing siblings.
 */
import type { ViewSlotLayout, ViewRow, ViewSlot } from "../../store/layoutStore";

export type { ViewSlotLayout, ViewRow, ViewSlot };

/**
 * Default slot assignments — three rows covering signal, PSD, and spectrogram layers.
 */
export const DEFAULT_SLOT_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "signal",
      label: "Signal",
      slots: [
        { viewId: "timeseries", region: "left", widthFraction: 0.75 },
        { viewId: "spatial_map", region: "right", widthFraction: 0.25 },
        // depth_map is the linear-probe (Neuropixels) analogue of spatial_map;
        // a tensor is grid OR linear, so they never both appear — share the slot.
        { viewId: "depth_map", region: "right", widthFraction: 0.25 },
      ],
      minHeight: 260,
    },
    {
      id: "psd",
      label: "PSD",
      slots: [
        { viewId: "psd_heatmap", region: "left", widthFraction: 0.45 },
        { viewId: "psd_curve", region: "center", widthFraction: 0.3 },
        { viewId: "psd_spatial", region: "right", widthFraction: 0.25 },
      ],
      minHeight: 220,
    },
    {
      id: "spectrogram",
      label: "Spectrogram",
      slots: [
        // Either the precomputed `spectrogram` (4-D tensors w/ a freq dim)
        // OR the live multitaper `spectrogram_live` (3-D LFP, computed
        // server-side via ghostipy + np.apply_along_axis). Both occupy
        // the same row-left slot — they're mutually exclusive at the
        // tensor level so only one is populated per render.
        { viewId: "spectrogram", region: "left", widthFraction: 0.75 },
        { viewId: "spectrogram_live", region: "left", widthFraction: 0.75 },
        { viewId: "propagation_frame", region: "right", widthFraction: 0.25 },
      ],
      minHeight: 220,
    },
    {
      id: "raster",
      label: "Raster",
      slots: [
        // channel × time amplitude heatmap — full width, its own row.
        { viewId: "raster", region: "left", widthFraction: 1.0 },
      ],
      minHeight: 220,
    },
    {
      id: "event",
      label: "Event",
      slots: [
        { viewId: "event_average", region: "left", widthFraction: 1.0 },
      ],
      minHeight: 220,
    },
    {
      id: "trajectory",
      label: "Trajectory",
      slots: [
        // 2-D behavioral position path (time, axis) — its own row.
        { viewId: "trajectory", region: "left", widthFraction: 1.0 },
      ],
      minHeight: 260,
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
