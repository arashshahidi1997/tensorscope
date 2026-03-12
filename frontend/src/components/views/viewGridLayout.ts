/**
 * Stable slot-based view layout.
 *
 * Each view type has a permanent "home slot" in a row-based layout.
 * Toggling a view shows/hides it in its slot without reflowing siblings.
 */
import type { ViewSlotLayout, ViewRow } from "../../store/layoutStore";

export type { ViewSlotLayout, ViewRow };
export type { ViewSlot } from "../../store/layoutStore";

/**
 * Default slot assignments — three rows covering signal, PSD, and spectrogram layers.
 */
export const DEFAULT_SLOT_LAYOUT: ViewSlotLayout = {
  rows: [
    {
      id: "signal",
      label: "Signal",
      slots: [
        { viewId: "timeseries", region: "left", widthFraction: 0.65 },
        { viewId: "spatial_map", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 260,
    },
    {
      id: "psd",
      label: "PSD",
      slots: [
        { viewId: "psd_heatmap", region: "left", widthFraction: 0.4 },
        { viewId: "psd_curve", region: "center", widthFraction: 0.25 },
        { viewId: "psd_spatial", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 220,
    },
    {
      id: "spectrogram",
      label: "Spectrogram",
      slots: [
        { viewId: "spectrogram", region: "left", widthFraction: 0.65 },
        { viewId: "propagation_frame", region: "right", widthFraction: 0.35 },
      ],
      minHeight: 220,
    },
  ],
};

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
