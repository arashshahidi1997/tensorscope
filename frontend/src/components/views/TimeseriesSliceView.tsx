import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { decodeArrowSlice, extractTimeseriesColumnar } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";
import { ChartToolbar } from "./ChartToolbar";
import { useChartTools } from "./useChartTools";
import type { GestureTool } from "./useChartTools";

const COLORS = ["#d3ff68", "#73d2de", "#ff9770", "#c492ff", "#f4d35e", "#8bd450", "#ff6b9d", "#a8e6cf"];

// ─────────────────────────────────────────────────────────────────────────────
// Gesture layer
//
// Pure imperative interaction — no React state involved.
// Attach after chart creation; returns a cleanup function.
// To add a new gesture mode: extend GestureRefs + handlers below,
// without touching chart creation code.
// ─────────────────────────────────────────────────────────────────────────────

type GestureRefs = {
  onSelectTimeRef: React.RefObject<((t: number) => void) | undefined>;
  toolRef: React.RefObject<GestureTool>;
  wheelZoomRef: React.RefObject<boolean>;
};

function attachGestures(chart: uPlot, refs: GestureRefs): () => void {
  const over = chart.over;

  const selBox = document.createElement("div");
  selBox.className = "ts-sel-box";
  over.appendChild(selBox);

  type DragState = {
    active: boolean;
    startX: number;
    startMin: number;
    startMax: number;
    moved: boolean;
    cachedOverLeft: number;
    cachedPlotW: number;
  };
  const drag: DragState = {
    active: false, startX: 0, startMin: 0, startMax: 0,
    moved: false, cachedOverLeft: 0, cachedPlotW: 1,
  };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const overX = (clientX: number) => clamp(clientX - drag.cachedOverLeft, 0, drag.cachedPlotW);
  const fracToVal = (frac: number) => {
    const xMin = chart.scales.x.min ?? drag.startMin;
    const xMax = chart.scales.x.max ?? drag.startMax;
    return xMin + frac * (xMax - xMin);
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = over.getBoundingClientRect();
    drag.active = true;
    drag.moved = false;
    drag.cachedOverLeft = rect.left;
    drag.cachedPlotW = over.clientWidth || 1;
    drag.startX = e.clientX - rect.left;
    drag.startMin = chart.scales.x.min ?? 0;
    drag.startMax = chart.scales.x.max ?? 1;
    if (refs.toolRef.current === "pan") {
      over.style.cursor = "grabbing";
    } else {
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
    if (refs.toolRef.current === "pan") {
      const range = drag.startMax - drag.startMin;
      const shift = (-dx / drag.cachedPlotW) * range;
      chart.setScale("x", { min: drag.startMin + shift, max: drag.startMax + shift });
    } else {
      const left = Math.min(drag.startX, x);
      selBox.style.left = `${left}px`;
      selBox.style.width = `${Math.abs(dx)}px`;
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    if (!drag.active || e.button !== 0) return;
    drag.active = false;
    const x = overX(e.clientX);
    if (refs.toolRef.current === "pan") {
      over.style.cursor = "grab";
      if (!drag.moved) {
        const t = fracToVal(x / drag.cachedPlotW);
        if (Number.isFinite(t)) refs.onSelectTimeRef.current?.(t);
      }
    } else {
      selBox.style.display = "none";
      if (drag.moved) {
        const x0 = Math.min(drag.startX, x);
        const x1 = Math.max(drag.startX, x);
        if (x1 - x0 > 4) {
          const range = drag.startMax - drag.startMin;
          chart.setScale("x", {
            min: drag.startMin + (x0 / drag.cachedPlotW) * range,
            max: drag.startMin + (x1 / drag.cachedPlotW) * range,
          });
        }
      } else {
        const t = fracToVal(x / drag.cachedPlotW);
        if (Number.isFinite(t)) refs.onSelectTimeRef.current?.(t);
      }
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!refs.wheelZoomRef.current) return;
    e.preventDefault();
    const xMin = chart.scales.x.min ?? 0;
    const xMax = chart.scales.x.max ?? 1;
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
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
  over.style.cursor = refs.toolRef.current === "pan" ? "grab" : "crosshair";

  return () => {
    over.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    over.removeEventListener("wheel", onWheel);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TimeseriesSliceView({
  slice,
  selection,
  events = [],
  onSelectTime,
  onTimeWindowChange,
}: SliceViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Stable callback refs — updated every render, never trigger chart recreation
  const onSelectTimeRef = useRef(onSelectTime);
  const eventsRef = useRef(events);
  const onTimeWindowChangeRef = useRef(onTimeWindowChange);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { eventsRef.current = events; });
  useEffect(() => { onTimeWindowChangeRef.current = onTimeWindowChange; });

  // View-local tool state — chartRef is shared so the hook can call reset imperatively
  const tools = useChartTools(chartRef);

  // ── Data decoding ────────────────────────────────────────────────────────
  const { times, series } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    const raw = extractTimeseriesColumnar(decoded);
    return { times: raw.times, series: raw.series.slice(0, 32) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  // ── Chart lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || times.length === 0) return;

    const width = el.clientWidth || el.getBoundingClientRect().width || 900;

    const chart = new uPlot(
      {
        width,
        height: 260,
        legend: { show: false },
        cursor: {
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
          setScale: [
            // Publish window changes back to shared state so the navigator
            // and other views stay in sync when the user pans or zooms here.
            (u, key) => {
              if (key !== "x") return;
              const { min, max } = u.scales.x;
              if (min != null && max != null) onTimeWindowChangeRef.current?.([min, max]);
            },
          ],
          draw: [
            (u) => {
              // eventsRef is always current — markers update without chart recreation
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
      },
      [new Float64Array(times), ...series.map((s) => new Float32Array(s.values))],
      el,
    );

    chartRef.current = chart;
    tools.onChartCreated(chart);

    const detachGestures = attachGestures(chart, {
      onSelectTimeRef,
      toolRef: tools.toolRef,
      wheelZoomRef: tools.wheelZoomRef,
    });

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.setSize({ width: w, height: 260 });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      detachGestures();
      chartRef.current = null;
      chart.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, series]);

  // ── Hot sync: cursor style when tool changes ─────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.over.style.cursor = tools.activeTool === "pan" ? "grab" : "crosshair";
  }, [tools.activeTool]);

  // ── Hot sync: cursor marker follows selection ────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || times.length === 0 || !selection) return;
    const x = chart.valToPos(selection.time, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
  }, [selection?.time, times]);

  // ── Hot sync: redraw when event list changes ─────────────────────────────
  useEffect(() => {
    chartRef.current?.redraw();
  }, [events]);

  // Rules of Hooks: all hooks above, conditional return below
  if (!selection || times.length === 0) return null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>
      <ChartToolbar
        activeTool={tools.activeTool}
        onSetTool={tools.setActiveTool}
        wheelZoom={tools.wheelZoom}
        onToggleWheelZoom={tools.toggleWheelZoom}
        onReset={tools.reset}
      />
      <div
        ref={containerRef}
        className="uplot-wrap"
        title={`${series.length} ch · ${times.length} samples`}
      />
    </div>
  );
}
