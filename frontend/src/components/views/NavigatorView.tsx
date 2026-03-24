import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { decodeArrowSlice, extractTimeseriesColumnar } from "../../api/arrow";
import type { BrainstateIntervalDTO } from "../../api/types";
import type { SliceViewProps } from "./viewTypes";
import { makeBrainstateDrawHook } from "./brainstateOverlay";

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
  // Track whether the pointer moved significantly since mousedown.
  // A drag-to-zoom release also fires a "click" event; we must not treat
  // that as a point-selection commit, or the subsequent commitSelection
  // round-trip will reset the visible window to a default 2-second span.
  let pointerDownX = 0;
  let wasDrag = false;

  const handleMouseDown = (e: MouseEvent) => {
    pointerDownX = e.clientX;
    wasDrag = false;
  };
  const handleMouseMove = (e: MouseEvent) => {
    if (Math.abs(e.clientX - pointerDownX) > 5) wasDrag = true;
  };
  const handleClick = (e: MouseEvent) => {
    if (wasDrag) return; // drag-end — window already updated via setScale hook
    const bounds = chart.over.getBoundingClientRect();
    const t = chart.posToVal(e.clientX - bounds.left, "x");
    if (Number.isFinite(t)) refs.onSelectTimeRef.current?.(t);
  };

  chart.over.addEventListener("mousedown", handleMouseDown);
  chart.over.addEventListener("mousemove", handleMouseMove);
  chart.over.addEventListener("click", handleClick);
  return () => {
    chart.over.removeEventListener("mousedown", handleMouseDown);
    chart.over.removeEventListener("mousemove", handleMouseMove);
    chart.over.removeEventListener("click", handleClick);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function NavigatorView({
  slice,
  selection,
  onSelectTime,
  onTimeWindowChange,
  brainstateIntervals = [],
  brainstateOverlayEnabled = false,
}: SliceViewProps & {
  onTimeWindowChange?: (window: [number, number]) => void;
  brainstateIntervals?: BrainstateIntervalDTO[];
  brainstateOverlayEnabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Stable callback refs — updated every render, never trigger chart recreation
  const onSelectTimeRef = useRef(onSelectTime);
  const onWindowRef = useRef(onTimeWindowChange);
  const brainstateIntervalsRef = useRef(brainstateIntervals);
  const brainstateEnabledRef = useRef(brainstateOverlayEnabled);
  const selectionTimeRef = useRef<number | null>(null);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { onWindowRef.current = onTimeWindowChange; });
  useEffect(() => { brainstateIntervalsRef.current = brainstateIntervals; });
  useEffect(() => { brainstateEnabledRef.current = brainstateOverlayEnabled; });

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

    // Guard: suppress setScale during chart initialization so that creating or
    // recreating the navigator (e.g. when new query data arrives) does not fire
    // setTimeWindow with the full data range and reset whatever window the user had.
    // Set to true after the rAF so user drag-to-zoom still publishes normally.
    let initialized = false;

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
              if (!initialized || key !== "x") return;
              const { min, max } = u.scales.x;
              if (min != null && max != null) onWindowRef.current?.([min, max]);
            },
          ],
          drawClear: [
            makeBrainstateDrawHook(brainstateIntervalsRef, brainstateEnabledRef),
          ],
          draw: [
            (u) => {
              const t = selectionTimeRef.current;
              if (t == null || !Number.isFinite(t)) return;
              const x = Math.round(u.valToPos(t, "x", true));
              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = "rgba(120, 255, 240, 0.9)";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.restore();
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

    // After the next paint the layout is stable; enable setScale publishing from here on.
    // setSize (in ResizeObserver or rAF) also fires setScale — keep initialized=false
    // until after that call so the resize correction doesn't publish a spurious window.
    const rafId = requestAnimationFrame(() => {
      const w = el.clientWidth || el.getBoundingClientRect().width;
      if (w && chartRef.current && w !== chartRef.current.width) {
        chartRef.current.setSize({ width: w, height: 80 });
      }
      initialized = true;
    });

    return () => {
      cancelAnimationFrame(rafId);
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
    selectionTimeRef.current = selection?.time ?? null;
    if (!chart || times.length === 0 || !selection) return;
    const x = chart.valToPos(selection.time, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
    chart.redraw();
  }, [selection?.time, times]);

  // ── Hot sync: redraw when brainstate intervals or overlay toggle change ──
  useEffect(() => {
    chartRef.current?.redraw();
  }, [brainstateIntervals, brainstateOverlayEnabled]);

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
