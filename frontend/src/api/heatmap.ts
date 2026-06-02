/**
 * Generic N-D → 2-D heatmap pivot.
 *
 * The v1 wire is long-format (one row per cell, one column per dim + `value`),
 * so any slice is already a tidy table. This lets a single HeatmapView render
 * ANY pair of dims as axes — the user picks which dim → X and which → Y, and
 * the remaining dims are reduced (mean/max) into the color value. Orientation
 * becomes a per-panel setting instead of a hardcoded render loop.
 *
 * See docs/design/encoding-heatmap.md.
 */
import { type DecodedSlice, toNumber } from "./arrow";

export type HeatmapReduce = "mean" | "max";

export type HeatmapEncoding = {
  /** Dim/column name → X axis. */
  x: string;
  /** Dim/column name → Y axis. */
  y: string;
  /** Reduction applied to every dim other than x/y. Default "mean". */
  reduce?: HeatmapReduce;
};

export type HeatmapGrid = {
  xDim: string;
  yDim: string;
  /** Sorted unique X coord values (band cells). */
  xVals: number[];
  /** Sorted unique Y coord values. */
  yVals: number[];
  /** Row-major [yIdx * nx + xIdx], reduced over all other dims; NaN if empty. */
  values: Float64Array;
  nx: number;
  ny: number;
  /** Numeric dim columns the user may assign to an axis (excludes `value`). */
  availableDims: string[];
  /** Dims that were reduced away (everything except x/y), for UI disclosure. */
  reducedDims: string[];
};

const EMPTY: HeatmapGrid = {
  xDim: "", yDim: "", xVals: [], yVals: [], values: new Float64Array(0),
  nx: 0, ny: 0, availableDims: [], reducedDims: [],
};

/** Numeric dim columns available to assign to axes (all columns except value). */
export function heatmapDims(decoded: DecodedSlice): string[] {
  return decoded.columns.filter((c) => c !== "value");
}

/**
 * Pivot a long-format slice into a dense 2-D grid for `encoding.{x,y}`,
 * reducing all other dim columns by `encoding.reduce` (default mean).
 */
export function extractHeatmapND(
  decoded: DecodedSlice,
  encoding: HeatmapEncoding,
): HeatmapGrid {
  const { x: xDim, y: yDim, reduce = "mean" } = encoding;
  const cols = decoded.columns;
  if (!cols.includes("value") || !cols.includes(xDim) || !cols.includes(yDim) || xDim === yDim) {
    return EMPTY;
  }
  const availableDims = heatmapDims(decoded);
  const reducedDims = availableDims.filter((d) => d !== xDim && d !== yDim);

  // Pass 1: collect unique x/y coord values.
  const xSet = new Set<number>();
  const ySet = new Set<number>();
  for (const row of decoded.rows) {
    const xv = toNumber(row[xDim]);
    const yv = toNumber(row[yDim]);
    if (xv === null || yv === null) continue;
    xSet.add(xv);
    ySet.add(yv);
  }
  if (xSet.size === 0 || ySet.size === 0) return EMPTY;

  const xVals = Array.from(xSet).sort((a, b) => a - b);
  const yVals = Array.from(ySet).sort((a, b) => a - b);
  const xIdx = new Map(xVals.map((v, i) => [v, i]));
  const yIdx = new Map(yVals.map((v, i) => [v, i]));
  const nx = xVals.length;
  const ny = yVals.length;

  // Pass 2: accumulate the reduction per (x,y) cell.
  const sums = new Float64Array(nx * ny);
  const counts = new Int32Array(nx * ny);
  const maxs = new Float64Array(nx * ny).fill(-Infinity);
  for (const row of decoded.rows) {
    const xv = toNumber(row[xDim]);
    const yv = toNumber(row[yDim]);
    const v = toNumber(row.value);
    if (xv === null || yv === null || v === null) continue;
    const cell = yIdx.get(yv)! * nx + xIdx.get(xv)!;
    counts[cell]++;
    sums[cell] += v;
    if (v > maxs[cell]) maxs[cell] = v;
  }

  const values = new Float64Array(nx * ny);
  for (let i = 0; i < values.length; i++) {
    if (counts[i] === 0) {
      values[i] = NaN;
    } else if (reduce === "max") {
      values[i] = maxs[i];
    } else {
      values[i] = sums[i] / counts[i];
    }
  }

  return { xDim, yDim, xVals, yVals, values, nx, ny, availableDims, reducedDims };
}
