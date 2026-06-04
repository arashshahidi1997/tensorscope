import { useEffect, useMemo, useRef } from "react";
import { decodeArrowSlice, extractRaster } from "../../api/arrow";
import { useAppStore } from "../../store/appStore";
import { useMaskStore } from "../../store/maskStore";
import { getColormapLUT } from "./colormaps";
import { unmaskedRasterRange } from "./colorRange";
import { ColorBar } from "./ColorBar";
import type { SliceViewProps } from "./viewTypes";

/**
 * RasterView — channel × time amplitude heatmap (channels as rows, time as
 * columns). Works for both linear (Neuropixels) and grid (ECoG, flattened
 * server-side) tensors; rows are ordered by depth when available. The classic
 * LFP "image" view. See docs/design/neuropixels-multiprobe.md.
 */
const RASTER_LUT = getColormapLUT("viridis");

export function RasterView({ slice, tensorName }: SliceViewProps & { tensorName?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Channel mask for the panel's resolved tensor — masked (bad) channels are
  // excluded from the color range so they don't wash out the colormap, and
  // their rows are greyed in the image.
  const globalTensor = useAppStore((s) => s.selectedTensor);
  const maskTensor = tensorName ?? globalTensor;
  const maskedArray = useMaskStore((s) => (maskTensor ? s.masks[maskTensor] : undefined));
  const maskedSet = useMemo(
    () => (maskedArray ? new Set(maskedArray) : undefined),
    [maskedArray],
  );

  const raster = useMemo(() => {
    if (!slice) return null;
    return extractRaster(decodeArrowSlice(slice));
  }, [slice]);

  // Robust color range: 2nd–98th percentile of finite values from UNMASKED
  // rows → a bad channel's amplitude doesn't wash out the rest.
  const range = useMemo<[number, number]>(() => {
    if (!raster || raster.values.length === 0) return [0, 1];
    return unmaskedRasterRange(raster.values, raster.channels, raster.nTime, maskedSet);
  }, [raster, maskedSet]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !raster || raster.nChannels === 0) return;

    const { nChannels, nTime, values, channels } = raster;
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Render at native data resolution (nTime × nChannels) into an offscreen
    // ImageData, then blit scaled to the canvas with nearest-neighbor.
    const [min, max] = range;
    const span = max - min || 1;
    const src = ctx.createImageData(nTime, nChannels);
    for (let r = 0; r < nChannels; r++) {
      const rowMasked = maskedSet ? maskedSet.has(channels[r]) : false;
      for (let c = 0; c < nTime; c++) {
        const v = values[r * nTime + c];
        const px = (r * nTime + c) * 4;
        if (rowMasked) {
          // Masked channel → neutral grey row (excluded from the color range).
          src.data[px] = 42; src.data[px + 1] = 47; src.data[px + 2] = 54; src.data[px + 3] = 255;
          continue;
        }
        if (!Number.isFinite(v)) {
          src.data[px] = 20; src.data[px + 1] = 20; src.data[px + 2] = 20; src.data[px + 3] = 255;
          continue;
        }
        const t = Math.max(0, Math.min(1, (v - min) / span));
        const li = Math.round(t * 255) * 4;
        src.data[px] = RASTER_LUT[li];
        src.data[px + 1] = RASTER_LUT[li + 1];
        src.data[px + 2] = RASTER_LUT[li + 2];
        src.data[px + 3] = 255;
      }
    }
    // Blit via a temp canvas so we can scale with imageSmoothing off.
    const tmp = document.createElement("canvas");
    tmp.width = nTime;
    tmp.height = nChannels;
    tmp.getContext("2d")?.putImageData(src, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0, nTime, nChannels, 0, 0, w, h);
  }, [raster, range, maskedSet]);

  if (!raster || raster.nChannels === 0) {
    return <div className="placeholder">No raster data</div>;
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", gap: 4 }}>
      <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="axis-y-label">{raster.depths ? "Depth" : "Channel"}</div>
        <div className="axis-y-ticks" />
        <div className="axis-canvas-area" ref={containerRef} style={{ position: "relative" }}>
          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
        </div>
        <div className="axis-x-ticks" />
        <div className="axis-x-label">Time (s)</div>
      </div>
      <ColorBar colormap="viridis" min={range[0]} max={range[1]} label="amplitude" />
    </div>
  );
}
