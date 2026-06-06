import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProbeLayoutQuery } from "../../api/queries";
import { buildRegionResolver } from "../../api/probeLayout";
import { useAppStore } from "../../store/appStore";
import { useMaskStore } from "../../store/maskStore";
import { useSelectionStore } from "../../store/selectionStore";
import { getColormapLUT } from "./colormaps";
import { computeNearestMap, computeScatterLayout, paintScatter, type ScatterLayout } from "./scatterPaint";

/**
 * ScatterMapView — position-driven spatial map for non-grid probes.
 *
 * The planar analogue of SpatialMapSliceView (grid imshow): instead of an
 * AP×ML lattice, it plots each channel at its true (x, y) electrode position,
 * coloured by the channel's value. Works for any layout the dense grid can't
 * represent — 4-shank Neuropixels, sparse / L-shaped ECoG, SEEG. Positions come
 * from GET /tensors/{name}/electrodes (geometry "planar"); values from the
 * per-channel frame. Aspect-equal so the probe's real shape is preserved.
 *
 * Parity with the grid spatial map: mask greying, region rings (probe-layout),
 * cross-view hover highlight, click-to-select, plus an interpolated (nearest /
 * Voronoi) surface toggle. See ADR-0010 + bench/RESULTS.md.
 */
const LUT = getColormapLUT("viridis");

export function ScatterMapView({
  positions,
  values,
  selectedTime,
  selectedFreq,
  tensorName,
  onPick,
}: {
  positions: { x: number[]; y: number[] };
  values: number[];
  selectedTime?: number | null;
  selectedFreq?: number | null;
  tensorName?: string;
  /** Click an electrode → its channel index (e.g. scroll the timeseries to it). */
  onPick?: (channel: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const geomRef = useRef<ScatterLayout>({ cx: [], cy: [], r: 4 });
  const nearestCacheRef = useRef<{ key: string; map: Int32Array } | null>(null);
  const [hover, setHover] = useState<{ ch: number; sx: number; sy: number } | null>(null);
  const [fill, setFill] = useState(false);
  const [sizeTick, setSizeTick] = useState(0);

  const globalTensor = useAppStore((s) => s.selectedTensor);
  const maskTensor = tensorName ?? globalTensor;
  const maskedArray = useMaskStore((s) => (maskTensor ? s.masks[maskTensor] : undefined));
  const maskedSet = useMemo(() => (maskedArray ? new Set(maskedArray) : undefined), [maskedArray]);

  // Region annotation rings (probe-layout sidecar). Inert when no sidecar.
  const { data: probeLayout } = useProbeLayoutQuery();
  const ringColors = useMemo(() => {
    const r = buildRegionResolver(probeLayout, 0);
    if (r.isEmpty) return undefined;
    return values.map((_, i) => {
      const region = r.regionByChannel.get(i);
      return region ? (r.palette.get(region) ?? null) : null;
    });
  }, [probeLayout, values]);

  // Cross-view hover highlight (shared with the grid spatial views).
  const storeHovered = useSelectionStore((s) => s.spatial.hoveredId);
  const setHoveredElectrode = useSelectionStore((s) => s.setHoveredElectrode);
  const highlightId = hover?.ch ?? storeHovered ?? null;

  const [lo, hi] = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (maskedSet?.has(i)) continue;
      const v = values[i];
      if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    return Number.isFinite(mn) ? [mn, mx] : [0, 1];
  }, [values, maskedSet]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setSizeTick((t) => t + 1));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const n = Math.min(positions.x.length, positions.y.length, values.length);
    if (n === 0) return;
    const W = Math.max(1, Math.round(wrap.clientWidth));
    const H = Math.max(1, Math.round(wrap.clientHeight));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let nearestMap: Int32Array | null = null;
    if (fill) {
      // Cache the per-pixel nearest-electrode map; positions are fixed per
      // tensor, so only a resize (W/H) or channel-count change invalidates it.
      const key = `${W}x${H}:${n}:${positions.x[0]},${positions.x[n - 1]}`;
      if (nearestCacheRef.current?.key !== key) {
        nearestCacheRef.current = { key, map: computeNearestMap(computeScatterLayout(positions, W, H), W, H) };
      }
      nearestMap = nearestCacheRef.current.map;
    }
    geomRef.current = paintScatter(ctx, W, H, positions, values, {
      lut: LUT, lo, hi, maskedSet, ringColors, highlightId, nearestMap,
    });
  }, [positions, values, maskedSet, lo, hi, fill, ringColors, highlightId, sizeTick]);

  const pick = useCallback((e: React.MouseEvent<HTMLCanvasElement>): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const { cx, cy, r } = geomRef.current;
    let best = -1;
    let bestD = (Math.max(r * 1.6, 6)) ** 2;
    for (let i = 0; i < cx.length; i++) {
      const d = (cx[i] - mx) ** 2 + (cy[i] - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }, []);

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const best = pick(e);
    const rect = canvasRef.current!.getBoundingClientRect();
    setHover(best >= 0 ? { ch: best, sx: e.clientX - rect.left, sy: e.clientY - rect.top } : null);
    setHoveredElectrode(best >= 0 ? best : null);
  }, [pick, setHoveredElectrode]);
  const onLeave = useCallback(() => { setHover(null); setHoveredElectrode(null); }, [setHoveredElectrode]);
  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const best = pick(e);
    if (best >= 0) onPick?.(best);
  }, [pick, onPick]);

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
        <button
          type="button"
          className={`ts-tool${fill ? " active" : ""}`}
          title={fill ? "Interpolated surface (nearest electrode) — click for dots" : "Dots — click for an interpolated surface"}
          onClick={() => setFill((f) => !f)}
          data-testid="scatter-fill-toggle"
          style={{ fontSize: 11 }}
        >
          {fill ? "▦ fill" : "• dots"}
        </button>
        <span style={{ marginLeft: "auto" }} data-testid="scatter-range">
          {lo.toPrecision(3)} – {hi.toPrecision(3)}{atCaption}
        </span>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative" }} data-testid="scatter-map">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", cursor: onPick ? "pointer" : "default" }}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onClick={onClick}
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
