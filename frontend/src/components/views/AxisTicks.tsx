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

/** Y-axis ticks: top = max, bottom = min. pct is measured from top. */
export function YTicks({ lo, hi, count = 4 }: { lo: number; hi: number; count?: number }) {
  const ticks = makeTicks(lo, hi, count);
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
export function XTicks({ lo, hi, count = 4 }: { lo: number; hi: number; count?: number }) {
  const ticks = makeTicks(lo, hi, count);
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
