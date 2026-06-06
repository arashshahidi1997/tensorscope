import { useAppStore } from "../../store/appStore";
import { RasterView } from "./RasterView";
import type { SliceViewProps } from "./viewTypes";

/**
 * Depth map — the linear-probe (Neuropixels) depth × time image.
 *
 * A single instant is not useful for a depth probe — a SWR / spindle unfolds
 * over a window across depth. So this is a WINDOWED depth × time image (channels
 * by depth on Y, time on X), depth-sorted by the per-channel `depth` coord.
 *
 * LFP / CSD toggle (ADR-0010 Phase 3): the panel shows raw LFP (`depth_map`) or
 * current-source density along depth (the `csd` view, −d²V/dz²). The toggle
 * flips `appStore.depthCsd`, which switches the slice request's view_type in
 * useWorkspaceData; CSD renders through the same depth-sorted raster image (it
 * carries a midpoint `depth` coord). See docs/design/neuropixels-multiprobe.md.
 *
 * (`tensorName` is accepted for the other spatial views' channel-mask routing.)
 */
export function DepthMapSliceView({ slice, tensorName }: SliceViewProps & { tensorName?: string }) {
  const depthCsd = useAppStore((s) => s.depthCsd);
  const toggleDepthCsd = useAppStore((s) => s.toggleDepthCsd);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="ts-toolbar" style={{ fontSize: 11, color: "#8b949e", gap: 8 }}>
        <button
          type="button"
          className={`ts-tool${depthCsd ? " active" : ""}`}
          title={depthCsd
            ? "Current-source density (−d²V/dz²) — click for raw LFP"
            : "Raw LFP — click for current-source density (CSD)"}
          onClick={toggleDepthCsd}
          data-testid="depth-csd-toggle"
          style={{ fontSize: 11 }}
        >
          {depthCsd ? "CSD" : "LFP"}
        </button>
        <span style={{ marginLeft: "auto" }}>
          {depthCsd ? "current-source density · depth × time" : "depth × time"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <RasterView slice={slice} tensorName={tensorName} />
      </div>
    </div>
  );
}
