/**
 * Pure geometry helpers for the trajectory view — axis-pair enumeration, the
 * cursor's nearest-time lookup, and click→nearest-sample seeking. Extracted so
 * they're unit-tested directly (the view itself draws to canvas, which jsdom
 * can't render).
 */
import type { Trajectory } from "../../api/arrow";

export type AxisPair = { a: string; b: string; label: string };

/** All 2-axis projections for the present axes, in (a,b) combination order. */
export function availableAxisPairs(axes: string[]): AxisPair[] {
  const pairs: AxisPair[] = [];
  for (let i = 0; i < axes.length; i++) {
    for (let j = i + 1; j < axes.length; j++) {
      pairs.push({ a: axes[i], b: axes[j], label: `${axes[i]}–${axes[j]}` });
    }
  }
  return pairs;
}

/** Index of the time sample closest to `t` (−1 if empty). Assumes ascending times. */
export function nearestTimeIndex(times: number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  if (t <= times[lo]) return lo;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] === t) return mid;
    if (times[mid] < t) lo = mid;
    else hi = mid;
  }
  return t - times[lo] <= times[hi] - t ? lo : hi;
}

/** Min/max of a numeric array, padded for a flat/empty series. */
export function axisExtent(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  return [lo, hi];
}

/**
 * Index of the path sample nearest a point in the (a, b) data plane. Distances
 * are normalized by each axis's extent so the pick isn't dominated by whichever
 * axis happens to have the larger units.
 */
export function nearestSampleInPlane(
  traj: Trajectory,
  a: string,
  b: string,
  px: number,
  py: number,
): number {
  const xs = traj.byAxis[a];
  const ys = traj.byAxis[b];
  if (!xs || !ys || traj.times.length === 0) return -1;
  const [ax0, ax1] = axisExtent(xs);
  const [ay0, ay1] = axisExtent(ys);
  const sx = ax1 - ax0 || 1;
  const sy = ay1 - ay0 || 1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < traj.times.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dx = (x - px) / sx;
    const dy = (y - py) / sy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
