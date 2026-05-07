/**
 * AxisTicks — lightweight tick-value overlays for canvas-based views.
 *
 * Renders positioned <span> elements inside .axis-y-ticks / .axis-x-ticks
 * containers. Each span is absolutely positioned at a percentage offset.
 */

type TickDef = { value: number; label: string; pct: number };

/** Generate ~count evenly-spaced tick values between lo and hi. */
export function makeTicks(lo: number, hi: number, count = 4): TickDef[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const range = hi - lo;
  // Nice step: round to 1, 2, 5 multiples
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / mag;
  const niceStep = residual <= 1.5 ? mag : residual <= 3.5 ? 2 * mag : residual <= 7.5 ? 5 * mag : 10 * mag;

  const ticks: TickDef[] = [];
  const start = Math.ceil(lo / niceStep) * niceStep;
  for (let v = start; v <= hi; v += niceStep) {
    const pct = ((v - lo) / range) * 100;
    const label = niceStep >= 1 ? v.toFixed(0) : v.toFixed(Math.max(0, -Math.floor(Math.log10(niceStep))));
    ticks.push({ value: v, label, pct });
  }
  return ticks;
}

/**
 * Generate log-spaced tick values. Anchors on decades (…, 1, 10, 100, …) and
 * adds {2, 5} sub-decade ticks when the visible span is narrow enough that
 * decades alone would be sparse.
 *
 * Returns ticks ordered with `pct` measured along the linear log axis, so
 * callers position them with the same `bottom`/`left` percentage they'd use
 * for the linear case.
 */
export function makeLogTicks(lo: number, hi: number): TickDef[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || lo <= 0) return [];
  const logLo = Math.log10(lo);
  const logHi = Math.log10(hi);
  const logRange = logHi - logLo;

  const decadeFloor = Math.floor(logLo);
  const decadeCeil = Math.ceil(logHi);
  // Add 2× and 5× sub-decade ticks when fewer than 2 full decades are visible.
  const sub = logRange < 2 ? [1, 2, 5] : [1];

  const ticks: TickDef[] = [];
  for (let d = decadeFloor; d <= decadeCeil; d++) {
    const base = Math.pow(10, d);
    for (const m of sub) {
      const v = m * base;
      if (v < lo || v > hi) continue;
      const pct = ((Math.log10(v) - logLo) / logRange) * 100;
      const label = v >= 1 ? v.toFixed(0) : v.toString();
      ticks.push({ value: v, label, pct });
    }
  }
  return ticks;
}

/** Y-axis ticks: top = max, bottom = min. pct is measured from top. */
export function YTicks({
  lo,
  hi,
  count = 4,
  logScale = false,
}: {
  lo: number;
  hi: number;
  count?: number;
  logScale?: boolean;
}) {
  const ticks = logScale ? makeLogTicks(lo, hi) : makeTicks(lo, hi, count);
  return (
    <div className="axis-y-ticks">
      {ticks.map((t) => (
        <span key={t.value} style={{ bottom: `${t.pct}%` }}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

/** X-axis ticks: left = min, right = max. pct is measured from left. */
export function XTicks({
  lo,
  hi,
  count = 4,
  logScale = false,
}: {
  lo: number;
  hi: number;
  count?: number;
  logScale?: boolean;
}) {
  const ticks = logScale ? makeLogTicks(lo, hi) : makeTicks(lo, hi, count);
  return (
    <div className="axis-x-ticks">
      {ticks.map((t) => (
        <span key={t.value} style={{ left: `${t.pct}%` }}>
          {t.label}
        </span>
      ))}
    </div>
  );
}
