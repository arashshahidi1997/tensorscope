/**
 * Shared per-channel scatter paint (ADR-0010): one filled circle per channel at
 * its true (x, y) position, coloured by value through a colormap LUT,
 * aspect-equal with padding so the probe's real shape is preserved. Returns the
 * per-channel screen geometry (canvas px) so callers can hit-test for hover.
 *
 * Used by both the static ScatterMapView (spatial_map / psd_spatial) and the
 * animated ScatterMoviePlayer (propagation) so the planar render is identical
 * across views.
 */
export type ScatterLayout = { cx: number[]; cy: number[]; r: number };

export function paintScatter(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  positions: { x: number[]; y: number[] },
  values: number[],
  lut: Uint8ClampedArray,
  lo: number,
  hi: number,
  maskedSet?: Set<number>,
): ScatterLayout {
  ctx.clearRect(0, 0, W, H);
  const n = Math.min(positions.x.length, positions.y.length, values.length);
  if (n === 0) return { cx: [], cy: [], r: 4 };

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (positions.x[i] < xMin) xMin = positions.x[i];
    if (positions.x[i] > xMax) xMax = positions.x[i];
    if (positions.y[i] < yMin) yMin = positions.y[i];
    if (positions.y[i] > yMax) yMax = positions.y[i];
  }
  const pad = 24;
  const spanX = xMax - xMin || 1;
  const spanY = yMax - yMin || 1;
  const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offX = (W - drawnW) / 2;
  const offY = (H - drawnH) / 2;
  const r = Math.max(2.5, Math.min(16, 0.55 * Math.sqrt((drawnW * drawnH) / Math.max(1, n))));
  const valSpan = hi - lo || 1;

  const cx = new Array<number>(n);
  const cy = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // y grows downward on canvas; flip so larger y sits as the data intends.
    cx[i] = offX + (positions.x[i] - xMin) * scale;
    cy[i] = offY + (yMax - positions.y[i]) * scale;
    ctx.beginPath();
    ctx.arc(cx[i], cy[i], r, 0, 2 * Math.PI);
    if (maskedSet?.has(i)) {
      ctx.fillStyle = "rgba(60,60,60,0.5)";
    } else {
      const v = values[i];
      if (!Number.isFinite(v)) {
        ctx.fillStyle = "#2a2a2a";
      } else {
        const t = Math.max(0, Math.min(1, (v - lo) / valSpan));
        const idx = Math.round(t * 255) * 4;
        ctx.fillStyle = `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]})`;
      }
    }
    ctx.fill();
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();
  }
  return { cx, cy, r };
}
