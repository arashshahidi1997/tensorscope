import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../../store/appStore";
import { useMaskStore } from "../../store/maskStore";
import { getColormapLUT } from "./colormaps";

/**
 * ScatterMapView — position-driven spatial map for non-grid probes.
 *
 * The planar analogue of SpatialMapSliceView (grid imshow): instead of an
 * AP×ML lattice, it plots each channel as a filled circle at its true (x, y)
 * electrode position, coloured by the channel's value at the cursor time. Works
 * for any layout the dense grid can't represent — 4-shank Neuropixels, sparse /
 * L-shaped ECoG, SEEG. Positions come from GET /tensors/{name}/electrodes
 * (geometry "planar"); values from the per-channel spatial_map frame.
 * Aspect-equal so the probe's real shape is preserved. See bench/RESULTS.md +
 * docs/design/neuropixels-multiprobe.md.
 */
const LUT = getColormapLUT("viridis");

function colorFor(v: number, lo: number, hi: number): string {
  if (!Number.isFinite(v)) return "#2a2a2a";
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  const i = Math.round(t * 255) * 4;
  return `rgb(${LUT[i]},${LUT[i + 1]},${LUT[i + 2]})`;
}

export function ScatterMapView({
  positions,
  values,
  selectedTime,
  tensorName,
}: {
  positions: { x: number[]; y: number[] };
  values: number[];
  selectedTime?: number | null;
  /** Resolved tensor for this slot — used to grey its masked channels (Track C4
   * parity with the grid spatial map). */
  tensorName?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Per-channel mask: grey out excluded channels, repainting in place when a
  // sidebar toggle changes it (no slice refetch) — same store the grid view uses.
  const globalTensor = useAppStore((s) => s.selectedTensor);
  const maskTensor = tensorName ?? globalTensor;
  const maskedArray = useMaskStore((s) => (maskTensor ? s.masks[maskTensor] : undefined));
  const maskedSet = useMemo(() => (maskedArray ? new Set(maskedArray) : undefined), [maskedArray]);

  // Finite, unmasked value range for the colormap.
  const [lo, hi] = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (maskedSet?.has(i)) continue;
      const v = values[i];
      if (Number.isFinite(v)) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    return Number.isFinite(mn) ? [mn, mx] : [0, 1];
  }, [values, maskedSet]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const n = Math.min(positions.x.length, positions.y.length, values.length);
    if (n === 0) return;

    const rect = wrap.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width));
    const H = Math.max(1, Math.round(rect.height));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // Position bounds → aspect-equal fit with padding.
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      xMin = Math.min(xMin, positions.x[i]); xMax = Math.max(xMax, positions.x[i]);
      yMin = Math.min(yMin, positions.y[i]); yMax = Math.max(yMax, positions.y[i]);
    }
    const pad = 24;
    const spanX = xMax - xMin || 1;
    const spanY = yMax - yMin || 1;
    const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const drawnW = spanX * scale;
    const drawnH = spanY * scale;
    const offX = (W - drawnW) / 2;
    const offY = (H - drawnH) / 2;
    // y grows downward on canvas; flip so larger y (deeper/dorsal) sits as data intends.
    const px = (x: number) => offX + (x - xMin) * scale;
    const py = (y: number) => offY + (yMax - y) * scale;

    const r = Math.max(2.5, Math.min(16, 0.55 * Math.sqrt((drawnW * drawnH) / Math.max(1, n))));

    for (let i = 0; i < n; i++) {
      const masked = maskedSet?.has(i);
      ctx.beginPath();
      ctx.arc(px(positions.x[i]), py(positions.y[i]), r, 0, 2 * Math.PI);
      ctx.fillStyle = masked ? "rgba(60,60,60,0.5)" : colorFor(values[i], lo, hi);
      ctx.fill();
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
    }
  }, [positions, values, maskedSet, lo, hi]);

  const n = Math.min(positions.x.length, positions.y.length, values.length);
  if (n === 0) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Spatial Map</h2><p>No electrode positions.</p></div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="ts-toolbar" style={{ fontSize: 11, color: "#8b949e", gap: 8 }}>
        <span>scatter · {n} ch</span>
        <span style={{ marginLeft: "auto" }} data-testid="scatter-range">
          {lo.toPrecision(3)} – {hi.toPrecision(3)}
          {selectedTime != null ? `  @ ${selectedTime.toFixed(2)}s` : ""}
        </span>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative" }} data-testid="scatter-map">
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    </div>
  );
}
