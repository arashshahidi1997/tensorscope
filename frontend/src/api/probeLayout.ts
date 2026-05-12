/**
 * Probe-layout helpers (G7).
 *
 * Resolves the per-electrode region annotations served by GET
 * /probe_layout into lookups the spatial map and timeseries views need:
 *
 *   - `regionByFlatId`   — flat id (ap * nML + ml) → region string
 *   - `regionByChannel`  — channel index → region string
 *   - `palette`          — region → distinct hex color (stable per session)
 *
 * The spatial map uses `regionByFlatId` for cell-level overlays; the
 * timeseries view uses `regionByChannel` to append region tags to
 * channel labels.
 */
import type { ProbeLayoutDTO } from "./types";

const REGION_PALETTE = [
  "#7dd3fc",
  "#fca5a5",
  "#86efac",
  "#fcd34d",
  "#c4b5fd",
  "#f9a8d4",
  "#fdba74",
  "#a5f3fc",
  "#fde68a",
  "#bef264",
  "#e9d5ff",
  "#fecdd3",
] as const;

export type RegionResolver = {
  /** flat id (apIdx * nML + mlIdx) → region label, when available. */
  regionByFlatId: Map<number, string>;
  /** channel index → region label, when available. */
  regionByChannel: Map<number, string>;
  /** region label → swatch color (stable across renders for one session). */
  palette: Map<string, string>;
  /** True when no electrode has a region annotation we could use. */
  isEmpty: boolean;
};

const EMPTY_RESOLVER: RegionResolver = {
  regionByFlatId: new Map(),
  regionByChannel: new Map(),
  palette: new Map(),
  isEmpty: true,
};

/**
 * Build a region resolver from a probe-layout DTO.
 *
 * ``nML`` is required to compute a flat id from (ap, ml). Pass the spatial
 * map's column count. When ``layout`` is null/undefined, returns a sentinel
 * empty resolver so callers can wire it through unconditionally.
 */
export function buildRegionResolver(
  layout: ProbeLayoutDTO | null | undefined,
  nML: number,
): RegionResolver {
  if (!layout || layout.electrodes.length === 0) return EMPTY_RESOLVER;
  const regionByFlatId = new Map<number, string>();
  const regionByChannel = new Map<number, string>();
  const regionsInOrder: string[] = [];
  for (const el of layout.electrodes) {
    if (!el.region) continue;
    if (el.channel_id !== null && el.channel_id !== undefined) {
      regionByChannel.set(el.channel_id, el.region);
    }
    if (el.ap !== null && el.ml !== null && el.ap !== undefined && el.ml !== undefined && nML > 0) {
      regionByFlatId.set(el.ap * nML + el.ml, el.region);
    }
    if (!regionsInOrder.includes(el.region)) regionsInOrder.push(el.region);
  }
  const palette = new Map<string, string>();
  regionsInOrder.forEach((region, idx) => {
    palette.set(region, REGION_PALETTE[idx % REGION_PALETTE.length]);
  });
  return {
    regionByFlatId,
    regionByChannel,
    palette,
    isEmpty: regionByFlatId.size === 0 && regionByChannel.size === 0,
  };
}
