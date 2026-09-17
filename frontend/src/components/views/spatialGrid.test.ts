import { describe, expect, it } from "vitest";
import { deriveSpatialGrid, EMPTY_SPATIAL_GRID } from "./spatialGrid";
import type { SpatialCell } from "../../api/arrow";

const cell = (ap: number, ml: number, value: number): SpatialCell => ({ ap, ml, value });

describe("deriveSpatialGrid", () => {
  it("returns the shared empty sentinel for no cells", () => {
    expect(deriveSpatialGrid([])).toBe(EMPTY_SPATIAL_GRID);
  });

  it("derives extents, flat ids, and value range", () => {
    const grid = deriveSpatialGrid([
      cell(0, 0, 1),
      cell(0, 1, 5),
      cell(1, 0, -2),
      cell(1, 1, 3),
    ]);
    expect(grid.nAP).toBe(2);
    expect(grid.nML).toBe(2);
    // Flat id convention matches the renderer's hitTest: ap * nML + ml.
    expect(grid.cells.map((c) => c.id)).toEqual([0, 1, 2, 3]);
    expect(grid.minValue).toBe(-2);
    expect(grid.maxValue).toBe(5);
  });

  it("excludes masked channels from the color range but keeps their cells", () => {
    const grid = deriveSpatialGrid(
      [cell(0, 0, 1), cell(0, 1, 1000), cell(1, 0, -3)],
      new Set([1]), // masks (ap=0, ml=1) → id 0*nML+1 = 1
    );
    expect(grid.minValue).toBe(-3);
    expect(grid.maxValue).toBe(1);
    expect(grid.cells).toHaveLength(3);
  });

  it("handles sparse ap/ml indices (extent = max index + 1)", () => {
    const grid = deriveSpatialGrid([cell(3, 5, 0.5)]);
    expect(grid.nAP).toBe(4);
    expect(grid.nML).toBe(6);
    expect(grid.cells[0].id).toBe(3 * 6 + 5);
  });
});
