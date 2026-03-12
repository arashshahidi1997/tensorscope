/**
 * Auto-layout logic for the view grid.
 *
 * Given a list of active view IDs, computes a default ViewGridLayout
 * that arranges them in a CSS grid (max 2x2). Views beyond 4 go into
 * an overflow area (not assigned to grid cells).
 */
import type { ViewGridLayout, GridCell } from "../../store/layoutStore";
import { VIEW_DESCRIPTORS } from "../../registry/viewRegistry";

const SPATIAL_VIEW_IDS = new Set(["spatial_map", "psd_spatial", "propagation_frame"]);

function isSpatial(viewId: string): boolean {
  return SPATIAL_VIEW_IDS.has(viewId);
}

function getPriority(viewId: string): number {
  const desc = VIEW_DESCRIPTORS.find((d) => d.id === viewId);
  return desc?.priority ?? 99;
}

/**
 * Sort view IDs by their ViewDescriptor priority (lower = first).
 */
function sortByPriority(viewIds: string[]): string[] {
  return [...viewIds].sort((a, b) => getPriority(a) - getPriority(b));
}

/**
 * Compute a default grid layout for the given active view IDs.
 *
 * Rules:
 * - 1 view -> 1x1
 * - 2 views, one spatial -> 1x2 (temporal left, spatial right)
 * - 2 views, both temporal -> 2x1
 * - 3-4 views -> 2x2
 * - >4 views -> 2x2 for first 4, rest overflow (not in cells)
 */
export function computeDefaultGrid(activeViewIds: string[]): ViewGridLayout {
  // Exclude navigator from grid — it goes to bottom panel or stays separate
  const gridViews = activeViewIds.filter((id) => id !== "navigator");
  const sorted = sortByPriority(gridViews);

  if (sorted.length === 0) {
    return { columns: 1, rows: 1, cells: [], colWidths: [1], rowHeights: [1] };
  }

  if (sorted.length === 1) {
    return {
      columns: 1,
      rows: 1,
      cells: [{ viewId: sorted[0], row: 0, col: 0 }],
      colWidths: [1],
      rowHeights: [1],
    };
  }

  if (sorted.length === 2) {
    const hasSpatialView = sorted.some(isSpatial);
    if (hasSpatialView) {
      // 1x2: temporal left, spatial right
      const spatialIdx = sorted.findIndex(isSpatial);
      const temporalIdx = spatialIdx === 0 ? 1 : 0;
      return {
        columns: 2,
        rows: 1,
        cells: [
          { viewId: sorted[temporalIdx], row: 0, col: 0 },
          { viewId: sorted[spatialIdx], row: 0, col: 1 },
        ],
        colWidths: [0.65, 0.35],
        rowHeights: [1],
      };
    }
    // Both temporal: 2x1
    return {
      columns: 1,
      rows: 2,
      cells: [
        { viewId: sorted[0], row: 0, col: 0 },
        { viewId: sorted[1], row: 1, col: 0 },
      ],
      colWidths: [1],
      rowHeights: [0.5, 0.5],
    };
  }

  // 3-4+ views: 2x2 grid
  const cells: GridCell[] = [];
  const topN = sorted.slice(0, 4);
  const positions: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];

  if (topN.length === 3) {
    // 3 views: first two in top row, third spans bottom row
    cells.push({ viewId: topN[0], row: 0, col: 0 });
    cells.push({ viewId: topN[1], row: 0, col: 1 });
    cells.push({ viewId: topN[2], row: 1, col: 0, colSpan: 2 });
  } else {
    for (let i = 0; i < topN.length; i++) {
      cells.push({ viewId: topN[i], row: positions[i][0], col: positions[i][1] });
    }
  }

  return {
    columns: 2,
    rows: 2,
    cells,
    colWidths: [0.5, 0.5],
    rowHeights: [0.5, 0.5],
  };
}

/**
 * Returns view IDs that are in activeViewIds but not assigned to any grid cell.
 */
export function getOverflowViews(activeViewIds: string[], grid: ViewGridLayout): string[] {
  const assignedIds = new Set(grid.cells.map((c) => c.viewId));
  return activeViewIds.filter((id) => id !== "navigator" && !assignedIds.has(id));
}
