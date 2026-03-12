/**
 * uPlot draw hook that paints brainstate interval bands behind the signal traces.
 *
 * Usage: pass `brainstateIntervalsRef` (a ref to the current intervals array)
 * and add the returned function as a `hooks.drawClear` entry in the uPlot opts.
 *
 * Coordinate convention: `u.valToPos(v, "x", true)` and `u.bbox.*` are both
 * in canvas-pixel coordinates (CSS px * devicePixelRatio), so they can be
 * used together directly in `ctx.fillRect` calls.
 */
import type uPlot from "uplot";
import type { BrainstateIntervalDTO } from "../../api/types";
import { getOverlayColor } from "./brainstateColors";

export function makeBrainstateDrawHook(
  intervalsRef: React.RefObject<BrainstateIntervalDTO[]>,
  enabledRef: React.RefObject<boolean>,
): (u: uPlot) => void {
  return (u: uPlot) => {
    if (!enabledRef.current) return;
    const intervals = intervalsRef.current;
    if (!intervals || intervals.length === 0) return;

    const ctx = u.ctx;
    const { left, top, width, height } = u.bbox;

    ctx.save();
    for (const interval of intervals) {
      const x0 = u.valToPos(interval.start, "x", true);
      const x1 = u.valToPos(interval.end, "x", true);
      // Skip intervals entirely outside the visible area
      if (x1 < left || x0 > left + width) continue;
      const clampedX0 = Math.max(x0, left);
      const clampedX1 = Math.min(x1, left + width);
      ctx.fillStyle = getOverlayColor(interval.state);
      ctx.fillRect(clampedX0, top, clampedX1 - clampedX0, height);
    }
    ctx.restore();
  };
}
