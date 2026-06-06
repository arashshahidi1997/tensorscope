import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../store/appStore";
import { useMaskStore } from "../../store/maskStore";
import { getColormapLUT } from "./colormaps";
import { paintScatter } from "./scatterPaint";

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

export function ScatterMapView({
  positions,
  values,
  selectedTime,
  selectedFreq,
  tensorName,
}: {
  positions: { x: number[]; y: number[] };
  values: number[];
  selectedTime?: number | null;
  /** Selected frequency (Hz) when this scatter is a psd_spatial frame. Shown in
   * the caption instead of the time; mutually exclusive with selectedTime. */
  selectedFreq?: number | null;
  /** Resolved tensor for this slot — used to grey its masked channels (Track C4
   * parity with the grid spatial map). */
  tensorName?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Per-channel screen geometry (canvas px) captured during paint, for hover
  // hit-testing. {cx, cy} aligned to channel index, plus the dot radius.
  const geomRef = useRef<{ cx: number[]; cy: number[]; r: number }>({ cx: [], cy: [], r: 4 });
  const [hover, setHover] = useState<{ ch: number; sx: number; sy: number } | null>(null);

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

    geomRef.current = paintScatter(ctx, W, H, positions, values, LUT, lo, hi, maskedSet);
  }, [positions, values, maskedSet, lo, hi]);

  // Hover hit-test: nearest electrode within ~1.6× the dot radius of the cursor.
  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const { cx, cy, r } = geomRef.current;
    let best = -1;
    let bestD = (r * 1.6) ** 2;
    for (let i = 0; i < cx.length; i++) {
      const d = (cx[i] - mx) ** 2 + (cy[i] - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(
      best >= 0
        ? { ch: best, sx: e.clientX - rect.left, sy: e.clientY - rect.top }
        : null,
    );
  }, []);
  const onLeave = useCallback(() => setHover(null), []);

  const n = Math.min(positions.x.length, positions.y.length, values.length);
  if (n === 0) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Spatial Map</h2><p>No electrode positions.</p></div>
      </div>
    );
  }

  const atCaption =
    selectedFreq != null ? `  @ ${selectedFreq.toFixed(1)} Hz`
    : selectedTime != null ? `  @ ${selectedTime.toFixed(2)}s`
    : "";

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="ts-toolbar" style={{ fontSize: 11, color: "#8b949e", gap: 8 }}>
        <span>scatter · {n} ch</span>
        <span style={{ marginLeft: "auto" }} data-testid="scatter-range">
          {lo.toPrecision(3)} – {hi.toPrecision(3)}{atCaption}
        </span>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative" }} data-testid="scatter-map">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        />
        {hover && Number.isFinite(values[hover.ch]) && (
          <div
            data-testid="scatter-tooltip"
            style={{
              position: "absolute",
              left: Math.min(hover.sx + 10, (wrapRef.current?.clientWidth ?? 9999) - 90),
              top: Math.max(0, hover.sy - 28),
              pointerEvents: "none",
              background: "rgba(13,17,23,0.92)",
              border: "1px solid #30363d",
              borderRadius: 4,
              padding: "2px 6px",
              fontSize: 11,
              color: "#e6edf3",
              whiteSpace: "nowrap",
            }}
          >
            ch {hover.ch} · {values[hover.ch].toPrecision(3)}
          </div>
        )}
      </div>
    </div>
  );
}
