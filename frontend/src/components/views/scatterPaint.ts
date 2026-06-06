/**
 * Shared per-channel scatter paint (ADR-0010): each channel drawn at its true
 * (x, y) position, coloured by value through a colormap LUT, aspect-equal with
 * padding so the probe's real shape is preserved. Used by the static
 * ScatterMapView (spatial_map / psd_spatial) and the animated ScatterMoviePlayer
 * (propagation) so the planar render is identical across views.
 *
 * Two render styles:
 *  - "dots"  (default): one filled circle per electrode.
 *  - "field": a nearest-electrode (Voronoi) fill — pass `nearestMap` from
 *    `computeNearestMap(layout, W, H)`; precompute once per (positions, size)
 *    and recolour cheaply per frame.
 *
 * Optional overlays: per-channel `ringColors` (region annotation) and a
 * `highlightId` (hovered/selected electrode), parity with the grid spatial map.
 */
export type ScatterLayout = { cx: number[]; cy: number[]; r: number };

export type PaintScatterOpts = {
  lut: Uint8ClampedArray;
  lo: number;
  hi: number;
  maskedSet?: Set<number>;
  /** Per-channel region ring colour (null = none). Overlay over the value fill. */
  ringColors?: (string | null)[];
  /** Hovered/selected electrode → emphasised white ring. */
  highlightId?: number | null;
  /** Precomputed per-pixel nearest electrode index → renders a Voronoi field. */
  nearestMap?: Int32Array | null;
};

const PAD = 24;

/** Pure layout: map positions into the canvas, aspect-equal + centred. */
export function computeScatterLayout(
  positions: { x: number[]; y: number[] },
  W: number,
  H: number,
): ScatterLayout {
  const n = Math.min(positions.x.length, positions.y.length);
  if (n === 0) return { cx: [], cy: [], r: 4 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (positions.x[i] < xMin) xMin = positions.x[i];
    if (positions.x[i] > xMax) xMax = positions.x[i];
    if (positions.y[i] < yMin) yMin = positions.y[i];
    if (positions.y[i] > yMax) yMax = positions.y[i];
  }
  const spanX = xMax - xMin || 1;
  const spanY = yMax - yMin || 1;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offX = (W - drawnW) / 2;
  const offY = (H - drawnH) / 2;
  const r = Math.max(2.5, Math.min(16, 0.55 * Math.sqrt((drawnW * drawnH) / Math.max(1, n))));
  const cx = new Array<number>(n);
  const cy = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    cx[i] = offX + (positions.x[i] - xMin) * scale;
    cy[i] = offY + (yMax - positions.y[i]) * scale; // flip Y to data orientation
  }
  return { cx, cy, r };
}

/** Per-pixel nearest-electrode index for a layout (Voronoi field). O(W·H·n) —
 *  precompute once per (layout, size) and cache; recolouring per frame is O(W·H). */
export function computeNearestMap(layout: ScatterLayout, W: number, H: number): Int32Array {
  const { cx, cy } = layout;
  const n = cx.length;
  const map = new Int32Array(W * H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (cx[i] - px) ** 2 + (cy[i] - py) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      map[py * W + px] = best;
    }
  }
  return map;
}

function rgb(lut: Uint8ClampedArray, v: number, lo: number, hi: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  const i = Math.round(t * 255) * 4;
  return [lut[i], lut[i + 1], lut[i + 2]];
}

export function paintScatter(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  positions: { x: number[]; y: number[] },
  values: number[],
  opts: PaintScatterOpts,
): ScatterLayout {
  const layout = computeScatterLayout(positions, W, H);
  const { cx, cy, r } = layout;
  const n = Math.min(cx.length, values.length);
  ctx.clearRect(0, 0, W, H);
  if (n === 0) return layout;
  const { lut, lo, hi, maskedSet, ringColors, highlightId, nearestMap } = opts;

  // ── Voronoi field fill (nearest electrode per pixel) ──────────────────────
  if (nearestMap && nearestMap.length === W * H) {
    const img = ctx.createImageData(W, H);
    for (let p = 0; p < nearestMap.length; p++) {
      const ch = nearestMap[p];
      const o = p * 4;
      if (maskedSet?.has(ch) || !Number.isFinite(values[ch])) {
        img.data[o] = 42; img.data[o + 1] = 42; img.data[o + 2] = 42;
      } else {
        const [cr, cg, cb] = rgb(lut, values[ch], lo, hi);
        img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb;
      }
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Electrode markers (always drawn: as dots over a blank bg, or as thin
  //    outlines/overlays over the field) ────────────────────────────────────
  const fieldMode = Boolean(nearestMap && nearestMap.length === W * H);
  const dotR = fieldMode ? Math.max(1.5, r * 0.45) : r;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(cx[i], cy[i], dotR, 0, 2 * Math.PI);
    if (!fieldMode) {
      if (maskedSet?.has(i)) {
        ctx.fillStyle = "rgba(60,60,60,0.5)";
      } else if (!Number.isFinite(values[i])) {
        ctx.fillStyle = "#2a2a2a";
      } else {
        const [cr, cg, cb] = rgb(lut, values[i], lo, hi);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      }
      ctx.fill();
    }
    // Region ring overlay (if provided), else a faint outline for definition.
    const ring = ringColors?.[i] ?? null;
    ctx.lineWidth = ring ? 1.5 : 0.5;
    ctx.strokeStyle = ring ?? (fieldMode ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.5)");
    ctx.stroke();
  }

  // ── Highlight (hovered / selected) ────────────────────────────────────────
  if (highlightId != null && highlightId >= 0 && highlightId < cx.length) {
    ctx.beginPath();
    ctx.arc(cx[highlightId], cy[highlightId], r + 3, 0, 2 * Math.PI);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  return layout;
}
