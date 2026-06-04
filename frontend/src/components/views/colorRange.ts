/**
 * Colormap range helpers that exclude masked channels.
 *
 * A masked (bad/noisy) channel must not drive the color normalization — its
 * large amplitude would otherwise wash out the colormap for the good channels.
 * So the value→color range is computed over UNMASKED channels only. When every
 * channel is masked (degenerate), we fall back to the full set so the view
 * still paints something. NaN-safe.
 */

/** A grid/spatial cell with its row/col indices and value. */
type Cell = { ap: number; ml: number; value: number };

/**
 * [min, max] over cells whose flat id (`ap * nML + ml`, matching the mask key)
 * is NOT masked. Falls back to all finite values when none survive.
 */
export function unmaskedCellRange(
  cells: Cell[],
  nML: number,
  maskedSet?: Set<number> | null,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const c of cells) {
    if (!Number.isFinite(c.value)) continue;
    if (maskedSet && maskedSet.has(c.ap * nML + c.ml)) continue;
    n += 1;
    if (c.value < min) min = c.value;
    if (c.value > max) max = c.value;
  }
  if (n === 0) {
    // Every cell masked (or empty) → use the full finite set so the view still paints.
    for (const c of cells) {
      if (!Number.isFinite(c.value)) continue;
      if (c.value < min) min = c.value;
      if (c.value > max) max = c.value;
      n += 1;
    }
  }
  if (n === 0) return [0, 1];
  return [min, max];
}

/**
 * Robust [lo, hi] = [pLow, pHigh] percentiles of the finite values in the rows
 * whose channel id is NOT masked (for the raster / depth × time image). `values`
 * is row-major [row * nTime + col]; `channels[row]` is that row's channel id.
 */
export function unmaskedRasterRange(
  values: ArrayLike<number>,
  channels: number[],
  nTime: number,
  maskedSet?: Set<number> | null,
  pLow = 0.02,
  pHigh = 0.98,
): [number, number] {
  const collect = (respectMask: boolean): number[] => {
    const out: number[] = [];
    for (let r = 0; r < channels.length; r++) {
      if (respectMask && maskedSet && maskedSet.has(channels[r])) continue;
      const base = r * nTime;
      for (let c = 0; c < nTime; c++) {
        const v = values[base + c];
        if (Number.isFinite(v)) out.push(v);
      }
    }
    return out;
  };
  let finite = maskedSet && maskedSet.size > 0 ? collect(true) : collect(false);
  if (finite.length === 0) finite = collect(false); // all masked → fall back
  if (finite.length === 0) return [0, 1];
  finite.sort((a, b) => a - b);
  const lo = finite[Math.floor(finite.length * pLow)];
  const hi = finite[Math.floor(finite.length * pHigh)];
  return lo < hi ? [lo, hi] : [finite[0], finite[finite.length - 1] || finite[0] + 1];
}
