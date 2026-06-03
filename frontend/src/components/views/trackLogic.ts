/**
 * Pure helpers for the context-track stack — extracted so the decision logic
 * (default-visible lanes, range guards, scalar value range) has real coverage
 * even though the lanes themselves render to canvas (which jsdom can't draw).
 */
import type { TrackMetaDTO } from "../../api/types";

/** A track is visible unless explicitly toggled off (missing key = visible). */
export function isTrackVisible(visibility: Record<string, boolean>, name: string): boolean {
  return visibility[name] ?? true;
}

export function visibleTracks(
  tracks: TrackMetaDTO[],
  visibility: Record<string, boolean>,
): TrackMetaDTO[] {
  return tracks.filter((t) => isTrackVisible(visibility, t.name));
}

/** Resolve a finite, non-degenerate [t0, t1] range, or null if unusable. */
export function trackTimeRange(track: TrackMetaDTO): [number, number] | null {
  const [t0, t1] = track.time_range;
  if (typeof t0 !== "number" || typeof t1 !== "number" || t1 <= t0) return null;
  return [t0, t1];
}

/** Min/max of a scalar series, with a safe fallback for empty/flat data. */
export function scalarValueRange(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of values) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [lo - 1, hi + 1];
  return [lo, hi];
}
