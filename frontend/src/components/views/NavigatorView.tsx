import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { decodeArrowSlice, extractTimeseriesColumnar } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Gesture layer
//
// The navigator uses uPlot's built-in drag-to-zoom (setScale: true) to update
// the visible time window. The click handler selects a time point.
// Both are wired imperatively; no React state is involved.
// ─────────────────────────────────────────────────────────────────────────────

type NavigatorGestureRefs = {
  onSelectTimeRef: React.RefObject<((t: number) => void) | undefined>;
  onWindowRef: React.RefObject<((w: [number, number]) => void) | undefined>;
};

function attachNavigatorGestures(chart: uPlot, refs: NavigatorGestureRefs): () => void {
  const handleClick = (e: MouseEvent) => {
    const bounds = chart.over.getBoundingClientRect();
    const t = chart.posToVal(e.clientX - bounds.left, "x");
    if (Number.isFinite(t)) refs.onSelectTimeRef.current?.(t);
  };
  chart.over.addEventListener("click", handleClick);
  return () => chart.over.removeEventListener("click", handleClick);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function NavigatorView({
  slice,
  selection,
  onSelectTime,
  timeWindow,
  onTimeWindowChange,
}: SliceViewProps & {
  timeWindow?: [number, number];
  onTimeWindowChange?: (window: [number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Stable callback refs — updated every render, never trigger chart recreation
  const onSelectTimeRef = useRef(onSelectTime);
  const onWindowRef = useRef(onTimeWindowChange);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { onWindowRef.current = onTimeWindowChange; });

  // ── Data decoding ────────────────────────────────────────────────────────
  const { times, meanValues } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    const { times: ts, series } = extractTimeseriesColumnar(decoded);
    if (ts.length === 0 || series.length === 0) return { times: [], meanValues: [] };
    const mean = ts.map((_, ti) => {
      let sum = 0, count = 0;
      for (const s of series) {
        const v = s.values[ti];
        if (Number.isFinite(v)) { sum += v; count++; }
      }
      return count > 0 ? sum / count : NaN;
    });
    return { times: ts, meanValues: mean };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  // ── Chart lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || times.length === 0) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const width = el.clientWidth || el.getBoundingClientRect().width || 900;

    const chart = new uPlot(
      {
        width,
        height: 80,
        legend: { show: false },
        cursor: {
          // uPlot's built-in drag updates the x scale, which fires onWindowRef via the setScale hook
          drag: { setScale: true, x: true, y: false },
          sync: { key: "tsscope-time" },
        },
        axes: [
          { stroke: "#888", size: 24, grid: { stroke: "#222" } },
          { show: false },
        ],
        select: { show: true, left: 0, width: 0, top: 0, height: 80 },
        series: [
          {},
          { stroke: "#73d2de", width: 1, spanGaps: false, fill: "rgba(115,210,222,0.08)" },
        ],
        hooks: {
          setScale: [
            (u, key) => {
              if (key !== "x") return;
              const { min, max } = u.scales.x;
              if (min != null && max != null) onWindowRef.current?.([min, max]);
            },
          ],
        },
      },
      [new Float64Array(times), new Float32Array(meanValues)],
      el,
    );

    chartRef.current = chart;

    const detachGestures = attachNavigatorGestures(chart, { onSelectTimeRef, onWindowRef });

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.setSize({ width: w, height: 80 });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      detachGestures();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, meanValues]);

  // ── Hot sync: cursor marker follows selection ────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || times.length === 0 || !selection) return;
    const x = chart.valToPos(selection.time, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
  }, [selection?.time, times]);

  // Rules of Hooks: all hooks above, conditional return below
  if (!selection || times.length === 0) return null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="navigator-bar">
      <div
        ref={containerRef}
        style={{ cursor: "crosshair", width: "100%" }}
      />
    </div>
  );
}
