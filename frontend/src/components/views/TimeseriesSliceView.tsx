import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { decodeArrowSlice, extractTimeseriesColumnar } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";

type GestureTool = "pan" | "zoom";

const COLORS = ["#d3ff68", "#73d2de", "#ff9770", "#c492ff", "#f4d35e", "#8bd450", "#ff6b9d", "#a8e6cf"];

export function TimeseriesSliceView({ slice, selection, events = [], onSelectTime }: SliceViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const onSelectTimeRef = useRef(onSelectTime);
  const eventsRef = useRef(events);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { eventsRef.current = events; });

  const [activeTool, setActiveTool] = useState<GestureTool>("zoom");
  const [wheelZoom, setWheelZoom] = useState(true);
  // Refs mirror state so event handlers always read current values without stale closures
  const activeToolRef = useRef<GestureTool>("zoom");
  const wheelZoomRef = useRef(true);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { wheelZoomRef.current = wheelZoom; }, [wheelZoom]);

  const initialScalesRef = useRef<{ min: number; max: number } | null>(null);

  const { times, series } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    const raw = extractTimeseriesColumnar(decoded);
    return { times: raw.times, series: raw.series.slice(0, 32) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || times.length === 0) return;

    chartRef.current?.destroy();
    chartRef.current = null;
    initialScalesRef.current = null;

    const width = el.clientWidth || el.getBoundingClientRect().width || 900;

    const opts: uPlot.Options = {
      width,
      height: 260,
      legend: { show: false },
      cursor: {
        // We own all interaction; disable uPlot's built-in drag-zoom
        drag: { setScale: false, x: false, y: false },
        sync: { key: "tsscope-time" },
      },
      axes: [
        { stroke: "#8b949e", ticks: { stroke: "#30363d" }, grid: { stroke: "#21262d" } },
        { stroke: "#8b949e", ticks: { stroke: "#30363d" }, grid: { stroke: "#21262d" } },
      ],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          stroke: COLORS[i % COLORS.length],
          width: 1.5,
          spanGaps: false,
        })),
      ],
      hooks: {
        draw: [
          (u) => {
            // Always read eventsRef so markers update without recreating the chart
            const evs = eventsRef.current;
            if (!evs.length) return;
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = "rgba(255,180,50,0.7)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            for (const ev of evs) {
              const t = Number((ev.record as Record<string, unknown>).t ?? NaN);
              if (!Number.isFinite(t)) continue;
              const x = Math.round(u.valToPos(t, "x", true));
              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
            }
            ctx.restore();
          },
        ],
      },
    };

    const data: uPlot.AlignedData = [
      new Float64Array(times),
      ...series.map((s) => new Float32Array(s.values)),
    ];

    const chart = new uPlot(opts, data, el);
    chartRef.current = chart;

    // Capture initial x-scale for the Reset button
    const { min, max } = chart.scales.x;
    if (min != null && max != null) initialScalesRef.current = { min, max };

    // ── Gesture setup ────────────────────────────────────────────
    // All interaction is handled on chart.over — the transparent overlay
    // that uPlot positions exactly over the plot area (inside the axes).
    // Coordinates in .u-over space == plot-area CSS pixels, so we can use
    // simple linear interpolation against chart.scales.x without posToVal().
    const over = chart.over;

    // Zoom selection rect lives inside .u-over for correct relative positioning
    const selBox = document.createElement("div");
    selBox.className = "ts-sel-box";
    over.appendChild(selBox);

    type DragState = {
      active: boolean;
      startX: number;   // in .u-over CSS px
      startMin: number; // x-scale min at drag start
      startMax: number;
      moved: boolean;
      cachedOverLeft: number; // viewport px — cached on mousedown to avoid layout in mousemove
      cachedPlotW: number;
    };
    const drag: DragState = {
      active: false, startX: 0, startMin: 0, startMax: 0,
      moved: false, cachedOverLeft: 0, cachedPlotW: 1,
    };

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    // Returns x position in .u-over coordinates from a client event, clamped to plot bounds
    const overX = (clientX: number) => clamp(clientX - drag.cachedOverLeft, 0, drag.cachedPlotW);

    // Linear interpolation: fraction of plot width → data value
    const fracToVal = (frac: number) => {
      const xMin = chart.scales.x.min ?? drag.startMin;
      const xMax = chart.scales.x.max ?? drag.startMax;
      return xMin + frac * (xMax - xMin);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault(); // prevent text selection during drag

      const rect = over.getBoundingClientRect();
      drag.active = true;
      drag.moved = false;
      drag.cachedOverLeft = rect.left;
      drag.cachedPlotW = over.clientWidth || 1;
      drag.startX = e.clientX - rect.left;
      drag.startMin = chart.scales.x.min ?? 0;
      drag.startMax = chart.scales.x.max ?? 1;

      if (activeToolRef.current === "pan") {
        over.style.cursor = "grabbing";
      } else {
        // zoom: initialise selection rect at click point
        selBox.style.left = `${drag.startX}px`;
        selBox.style.width = "0px";
        selBox.style.display = "block";
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!drag.active) return;
      const x = overX(e.clientX);
      const dx = x - drag.startX;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (!drag.moved) return;

      if (activeToolRef.current === "pan") {
        // Shift scale by the fraction of plot width dragged
        const range = drag.startMax - drag.startMin;
        const shift = (-dx / drag.cachedPlotW) * range;
        chart.setScale("x", { min: drag.startMin + shift, max: drag.startMax + shift });
      } else {
        // Grow the selection rect
        const left = Math.min(drag.startX, x);
        selBox.style.left = `${left}px`;
        selBox.style.width = `${Math.abs(dx)}px`;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!drag.active || e.button !== 0) return;
      drag.active = false;
      const x = overX(e.clientX);

      if (activeToolRef.current === "pan") {
        over.style.cursor = "grab";
        if (!drag.moved) {
          // single click in pan mode: set time
          const t = fracToVal(x / drag.cachedPlotW);
          if (Number.isFinite(t)) onSelectTimeRef.current?.(t);
        }
      } else {
        selBox.style.display = "none";
        if (drag.moved) {
          // apply box zoom from the selected pixel range
          const x0 = Math.min(drag.startX, x);
          const x1 = Math.max(drag.startX, x);
          if (x1 - x0 > 4) {
            // Use the scale at drag-start time so nested zooms are stable
            const range = drag.startMax - drag.startMin;
            chart.setScale("x", {
              min: drag.startMin + (x0 / drag.cachedPlotW) * range,
              max: drag.startMin + (x1 / drag.cachedPlotW) * range,
            });
          }
        } else {
          // single click in zoom mode: set time
          const t = fracToVal(x / drag.cachedPlotW);
          if (Number.isFinite(t)) onSelectTimeRef.current?.(t);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!wheelZoomRef.current) return;
      e.preventDefault();
      const xMin = chart.scales.x.min ?? 0;
      const xMax = chart.scales.x.max ?? 1;
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      // zoom centre = cursor position interpolated in current scale
      const plotW = over.clientWidth || 1;
      const xInOver = e.clientX - over.getBoundingClientRect().left;
      const xCenter = xMin + clamp(xInOver / plotW, 0, 1) * (xMax - xMin);
      chart.setScale("x", {
        min: xCenter + (xMin - xCenter) * factor,
        max: xCenter + (xMax - xCenter) * factor,
      });
    };

    over.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    over.addEventListener("wheel", onWheel, { passive: false });

    // Set initial cursor style (in case tool changed while chart was unmounted)
    over.style.cursor = activeToolRef.current === "pan" ? "grab" : "crosshair";

    // Resize chart when container width changes (attached here, so it's always live)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.setSize({ width: w, height: 260 });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      over.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      over.removeEventListener("wheel", onWheel);
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, series]);

  // Update cursor style when tool changes without recreating the chart
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.over.style.cursor = activeTool === "pan" ? "grab" : "crosshair";
  }, [activeTool]);

  // Keep the cursor marker in sync with the current selection time
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || times.length === 0 || !selection) return;
    const x = chart.valToPos(selection.time, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
  }, [selection?.time, times]);

  const resetScales = () => {
    const chart = chartRef.current;
    const init = initialScalesRef.current;
    if (!chart || !init) return;
    chart.setScale("x", { min: init.min, max: init.max });
  };

  if (!selection || times.length === 0) return null;

  return (
    <div style={{ position: "relative" }}>
      <div className="ts-toolbar">
        <button
          type="button"
          className={`ts-tool${activeTool === "zoom" ? " active" : ""}`}
          title="Box Zoom — drag to zoom a region"
          onClick={() => setActiveTool("zoom")}
        >⊡</button>
        <button
          type="button"
          className={`ts-tool${activeTool === "pan" ? " active" : ""}`}
          title="Pan — drag to scroll"
          onClick={() => setActiveTool("pan")}
        >⟺</button>
        <button
          type="button"
          className={`ts-tool${wheelZoom ? " active" : ""}`}
          title={`Wheel Zoom ${wheelZoom ? "(ON)" : "(OFF)"} — scroll to zoom at cursor`}
          onClick={() => setWheelZoom((v) => !v)}
        >⊙</button>
        <button
          type="button"
          className="ts-tool"
          title="Reset view"
          onClick={resetScales}
        >↺</button>
      </div>
      <div
        ref={containerRef}
        className="uplot-wrap"
        title={`${series.length} ch · ${times.length} samples`}
      />
    </div>
  );
}
