import { useEffect, useMemo, useRef } from "react";
import { decodeArrowSlice } from "../../api/arrow";
import { extractHeatmapND, type HeatmapEncoding } from "../../api/heatmap";
import { extractHeatmapNDV2, type LabeledTensor } from "../../api/v2-arrow";
import { useAppStore } from "../../store/appStore";
import { ColorBar } from "./ColorBar";
import { getColormapLUT, type ColormapName } from "./colormaps";
import type { SliceViewProps } from "./viewTypes";

/**
 * HeatmapView — generic encoding-driven 2-D field view. The user assigns any
 * data dim to the X or Y axis (and swaps them live); remaining dims are reduced
 * (mean) into the color. Replaces the hardcoded-axes psd_heatmap / raster /
 * (later) spectrogram components. See docs/design/encoding-heatmap.md.
 *
 * `viewId` keys the per-panel axis encoding in appStore; `defaultEncoding` sets
 * the initial axes for this view type. `colormap`/`logColor` are view defaults.
 */
type HeatmapViewProps = Omit<SliceViewProps, "slice"> & {
  slice?: SliceViewProps["slice"];
  viewId: string;
  defaultEncoding: HeatmapEncoding;
  colormap?: ColormapName;
  logColor?: boolean;
  /** Contract-v2 source. When set, the grid is built via `extractHeatmapNDV2`
   * and `slice` is ignored. */
  v2?: LabeledTensor | null;
};

export function HeatmapView({
  slice,
  viewId,
  defaultEncoding,
  colormap = "viridis",
  logColor = false,
  v2 = null,
}: HeatmapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stored = useAppStore((s) => s.heatmapEncodings[viewId]);
  const setHeatmapAxes = useAppStore((s) => s.setHeatmapAxes);

  const decoded = useMemo(
    () => (!v2 && slice ? decodeArrowSlice(slice) : null),
    [v2, slice],
  );

  // Dims available for axis assignment — `meta.dims` for v2, the long-format
  // column set for v1.
  const cols = useMemo(
    () => (v2 ? v2.meta.dims : (decoded?.columns ?? [])),
    [v2, decoded],
  );

  // Effective encoding: stored per-panel axes if both still exist in the data,
  // else the view's default. Guards against a stored dim vanishing on a tensor
  // switch (e.g. AP/ML → channel).
  const encoding = useMemo<HeatmapEncoding>(() => {
    if (stored && cols.includes(stored.x) && cols.includes(stored.y)) {
      return { x: stored.x, y: stored.y, reduce: defaultEncoding.reduce };
    }
    return defaultEncoding;
  }, [stored, cols, defaultEncoding]);

  const grid = useMemo(
    () =>
      v2
        ? extractHeatmapNDV2(v2, encoding)
        : decoded
          ? extractHeatmapND(decoded, encoding)
          : null,
    [v2, decoded, encoding],
  );

  // Robust color range (2–98 pct of finite values; log10 for power-like data).
  const range = useMemo<[number, number]>(() => {
    if (!grid || grid.values.length === 0) return [0, 1];
    const finite: number[] = [];
    for (const v of grid.values) {
      if (!Number.isFinite(v)) continue;
      if (logColor) { if (v > 0) finite.push(Math.log10(v)); }
      else finite.push(v);
    }
    if (finite.length === 0) return [0, 1];
    finite.sort((a, b) => a - b);
    const lo = finite[Math.floor(finite.length * 0.02)];
    const hi = finite[Math.floor(finite.length * 0.98)];
    return lo < hi ? [lo, hi] : [finite[0], finite[finite.length - 1] || finite[0] + 1];
  }, [grid, logColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !grid || grid.nx === 0 || grid.ny === 0) return;
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const lut = getColormapLUT(colormap);
    const [min, max] = range;
    const span = max - min || 1;
    const { nx, ny, values } = grid;

    // Native-resolution ImageData (nx × ny), y top = max(yVal) → row 0 is the
    // LAST yVal so larger y is at the top (depth 0 at top reads naturally for
    // a probe; freq high at top matches the spectrogram convention).
    const src = ctx.createImageData(nx, ny);
    for (let yi = 0; yi < ny; yi++) {
      const srcRow = ny - 1 - yi; // flip so yVals[max] is painted at the top
      for (let xi = 0; xi < nx; xi++) {
        const v = values[srcRow * nx + xi];
        const px = (yi * nx + xi) * 4;
        let t: number;
        if (!Number.isFinite(v) || (logColor && v <= 0)) {
          src.data[px] = 20; src.data[px + 1] = 20; src.data[px + 2] = 20; src.data[px + 3] = 255;
          continue;
        }
        const cv = logColor ? Math.log10(v) : v;
        t = Math.max(0, Math.min(1, (cv - min) / span));
        const li = Math.round(t * 255) * 4;
        src.data[px] = lut[li];
        src.data[px + 1] = lut[li + 1];
        src.data[px + 2] = lut[li + 2];
        src.data[px + 3] = 255;
      }
    }
    const tmp = document.createElement("canvas");
    tmp.width = nx;
    tmp.height = ny;
    tmp.getContext("2d")?.putImageData(src, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0, nx, ny, 0, 0, w, h);
  }, [grid, range, colormap, logColor]);

  if (!grid || grid.nx === 0) {
    return <div className="placeholder">No data</div>;
  }

  const dims = grid.availableDims;
  const setX = (x: string) => setHeatmapAxes(viewId, x, x === grid.yDim ? grid.xDim : grid.yDim);
  const setY = (y: string) => setHeatmapAxes(viewId, y === grid.xDim ? grid.yDim : grid.xDim, y);
  const swap = () => setHeatmapAxes(viewId, grid.yDim, grid.xDim);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Axis encoding controls */}
      <div className="ts-toolbar" style={{ gap: 6, fontSize: 11 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          Y
          <select
            className="panel-tensor-dropdown"
            value={grid.yDim}
            onChange={(e) => setY(e.target.value)}
            title="Dimension on the Y axis"
          >
            {dims.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="ts-tool"
          title="Swap axes"
          onClick={swap}
        >&#x21C4;</button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          X
          <select
            className="panel-tensor-dropdown"
            value={grid.xDim}
            onChange={(e) => setX(e.target.value)}
            title="Dimension on the X axis"
          >
            {dims.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {grid.reducedDims.length > 0 && (
          <span style={{ opacity: 0.6, marginLeft: 4 }}>
            {encoding.reduce === "max" ? "max" : "mean"} over {grid.reducedDims.join(", ")}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }}>
          <div className="axis-y-label">{grid.yDim}</div>
          <div className="axis-y-ticks" />
          <div ref={containerRef} className="axis-canvas-area" style={{ position: "relative" }}>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
          </div>
          <div className="axis-x-ticks" />
          <div className="axis-x-label">{grid.xDim}</div>
        </div>
        <ColorBar
          colormap={colormap}
          min={range[0]}
          max={range[1]}
          label={logColor ? "log₁₀(value)" : "value"}
        />
      </div>
    </div>
  );
}
