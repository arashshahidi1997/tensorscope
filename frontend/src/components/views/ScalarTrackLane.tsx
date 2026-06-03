/**
 * ScalarTrackLane — a thin strip plotting a continuous scalar context track
 * (e.g. speed) over the full session, with a visible-window box and time cursor.
 *
 * Mirrors HypnogramView: Canvas 2D, a 50px left label gutter, X = time over the
 * full recording range, click-to-seek. The series is already decimated server
 * side (min/max envelope), so we just draw the polyline as-is.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ScalarSeriesDTO } from "../../api/types";
import { scalarValueRange } from "./trackLogic";

type ScalarTrackLaneProps = {
  series: ScalarSeriesDTO;
  label: string;
  /** Full time range of the recording. */
  timeRange: [number, number];
  /** Current visible time window (for the window box). */
  timeWindow?: [number, number];
  /** Current time cursor position. */
  timeCursor?: number;
  onSelectTime?: (t: number) => void;
};

const LABEL_WIDTH = 50;

export function ScalarTrackLane({
  series,
  label,
  timeRange,
  timeWindow,
  timeCursor,
  onSelectTime,
}: ScalarTrackLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectTimeRef = useRef(onSelectTime);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });

  const [vMin, vMax] = useMemo(() => scalarValueRange(series.v), [series.v]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || series.t.length === 0) return;

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

      const plotLeft = LABEL_WIDTH;
      const plotWidth = w - LABEL_WIDTH;
      const pad = 3;
      const vRange = vMax - vMin || 1;
      const xOf = (t: number) => plotLeft + ((t - t0) / tRange) * plotWidth;
      const yOf = (v: number) => h - pad - ((v - vMin) / vRange) * (h - 2 * pad);

      ctx.clearRect(0, 0, w, h);

      // Label + value range on the left.
      ctx.fillStyle = "#8b949e";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(label, LABEL_WIDTH - 6, 3);
      ctx.textBaseline = "bottom";
      ctx.fillText(vMax.toFixed(0), LABEL_WIDTH - 6, 14);
      ctx.fillText(vMin.toFixed(0), LABEL_WIDTH - 6, h - 1);

      // Trace.
      ctx.strokeStyle = "#69db7c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < series.t.length; i++) {
        const x = xOf(series.t[i]);
        const y = yOf(series.v[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Visible-window box.
      if (timeWindow) {
        const wx0 = xOf(timeWindow[0]);
        const wx1 = xOf(timeWindow[1]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.max(wx0, plotLeft), 0, Math.min(wx1, w) - Math.max(wx0, plotLeft), h);
      }

      // Time cursor.
      if (timeCursor != null && Number.isFinite(timeCursor)) {
        const cx = xOf(timeCursor);
        if (cx >= plotLeft && cx <= w) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, h);
          ctx.stroke();
        }
      }
    };

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [series, label, timeRange, timeWindow, timeCursor, vMin, vMax]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const handleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const plotWidth = rect.width - LABEL_WIDTH;
      if (x < 0 || x > plotWidth) return;
      const [t0, t1] = timeRange;
      const t = t0 + (x / plotWidth) * (t1 - t0);
      if (Number.isFinite(t)) onSelectTimeRef.current?.(t);
    };
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [timeRange]);

  if (series.t.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="scalar-track-lane"
      style={{ width: "100%", height: 44, cursor: "crosshair" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
