import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { decodeArrowSlice, extractTimeseriesColumnar } from "../../api/arrow";
import type { BrainstateIntervalDTO } from "../../api/types";
import type { SliceViewProps } from "./viewTypes";
import { ChartToolbar, TimeScaleBar } from "./ChartToolbar";
import { useChartTools } from "./useChartTools";
import type { GestureTool, YMode } from "./useChartTools";
import { makeBrainstateDrawHook } from "./brainstateOverlay";

const COLORS = ["#d3ff68", "#73d2de", "#ff9770", "#c492ff", "#f4d35e", "#8bd450", "#ff6b9d", "#a8e6cf"];

// ─────────────────────────────────────────────────────────────────────────────
// Relative time formatter (F3)
// ─────────────────────────────────────────────────────────────────────────────

function formatRelativeTime(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 0.001) return `${(seconds * 1e6).toFixed(0)} \u00B5s`;
  if (abs < 1) return `${(seconds * 1000).toFixed(1)} ms`;
  if (abs < 60) return `${seconds.toFixed(3)} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1)}`;
}

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
  yModeRef: React.RefObject<YMode>;
  /** Locked Y-axis bounds for yZoom mode. */
  yLockedRef: React.MutableRefObject<[number, number] | null>;
  /** Gain multiplier for yGain mode. */
  gainMultiplierRef: React.MutableRefObject<number>;
  /** Callback to rebuild scaled data after gain change. */
  onGainChange: () => void;
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

  // ── X-axis wheel zoom (fires on the plot overlay) ────────────────────────
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

  // ── Y-axis wheel handler (fires on root, cursor in axis gutter) ──────────
  //
  // Two modes controlled by yMode:
  //   yZoom → zoom Y-axis range around cursor position. Uses yLockedRef.
  //   yGain → scale waveform amplitude without changing Y scale.
  const onWheelYAxis = (e: WheelEvent) => {
    if (!refs.wheelZoomRef.current) return;
    const overRect = over.getBoundingClientRect();
    // Only handle if cursor is in the Y-axis gutter (left of the plot area).
    if (e.clientX >= overRect.left) return;
    e.preventDefault();
    const yMin = chart.scales.y?.min ?? -1;
    const yMax = chart.scales.y?.max ?? 1;
    // Scroll down (deltaY > 0) → zoom out (larger range); up → zoom in.
    const factor = e.deltaY > 0 ? 1.25 : 0.8;

    if (refs.yModeRef.current === "yZoom") {
      // yZoom: zoom around cursor Y position
      const overH = over.clientHeight || 1;
      const yInOver = e.clientY - overRect.top;
      const yFrac = clamp(yInOver / overH, 0, 1);
      // uPlot Y: top of over = yMax, bottom = yMin
      const yCursor = yMax + yFrac * (yMin - yMax);
      refs.yLockedRef.current = [
        yCursor + (yMin - yCursor) * factor,
        yCursor + (yMax - yCursor) * factor,
      ];
      chart.redraw();
    } else {
      // yGain: scale waveform amplitude without changing Y scale
      refs.gainMultiplierRef.current *= factor;
      refs.onGainChange();
    }
  };

  over.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  over.addEventListener("wheel", onWheel, { passive: false });
  chart.root.addEventListener("wheel", onWheelYAxis, { passive: false });
  over.style.cursor = refs.toolRef.current === "pan" ? "grab" : "crosshair";

  return () => {
    over.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    over.removeEventListener("wheel", onWheel);
    chart.root.removeEventListener("wheel", onWheelYAxis);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TimeseriesSliceView({
  slice,
  selection,
  events = [],
  brainstateIntervals = [],
  brainstateOverlayEnabled = false,
  onSelectTime,
  onTimeWindowChange,
}: SliceViewProps & {
  brainstateIntervals?: BrainstateIntervalDTO[];
  brainstateOverlayEnabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Stable callback refs — updated every render, never trigger chart recreation
  const onSelectTimeRef = useRef(onSelectTime);
  const eventsRef = useRef(events);
  const onTimeWindowChangeRef = useRef(onTimeWindowChange);
  const brainstateIntervalsRef = useRef(brainstateIntervals);
  const brainstateEnabledRef = useRef(brainstateOverlayEnabled);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { eventsRef.current = events; });
  useEffect(() => { onTimeWindowChangeRef.current = onTimeWindowChange; });
  useEffect(() => { brainstateIntervalsRef.current = brainstateIntervals; });
  useEffect(() => { brainstateEnabledRef.current = brainstateOverlayEnabled; });

  // View-local tool state — chartRef is shared so the hook can call reset imperatively
  const tools = useChartTools(chartRef);

  // ── Y-axis lock for yZoom mode (B1) ───────────────────────────────────────
  const yLockedRef = useRef<[number, number] | null>(null);

  // ── Gain multiplier for yGain mode (F1) ───────────────────────────────────
  const gainMultiplierRef = useRef(1);

  // ── Persistent time cursor ref (F4) ───────────────────────────────────────
  const selectionTimeRef = useRef<number | null>(null);

  // ── Raw decoded data — kept for gain rebuilds ─────────────────────────────
  const rawDataRef = useRef<{ times: Float64Array; seriesArrays: Float32Array[]; offsets: number[] } | null>(null);

  // ── Data decoding ────────────────────────────────────────────────────────
  const { times, series } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    const raw = extractTimeseriesColumnar(decoded);
    return { times: raw.times, series: raw.series.slice(0, 32) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  // Rebuild scaled data for gain mode: scale each channel around its offset center
  const buildScaledData = (
    timesArr: Float64Array,
    seriesData: { values: number[] }[],
    gain: number,
  ): [Float64Array, ...Float32Array[]] => {
    const result: [Float64Array, ...Float32Array[]] = [timesArr];
    const offsets: number[] = [];
    for (const s of seriesData) {
      const vals = s.values;
      // Compute channel offset as mean value
      let sum = 0, count = 0;
      for (const v of vals) {
        if (Number.isFinite(v)) { sum += v; count++; }
      }
      const offset = count > 0 ? sum / count : 0;
      offsets.push(offset);
      const scaled = new Float32Array(vals.length);
      for (let i = 0; i < vals.length; i++) {
        scaled[i] = offset + (vals[i] - offset) * gain;
      }
      result.push(scaled);
    }
    rawDataRef.current = {
      times: timesArr,
      seriesArrays: seriesData.map((s) => new Float32Array(s.values)),
      offsets,
    };
    return result;
  };

  // Called by gesture handler when gain changes
  const applyGain = () => {
    const chart = chartRef.current;
    const raw = rawDataRef.current;
    if (!chart || !raw) return;
    const gain = gainMultiplierRef.current;
    const data: [Float64Array, ...Float32Array[]] = [raw.times];
    for (let i = 0; i < raw.seriesArrays.length; i++) {
      const vals = raw.seriesArrays[i];
      const offset = raw.offsets[i];
      const scaled = new Float32Array(vals.length);
      for (let j = 0; j < vals.length; j++) {
        scaled[j] = offset + (vals[j] - offset) * gain;
      }
      data.push(scaled);
    }
    chart.setData(data as uPlot.AlignedData);
  };

  // ── Chart lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || times.length === 0) return;

    const width = el.clientWidth || el.getBoundingClientRect().width || 900;
    const height = el.clientHeight || 260;

    // Suppress setScale during chart initialization — same guard as NavigatorView.
    let initialized = false;

    // Reset Y lock and gain on new data
    yLockedRef.current = null;
    gainMultiplierRef.current = 1;

    const initialData = buildScaledData(new Float64Array(times), series, 1);

    const chart = new uPlot(
      {
        width,
        height,
        legend: { show: false },
        cursor: {
          drag: { setScale: false, x: false, y: false },
          sync: { key: "tsscope-time" },
        },
        scales: {
          y: {
            range: (_u: uPlot, dataMin: number, dataMax: number): [number, number] => {
              if (yLockedRef.current) return yLockedRef.current;
              return [dataMin, dataMax];
            },
          },
        },
        axes: [
          {
            label: "Time (s)",
            labelSize: 14,
            stroke: "#8b949e",
            ticks: { stroke: "#30363d" },
            grid: { stroke: "#21262d" },
            values: (_u: uPlot, vals: number[]) => vals.map((v) => formatRelativeTime(v)),
          },
          { label: "Amplitude", labelSize: 14, stroke: "#8b949e", ticks: { stroke: "#30363d" }, grid: { stroke: "#21262d" } },
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
            (u, key) => {
              if (!initialized || key !== "x") return;
              const { min, max } = u.scales.x;
              if (min != null && max != null) onTimeWindowChangeRef.current?.([min, max]);
            },
          ],
          drawClear: [
            makeBrainstateDrawHook(brainstateIntervalsRef, brainstateEnabledRef),
          ],
          draw: [
            (u) => {
              // Event markers
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
            (u) => {
              // Persistent time cursor line (F4)
              const t = selectionTimeRef.current;
              if (t == null || !Number.isFinite(t)) return;
              const x = Math.round(u.valToPos(t, "x", true));
              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
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
      initialData as uPlot.AlignedData,
      el,
    );

    chartRef.current = chart;
    tools.onChartCreated(chart);

    const detachGestures = attachGestures(chart, {
      onSelectTimeRef,
      toolRef: tools.toolRef,
      wheelZoomRef: tools.wheelZoomRef,
      yModeRef: tools.yModeRef,
      yLockedRef,
      gainMultiplierRef,
      onGainChange: applyGain,
    });

    // B3: skip degenerate sizes; use dynamic height
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 10 || rect.height < 10) return;
      if (chartRef.current) {
        chartRef.current.setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    });
    ro.observe(el);

    // Correct the size once after the browser has finished laying out the
    // container. clientWidth can be 0 at effect time. Use a double-RAF to
    // ensure the flex layout has fully settled before reading dimensions.
    let rafId1 = 0;
    let rafId2 = 0;
    const correctSize = () => {
      const w = el.clientWidth || el.getBoundingClientRect().width;
      const h = el.clientHeight || el.getBoundingClientRect().height;
      if (w > 10 && h > 10 && chartRef.current) {
        chartRef.current.setSize({ width: Math.round(w), height: Math.round(h) });
      }
    };
    rafId1 = requestAnimationFrame(() => {
      correctSize();
      // Second RAF catches cases where flex layout settles a frame later
      rafId2 = requestAnimationFrame(() => {
        correctSize();
        initialized = true;
      });
    });

    return () => {
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      ro.disconnect();
      detachGestures();
      chartRef.current = null;
      yLockedRef.current = null;
      gainMultiplierRef.current = 1;
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

  // ── Hot sync: cursor marker + persistent cursor line follow selection ─────
  useEffect(() => {
    const chart = chartRef.current;
    selectionTimeRef.current = selection?.time ?? null;
    if (!chart || times.length === 0 || !selection) return;
    const x = chart.valToPos(selection.time, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
    chart.redraw();
  }, [selection?.time, times]);

  // ── Hot sync: redraw when event list changes ─────────────────────────────
  useEffect(() => {
    chartRef.current?.redraw();
  }, [events]);

  // ── Hot sync: redraw when brainstate intervals or overlay toggle change ──
  useEffect(() => {
    chartRef.current?.redraw();
  }, [brainstateIntervals, brainstateOverlayEnabled]);

  // Rules of Hooks: all hooks above, conditional return below
  if (!selection || times.length === 0) return null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <ChartToolbar
        activeTool={tools.activeTool}
        onSetTool={tools.setActiveTool}
        wheelZoom={tools.wheelZoom}
        onToggleWheelZoom={tools.toggleWheelZoom}
        onReset={() => {
          yLockedRef.current = null;
          gainMultiplierRef.current = 1;
          // Rebuild data with gain=1
          const raw = rawDataRef.current;
          if (raw && chartRef.current) {
            const data: [Float64Array, ...Float32Array[]] = [raw.times, ...raw.seriesArrays];
            chartRef.current.setData(data as uPlot.AlignedData);
          }
          tools.reset();
        }}
        yMode={tools.yMode}
        onSetYMode={tools.setYMode}
      />
      <div
        ref={containerRef}
        className="uplot-wrap"
        style={{ flex: 1, minHeight: 0 }}
        title={`${series.length} ch \u00B7 ${times.length} samples`}
      />
      {onTimeWindowChange && (
        <TimeScaleBar timeCursor={selection.time} onTimeWindowChange={onTimeWindowChange} />
      )}
    </div>
  );
}
