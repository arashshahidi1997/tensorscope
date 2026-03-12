/**
 * HypnogramView — narrow strip chart showing brainstate as colored bars over time.
 *
 * X-axis: time (synced with timeseries/navigator).
 * Y-axis: a single row of colored rectangles for each state interval.
 * Renders with Canvas 2D for simplicity and performance.
 */
import { useEffect, useRef, useMemo } from "react";
import type { BrainstateIntervalDTO } from "../../api/types";
import { getSolidColor, HYPNOGRAM_STATE_ORDER } from "./brainstateColors";

type HypnogramViewProps = {
  intervals: BrainstateIntervalDTO[];
  /** Full time range of the recording. */
  timeRange: [number, number];
  /** Current visible time window (for cursor overlay). */
  timeWindow?: [number, number];
  /** Current time cursor position. */
  timeCursor?: number;
  onSelectTime?: (t: number) => void;
};

export function HypnogramView({
  intervals,
  timeRange,
  timeWindow,
  timeCursor,
  onSelectTime,
}: HypnogramViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectTimeRef = useRef(onSelectTime);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });

  // Determine unique states present, ordered by HYPNOGRAM_STATE_ORDER
  const stateList = useMemo(() => {
    const present = new Set(intervals.map((iv) => iv.state));
    const ordered = HYPNOGRAM_STATE_ORDER.filter((s) => present.has(s));
    // Add any states not in the standard order
    for (const s of present) {
      if (!ordered.includes(s)) ordered.push(s);
    }
    return ordered;
  }, [intervals]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || intervals.length === 0) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const dpr = devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const [t0, t1] = timeRange;
      const tRange = t1 - t0;
      if (tRange <= 0) return;

      const labelWidth = 50;
      const plotLeft = labelWidth;
      const plotWidth = w - labelWidth;
      const nStates = stateList.length || 1;
      const rowHeight = h / nStates;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Draw state labels on the left
      ctx.fillStyle = "#8b949e";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i < stateList.length; i++) {
        ctx.fillText(stateList[i], labelWidth - 6, i * rowHeight + rowHeight / 2);
      }

      // Draw interval bars
      const stateIndex = new Map(stateList.map((s, i) => [s, i]));
      for (const iv of intervals) {
        const x0 = plotLeft + ((iv.start - t0) / tRange) * plotWidth;
        const x1 = plotLeft + ((iv.end - t0) / tRange) * plotWidth;
        if (x1 < plotLeft || x0 > w) continue;
        const cx0 = Math.max(x0, plotLeft);
        const cx1 = Math.min(x1, w);
        const row = stateIndex.get(iv.state) ?? 0;
        const y = row * rowHeight + 1;
        const rh = rowHeight - 2;
        ctx.fillStyle = getSolidColor(iv.state);
        ctx.globalAlpha = 0.6;
        ctx.fillRect(cx0, y, cx1 - cx0, rh);
      }
      ctx.globalAlpha = 1.0;

      // Draw time window highlight
      if (timeWindow) {
        const wx0 = plotLeft + ((timeWindow[0] - t0) / tRange) * plotWidth;
        const wx1 = plotLeft + ((timeWindow[1] - t0) / tRange) * plotWidth;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          Math.max(wx0, plotLeft),
          0,
          Math.min(wx1, w) - Math.max(wx0, plotLeft),
          h,
        );
      }

      // Draw time cursor
      if (timeCursor != null && Number.isFinite(timeCursor)) {
        const cx = plotLeft + ((timeCursor - t0) / tRange) * plotWidth;
        if (cx >= plotLeft && cx <= w) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, h);
          ctx.stroke();
        }
      }

      // Draw grid lines between rows
      ctx.strokeStyle = "#30363d";
      ctx.lineWidth = 0.5;
      for (let i = 1; i < nStates; i++) {
        const y = i * rowHeight;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    };

    draw();

    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [intervals, timeRange, timeWindow, timeCursor, stateList]);

  // Click handler — select time
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const handleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const labelWidth = 50;
      const x = e.clientX - rect.left - labelWidth;
      const plotWidth = rect.width - labelWidth;
      if (x < 0 || x > plotWidth) return;
      const frac = x / plotWidth;
      const [t0, t1] = timeRange;
      const t = t0 + frac * (t1 - t0);
      if (Number.isFinite(t)) onSelectTimeRef.current?.(t);
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [timeRange]);

  if (intervals.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="hypnogram-bar"
      style={{
        width: "100%",
        height: "100%",
        minHeight: 40,
        cursor: "crosshair",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
