/**
 * TrajectoryView — a 2-D projection of a behavioral position path with a
 * cursor-linked marker. The position tensor is (time, axis); the view plots any
 * two axes (xy/xz/yz, selectable) as a time-faded trail, draws a dot at the
 * sample nearest the current time cursor, and seeks to the nearest sample on
 * click. Canvas 2-D (no WebGL dependency).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeArrowSlice, extractTrajectory } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";
import {
  availableAxisPairs,
  axisExtent,
  nearestSampleInPlane,
  nearestTimeIndex,
} from "./trajectoryLogic";

const PAD = 22;

export function TrajectoryView({ slice, selection, onSelectTime }: SliceViewProps) {
  const traj = useMemo(() => extractTrajectory(decodeArrowSlice(slice)), [slice]);
  const pairs = useMemo(() => availableAxisPairs(traj.axes), [traj.axes]);
  const [pairIdx, setPairIdx] = useState(0);
  const pair = pairs[Math.min(pairIdx, Math.max(pairs.length - 1, 0))];

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectTimeRef = useRef(onSelectTime);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });

  const cursorIdx = useMemo(
    () => (selection ? nearestTimeIndex(traj.times, selection.time) : -1),
    [traj.times, selection],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !pair) return;
    const xs = traj.byAxis[pair.a];
    const ys = traj.byAxis[pair.b];
    if (!xs || !ys || traj.times.length === 0) return;

    const [ax0, ax1] = axisExtent(xs);
    const [ay0, ay1] = axisExtent(ys);

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

      const plotW = w - 2 * PAD;
      const plotH = h - 2 * PAD;
      const xOf = (v: number) => PAD + ((v - ax0) / (ax1 - ax0 || 1)) * plotW;
      const yOf = (v: number) => PAD + (1 - (v - ay0) / (ay1 - ay0 || 1)) * plotH;

      ctx.clearRect(0, 0, w, h);

      // Time-faded trail: older segments dimmer.
      const n = traj.times.length;
      ctx.lineWidth = 1;
      let prevX = 0;
      let prevY = 0;
      let prevValid = false;
      for (let i = 0; i < n; i++) {
        const x = xs[i];
        const y = ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) { prevValid = false; continue; }
        const px = xOf(x);
        const py = yOf(y);
        if (prevValid) {
          ctx.strokeStyle = `rgba(105, 219, 124, ${0.15 + 0.55 * (i / n)})`;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
        prevX = px;
        prevY = py;
        prevValid = true;
      }

      // Cursor marker.
      if (cursorIdx >= 0) {
        const cx = xs[cursorIdx];
        const cy = ys[cursorIdx];
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
          ctx.fillStyle = "#ffd166";
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.beginPath();
          ctx.arc(xOf(cx), yOf(cy), 4, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Axis labels.
      ctx.fillStyle = "#8b949e";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(pair.a, w - PAD - 10, h - 4);
      ctx.textBaseline = "top";
      ctx.fillText(pair.b, 4, 4);
    };

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [traj, pair, cursorIdx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !pair) return;
    const xs = traj.byAxis[pair.a];
    const ys = traj.byAxis[pair.b];
    if (!xs || !ys) return;
    const [ax0, ax1] = axisExtent(xs);
    const [ay0, ay1] = axisExtent(ys);
    const handleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const plotW = rect.width - 2 * PAD;
      const plotH = rect.height - 2 * PAD;
      const fx = (e.clientX - rect.left - PAD) / (plotW || 1);
      const fy = (e.clientY - rect.top - PAD) / (plotH || 1);
      const dataX = ax0 + fx * (ax1 - ax0);
      const dataY = ay0 + (1 - fy) * (ay1 - ay0);
      const idx = nearestSampleInPlane(traj, pair.a, pair.b, dataX, dataY);
      if (idx >= 0) onSelectTimeRef.current?.(traj.times[idx]);
    };
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [traj, pair]);

  if (traj.times.length === 0) {
    return <div className="placeholder">No position data</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {pairs.length > 1 && (
        <div style={{ padding: "2px 6px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#8b949e" }}>plane</span>
          <select
            value={pairIdx}
            onChange={(e) => setPairIdx(Number(e.target.value))}
            style={{ fontSize: 12 }}
          >
            {pairs.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, cursor: "crosshair" }}>
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>
    </div>
  );
}
