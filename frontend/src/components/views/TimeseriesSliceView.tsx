import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { extractTimeseriesColumnarFast } from "../../api/arrow";
import type { BrainstateIntervalDTO } from "../../api/types";
import type { SliceViewProps } from "./viewTypes";
import { ChartToolbar, TimeScaleBar } from "./ChartToolbar";
import { useChartTools } from "./useChartTools";
import type { GestureTool, YMode } from "./useChartTools";
import { makeBrainstateDrawHook } from "./brainstateOverlay";

const COLORS = ["#d3ff68", "#73d2de", "#ff9770", "#c492ff", "#f4d35e", "#8bd450", "#ff6b9d", "#a8e6cf"];

function formatRelativeTime(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 0.001) return `${(seconds * 1e6).toFixed(0)} \u00B5s`;
  if (abs < 1) return `${(seconds * 1000).toFixed(1)} ms`;
  if (abs < 60) return `${seconds.toFixed(3)} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1)}`;
}

type GestureRefs = {
  onSelectTimeRef: React.RefObject<((t: number) => void) | undefined>;
  toolRef: React.RefObject<GestureTool>;
  wheelZoomRef: React.RefObject<boolean>;
  yModeRef: React.RefObject<YMode>;
  yLockedRef: React.MutableRefObject<[number, number] | null>;
  gainMultiplierRef: React.MutableRefObject<number>;
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
    active: false,
    startX: 0,
    startMin: 0,
    startMax: 0,
    moved: false,
    cachedOverLeft: 0,
    cachedPlotW: 1,
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
      return;
    }

    const left = Math.min(drag.startX, x);
    selBox.style.left = `${left}px`;
    selBox.style.width = `${Math.abs(dx)}px`;
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
      return;
    }

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
      return;
    }

    const t = fracToVal(x / drag.cachedPlotW);
    if (Number.isFinite(t)) refs.onSelectTimeRef.current?.(t);
  };

  const onWheel = (e: WheelEvent) => {
    if (!refs.wheelZoomRef.current) return;
    if (e.shiftKey) return; // Shift+scroll is handled by onWheelYAxis for gain
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

  const onWheelYAxis = (e: WheelEvent) => {
    const overRect = over.getBoundingClientRect();

    // Shift+scroll anywhere on the chart applies gain
    if (e.shiftKey) {
      e.preventDefault();
      // Browsers may convert Shift+wheel to horizontal scroll (deltaY→0, deltaX has value)
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const factor = delta > 0 ? 1.25 : 0.8;
      refs.gainMultiplierRef.current *= factor;
      refs.onGainChange();
      return;
    }

    // Non-shift: only respond on the Y-axis area (left of plot), and only when wheel zoom is on
    if (!refs.wheelZoomRef.current) return;
    if (e.clientX >= overRect.left) return;
    e.preventDefault();

    const yMin = chart.scales.y?.min ?? -1;
    const yMax = chart.scales.y?.max ?? 1;
    const factor = e.deltaY > 0 ? 1.25 : 0.8;

    if (refs.yModeRef.current === "yZoom") {
      const overH = over.clientHeight || 1;
      const yInOver = e.clientY - overRect.top;
      const yFrac = clamp(yInOver / overH, 0, 1);
      const yCursor = yMax + yFrac * (yMin - yMax);
      refs.yLockedRef.current = [
        yCursor + (yMin - yCursor) * factor,
        yCursor + (yMax - yCursor) * factor,
      ];
      chart.redraw();
      return;
    }

    refs.gainMultiplierRef.current *= factor;
    refs.onGainChange();
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

type MeasuredSize = {
  width: number;
  height: number;
};

type ReadinessState =
  | "unmeasured"
  | "measured_zero"
  | "measured_nonzero_unstable"
  | "ready";

function measureContainer(el: HTMLDivElement): MeasuredSize | null {
  const width = el.clientWidth || el.getBoundingClientRect().width;
  const height = el.clientHeight || el.getBoundingClientRect().height;
  if (width < 10 || height < 10) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

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
  const chartCleanupRef = useRef<(() => void) | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const reconcileRafRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const suppressWindowPublishRef = useRef(false);
  const readinessRef = useRef<ReadinessState>("unmeasured");
  const xRangeRef = useRef<[number, number] | null>(null);
  const selectionTimeRef = useRef<number | null>(null);
  const yLockedRef = useRef<[number, number] | null>(null);
  const gainMultiplierRef = useRef(1);
  const rawDataRef = useRef<{ times: Float64Array; seriesArrays: Float32Array[]; offsets: number[] } | null>(null);
  const structuralKeyRef = useRef<string | null>(null);

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

  const tools = useChartTools(chartRef);

  const { times, series } = useMemo(() => {
    const raw = extractTimeseriesColumnarFast(slice);
    return {
      times: new Float64Array(raw.times),
      series: raw.series.slice(0, 32),
    };
  }, [slice.payload]);

  const structuralKey = useMemo(
    () => series.map((s) => `${s.key}:${s.label}`).join("|"),
    [series],
  );

  /**
   * Compute an optimal gain multiplier so that channel traces fill their
   * allocated vertical space.  The server z-scores each channel (std ≈ 1)
   * and spaces them 3 units apart.  We want the visible IQR (p25–p75) to
   * span about 60% of the 3-unit slot, so gain = target_range / actual_iqr.
   */
  const computeAutoGain = (seriesData: { values: number[] }[]): number => {
    const TARGET_FILL = 1.8; // how many units of the 3-unit slot we want the IQR to fill
    const iqrs: number[] = [];
    for (const s of seriesData) {
      const sorted = s.values.filter(Number.isFinite).sort((a, b) => a - b);
      if (sorted.length < 4) continue;
      // Compute IQR around each channel's mean (offset)
      let sum = 0;
      for (const v of sorted) sum += v;
      const mean = sum / sorted.length;
      const centered = sorted.map((v) => v - mean);
      centered.sort((a, b) => a - b);
      const q25 = centered[Math.floor(centered.length * 0.25)];
      const q75 = centered[Math.floor(centered.length * 0.75)];
      const iqr = q75 - q25;
      if (iqr > 1e-12) iqrs.push(iqr);
    }
    if (iqrs.length === 0) return 1;
    // Use the median IQR across channels
    iqrs.sort((a, b) => a - b);
    const medianIQR = iqrs[Math.floor(iqrs.length / 2)];
    return Math.max(0.1, Math.min(20, TARGET_FILL / medianIQR));
  };

  const buildScaledData = (
    timesArr: Float64Array,
    seriesData: { values: number[] }[],
    gain: number,
  ): [Float64Array, ...Float32Array[]] => {
    const result: [Float64Array, ...Float32Array[]] = [timesArr];
    const offsets: number[] = [];

    for (const s of seriesData) {
      const vals = s.values;
      let sum = 0;
      let count = 0;
      for (const v of vals) {
        if (Number.isFinite(v)) {
          sum += v;
          count += 1;
        }
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

  const buildChartData = (): [Float64Array, ...Float32Array[]] | null => {
    if (times.length === 0 || series.length === 0) return null;
    // In auto-gain mode, recompute the optimal gain for each new data payload
    if (tools.yModeRef.current === "yAuto") {
      gainMultiplierRef.current = computeAutoGain(series);
    }
    return buildScaledData(times, series, gainMultiplierRef.current);
  };

  const getMeasuredSize = () => {
    const el = containerRef.current;
    if (!el) {
      readinessRef.current = "unmeasured";
      return null;
    }
    const size = measureContainer(el);
    readinessRef.current = size ? "measured_nonzero_unstable" : "measured_zero";
    return size;
  };

  const withSuppressedWindowPublish = (fn: () => void) => {
    suppressWindowPublishRef.current = true;
    try {
      fn();
    } finally {
      suppressWindowPublishRef.current = false;
    }
  };

  const destroyChart = () => {
    chartCleanupRef.current?.();
    chartCleanupRef.current = null;
    chartRef.current = null;
    initializedRef.current = false;
  };

  const reconcileChartSize = () => {
    const chart = chartRef.current;
    const size = getMeasuredSize();
    if (!chart || !size) return false;

    if (chart.width !== size.width || chart.height !== size.height) {
      const range = xRangeRef.current;
      withSuppressedWindowPublish(() => {
        chart.setSize(size);
        if (range) chart.setScale("x", { min: range[0], max: range[1] });
      });
    }

    readinessRef.current = "ready";
    return true;
  };

  const applyGain = () => {
    const chart = chartRef.current;
    const raw = rawDataRef.current;
    if (!chart || !raw) return;

    const data: [Float64Array, ...Float32Array[]] = [raw.times];
    for (let i = 0; i < raw.seriesArrays.length; i++) {
      const vals = raw.seriesArrays[i];
      const offset = raw.offsets[i];
      const scaled = new Float32Array(vals.length);
      for (let j = 0; j < vals.length; j++) {
        scaled[j] = offset + (vals[j] - offset) * gainMultiplierRef.current;
      }
      data.push(scaled);
    }

    const range = xRangeRef.current;
    withSuppressedWindowPublish(() => {
      chart.setData(data as uPlot.AlignedData, false);
      if (range) chart.setScale("x", { min: range[0], max: range[1] });
    });
    chart.redraw();
  };

  const scheduleReconcile = (settleFrames = 2) => {
    if (reconcileRafRef.current != null) cancelAnimationFrame(reconcileRafRef.current);

    let framesRemaining = settleFrames;
    const tick = () => {
      if (framesRemaining > 0) {
        framesRemaining -= 1;
        reconcileRafRef.current = requestAnimationFrame(tick);
        return;
      }

      reconcileRafRef.current = null;
      const size = getMeasuredSize();
      const data = buildChartData();
      if (!size || !data) return;

      if (!chartRef.current) {
        const el = containerRef.current;
        if (!el) return;

        const chart = new uPlot(
          {
            width: size.width,
            height: size.height,
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
              {
                label: "Amplitude",
                labelSize: 14,
                stroke: "#8b949e",
                ticks: { stroke: "#30363d" },
                grid: { stroke: "#21262d" },
              },
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
                  if (key !== "x") return;
                  const { min, max } = u.scales.x;
                  if (min == null || max == null) return;
                  xRangeRef.current = [min, max];
                  if (!initializedRef.current || suppressWindowPublishRef.current) return;
                  onTimeWindowChangeRef.current?.([min, max]);
                },
              ],
              drawClear: [
                makeBrainstateDrawHook(brainstateIntervalsRef, brainstateEnabledRef),
              ],
              draw: [
                (u) => {
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
          data as uPlot.AlignedData,
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

        chartCleanupRef.current = () => {
          detachGestures();
          chart.destroy();
        };

        if (xRangeRef.current) {
          withSuppressedWindowPublish(() => {
            chart.setScale("x", { min: xRangeRef.current![0], max: xRangeRef.current![1] });
          });
        } else {
          const { min, max } = chart.scales.x;
          if (min != null && max != null) xRangeRef.current = [min, max];
        }

        requestAnimationFrame(() => {
          reconcileChartSize();
          initializedRef.current = true;
        });
        return;
      }

      reconcileChartSize();
    };

    reconcileRafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || times.length === 0 || series.length === 0) return;

    const structureChanged = structuralKeyRef.current !== null && structuralKeyRef.current !== structuralKey;
    if (structureChanged) destroyChart();
    structuralKeyRef.current = structuralKey;

    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = new ResizeObserver(() => {
      const size = getMeasuredSize();
      if (!size) return;
      scheduleReconcile(2);
    });
    resizeObserverRef.current.observe(el);

    scheduleReconcile(2);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (reconcileRafRef.current != null) cancelAnimationFrame(reconcileRafRef.current);
      reconcileRafRef.current = null;
      destroyChart();
      yLockedRef.current = null;
      gainMultiplierRef.current = 1;
    };
  }, [structuralKey]);

  useEffect(() => {
    const chart = chartRef.current;
    const data = buildChartData();
    if (!chart || !data) return;

    const range = xRangeRef.current ?? (
      chart.scales.x.min != null && chart.scales.x.max != null
        ? [chart.scales.x.min, chart.scales.x.max] as [number, number]
        : null
    );

    // TODO: introduce display decimation or multiscale backend slices if the
    // visible window still carries too many samples for stable rendering.
    withSuppressedWindowPublish(() => {
      chart.setData(data as uPlot.AlignedData, false);
      if (range) chart.setScale("x", { min: range[0], max: range[1] });
    });
    reconcileChartSize();
    chart.redraw();
  }, [slice.payload]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.over.style.cursor = tools.activeTool === "pan" ? "grab" : "crosshair";
  }, [tools.activeTool]);

  // When switching to auto-gain mode, immediately recompute and apply the optimal gain
  useEffect(() => {
    if (tools.yMode !== "yAuto") return;
    if (series.length === 0) return;
    gainMultiplierRef.current = computeAutoGain(series);
    applyGain();
  }, [tools.yMode, series]);

  useEffect(() => {
    const chart = chartRef.current;
    selectionTimeRef.current = selection?.time ?? null;
    if (!chart || times.length === 0 || !selection) {
      chart?.redraw();
      return;
    }
    const x = chart.valToPos(selection.time, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
    chart.redraw();
  }, [selection?.time, times]);

  useEffect(() => {
    chartRef.current?.redraw();
  }, [events]);

  useEffect(() => {
    chartRef.current?.redraw();
  }, [brainstateIntervals, brainstateOverlayEnabled]);

  if (times.length === 0) return null;

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
          xRangeRef.current = null;
          const chart = chartRef.current;
          const data = buildScaledData(times, series, 1);
          if (chart) {
            withSuppressedWindowPublish(() => {
              chart.setData(data as uPlot.AlignedData, false);
            });
            const { min, max } = chart.scales.x;
            if (min != null && max != null) xRangeRef.current = [min, max];
            chart.redraw();
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
        <TimeScaleBar
          timeCursor={selection?.time ?? times[0] ?? 0}
          onTimeWindowChange={onTimeWindowChange}
          onJumpToTime={onSelectTime}
          onImmediateZoom={(window) => {
            const chart = chartRef.current;
            if (!chart) return;
            xRangeRef.current = window;
            chart.setScale("x", { min: window[0], max: window[1] });
          }}
        />
      )}
    </div>
  );
}
