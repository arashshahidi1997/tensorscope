import { RasterView } from "./RasterView";
import type { SliceViewProps } from "./viewTypes";

/**
 * Depth map — the linear-probe (Neuropixels) depth × time amplitude image.
 *
 * A single instant is not useful for a depth probe — a SWR / spindle unfolds
 * over a window across depth. So `depth_map` is now a WINDOWED depth × time
 * image (channels by depth on Y, time on X, amplitude as color), fine enough
 * to read an event when you zoom the shared window to event scale. It shares
 * the depth-sorted raster render (`extractRaster` already orders rows
 * dorsal→ventral by the per-channel `depth` coord); the distinct view id keeps
 * it in the linear-probe spatial slot. See docs/design/neuropixels-multiprobe.md.
 *
 * (`tensorName` is accepted for call-site compatibility with the other spatial
 * views' channel-mask routing; the raster image does not currently hatch masks.)
 */
export function DepthMapSliceView({ slice, tensorName }: SliceViewProps & { tensorName?: string }) {
  return <RasterView slice={slice} tensorName={tensorName} />;
}
