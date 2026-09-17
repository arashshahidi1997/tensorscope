import type { SpatialCell } from "../../api/arrow";
import { unmaskedCellRange } from "./colorRange";
import type { SpatialCellWithId } from "./SpatialRenderer";

/** Everything the spatial-map renderer derives from one slice payload. */
export interface SpatialGridDerived {
  cells: SpatialCellWithId[];
  nAP: number;
  nML: number;
  minValue: number;
  maxValue: number;
}

export const EMPTY_SPATIAL_GRID: SpatialGridDerived = {
  cells: [],
  nAP: 0,
  nML: 0,
  minValue: 0,
  maxValue: 1,
};

/**
 * Pure derivation of the spatial grid's render inputs from decoded cells.
 *
 * Extracted from `SpatialMapSliceView` so the decode → id/extents/color-range
 * work is (a) unit-testable without a canvas and (b) memoisable — previously
 * it re-ran on every render (hover included) and wrote refs during render,
 * the exact pattern class behind the "Maximum update depth exceeded" cascade
 * documented in WorkspaceMain's navigator render-prop note.
 *
 * The color range excludes masked channels so one bad channel doesn't wash
 * out the colormap (mask ids share the grid's flat-id convention).
 */
export function deriveSpatialGrid(
  rawCells: SpatialCell[],
  maskedSet?: Set<number>,
): SpatialGridDerived {
  if (rawCells.length === 0) return EMPTY_SPATIAL_GRID;
  const nML = Math.max(...rawCells.map((c) => c.ml)) + 1;
  const nAP = Math.max(...rawCells.map((c) => c.ap)) + 1;
  const [minValue, maxValue] = unmaskedCellRange(rawCells, nML, maskedSet);
  const cells = rawCells.map((c) => ({
    id: c.ap * nML + c.ml,
    apIdx: c.ap,
    mlIdx: c.ml,
    value: c.value,
  }));
  return { cells, nAP, nML, minValue, maxValue };
}
