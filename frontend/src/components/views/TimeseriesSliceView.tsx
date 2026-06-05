import { useEffect, useMemo, useRef, type ReactNode } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { extractTimeseriesColumnarFast, type ColumnarTimeseries } from "../../api/arrow";
import { buildRegionResolver } from "../../api/probeLayout";
import { useProbeLayoutQuery } from "../../api/queries";
import { useAppStore, type BandPreset } from "../../store/appStore";
import { useViewportStore } from "../../store/viewportStore";
import { useChannelViewportShortcuts } from "./useChannelViewportShortcuts";
import { CrosshairOverlay } from "./CrosshairOverlay";
import type { BrainstateIntervalDTO, EventRecordDTO } from "../../api/types";
import type { SliceViewProps } from "./viewTypes";
import { ChartToolbar } from "./ChartToolbar";
import { useChartTools } from "./useChartTools";
import type { GestureTool, YMode } from "./useChartTools";
import { makeBrainstateDrawHook } from "./brainstateOverlay";
import { TimeseriesNavStrip } from "./TimeseriesNavStrip";
import { COINCIDENCE_COLOR } from "./eventStreamColors";
import { resolveEventSpan } from "./eventFilterLogic";
import { restackBandpassToRawMean } from "./timeseriesBandpass";

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

    if (refs.yModeRef.current === "fixed") {
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
  v2Data,
  v2BandpassData,
  focusChannel,
  onClearFocusChannel,
  bandPreset,
  bandActive,
  selection,
  events = [],
  eventsByStream,
  streamColors,
  coincidentTimes,
  brainstateIntervals = [],
  brainstateOverlayEnabled = false,
  onSelectTime,
  onTimeWindowChange,
  timeWindow,
  dataRange,
}: Omit<SliceViewProps, "slice"> & {
  /** v2-only: present for v1-staying callers, omitted once `v2Data` drives the view. */
  slice?: SliceViewProps["slice"];
  brainstateIntervals?: BrainstateIntervalDTO[];
  brainstateOverlayEnabled?: boolean;
  /** Full data extent in seconds; if omitted the nav strip is hidden. */
  dataRange?: [number, number];
  v2Data?: ColumnarTimeseries | null;
  v2BandpassData?: ColumnarTimeseries | null;
  bandPreset?: BandPreset;
  bandActive?: [number, number] | null;
  /**
   * When the reviewer has drilled into a single (AP, ML) electrode via a
   * spatial-map click, this carries that cell. Renders a small "Focus:
   * AP=… ML=… ✕" banner the user can dismiss with Escape or the button.
   */
  focusChannel?: { ap: number; ml: number } | null;
  onClearFocusChannel?: () => void;
  /**
   * Multi-stream event overlay (G5). When supplied, replaces the single-
   * stream `events` prop for marker drawing; the per-stream color comes
   * from `streamColors`. `coincidentTimes` is the union of event times in
   * any pinned stream that have a match in another pinned stream — the
   * draw hook adds a ringed glyph at those times.
   */
  eventsByStream?: Map<string, EventRecordDTO[]>;
  streamColors?: Map<string, string>;
  coincidentTimes?: number[];
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
  // Fix #2: in "fit" mode the gain is computed ONCE and held across navigation
  // so amplitude doesn't "breathe". This latch tracks whether the current fit
  // has been applied; it is re-armed on mode (re)selection and on a structural
  // (new-channel-set) change.
  const gainFittedRef = useRef(false);
  const rawDataRef = useRef<{ times: Float64Array; seriesArrays: Float32Array[]; offsets: number[] } | null>(null);
  const structuralKeyRef = useRef<string | null>(null);

  const onSelectTimeRef = useRef(onSelectTime);
  const eventsRef = useRef(events);
  const eventsByStreamRef = useRef(eventsByStream);
  const streamColorsRef = useRef(streamColors);
  const coincidentTimesRef = useRef(coincidentTimes);
  const onTimeWindowChangeRef = useRef(onTimeWindowChange);
  // Live window, mirrored into a ref so the async chart-creation path can seed a
  // freshly-built chart with the CURRENT window (the viewport-sync effect bails
  // while chartRef is null, so a chart created after the window settled would
  // otherwise stay at its initial data-extent until the next window change).
  const timeWindowRef = useRef(timeWindow);
  const brainstateIntervalsRef = useRef(brainstateIntervals);
  const brainstateEnabledRef = useRef(brainstateOverlayEnabled);
  useEffect(() => { timeWindowRef.current = timeWindow; });
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { eventsRef.current = events; });
  useEffect(() => { eventsByStreamRef.current = eventsByStream; });
  useEffect(() => { streamColorsRef.current = streamColors; });
  useEffect(() => { coincidentTimesRef.current = coincidentTimes; });
  useEffect(() => { onTimeWindowChangeRef.current = onTimeWindowChange; });
  useEffect(() => { brainstateIntervalsRef.current = brainstateIntervals; });
  useEffect(() => { brainstateEnabledRef.current = brainstateOverlayEnabled; });

  const tools = useChartTools(chartRef);

  // G7: probe-layout sidecar. Drives region-aware channel labels in the
  // drawAxes hook below. Resolved against series keys so a (time,channel)
  // tensor and a (time,AP,ML) tensor both get the same lookup behaviour.
  const { data: probeLayout } = useProbeLayoutQuery();

  // Channel viewport (G2). Default 16 (was 32) — a NeuroScope2-style
  // "tall/few traces" default: at ~32 channels in a typical ~150px canvas
  // each trace got only ~4-5px of vertical space and read as a flat line.
  // 16 channels + the taller signal row (viewGridLayout) give each trace
  // enough px to show structure. Scroll with [ / ] to page through the rest.
  // See `docs/design/channel-viewport.md`.
  const N_VISIBLE = 16;
  const tsFirstChannel = useAppStore((s) => s.tsFirstChannel);
  // We don't yet know totalChannels at this point in the hook order — the
  // shortcut handler uses the slice's series length when it fires.
  // `totalChannels` is computed below in the memo; rather than thread it
  // through ref state, the shortcut just trusts the store + computes
  // the clamp inside `scrollChannels` based on what we know at call time.

  const { times, series, totalChannels, firstChannel, inferredNML } = useMemo(() => {
    // When a band is active we replace the raw signal values with the
    // filtered series values aligned to the raw's per-channel mean offset.
    // The chart structure stays identical so no rebuild is needed when the
    // user toggles the band on/off. NS2-equivalent "filtered view" — full
    // raw + filtered overlay is v0.1 work.
    const raw = v2Data ?? (slice ? extractTimeseriesColumnarFast(slice) : { times: [], series: [] });
    const total = raw.series.length;
    // Infer the grid's ML width from the FULL (uncapped) channel set. The
    // flat-id mapping (ap*nML+ml) used for region lookup must match the
    // backend's, which is keyed on the whole tensor — deriving nML from only
    // the visible 32-channel window mislabels regions whenever the viewport
    // is scrolled past the column that holds the max ML index.
    let inferredNML = 0;
    for (const s of raw.series) {
      const m = /^ap-\d+-ml-(\d+)$/.exec(s.key);
      if (m) inferredNML = Math.max(inferredNML, Number(m[1]) + 1);
    }
    const maxStart = Math.max(0, total - N_VISIBLE);
    const start = Math.min(maxStart, Math.max(0, tsFirstChannel));
    const cap = raw.series.slice(start, start + N_VISIBLE);
    if (bandActive && v2BandpassData) {
      // Filter is keyed to the same time-window query, so the channel
      // ordering matches. Substitute values, keep keys/labels.
      const filteredByKey = new Map(v2BandpassData.series.map((s) => [s.key, s.values]));
      const replaced = cap.map((s) => {
        const fvals = filteredByKey.get(s.key);
        if (!fvals) return s;
        // Re-add raw's mean so the filtered trace lands at the same
        // vertical slot as the unfiltered one. Pure helper extracted for
        // testing (jsdom can't render the canvas this feeds).
        return { ...s, values: restackBandpassToRawMean(s.values, fvals) };
      });
      return {
        times: new Float64Array(raw.times),
        series: replaced,
        totalChannels: total,
        firstChannel: start,
        inferredNML,
      };
    }
    return {
      times: new Float64Array(raw.times),
      series: cap,
      totalChannels: total,
      firstChannel: start,
      inferredNML,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2Data, slice?.payload, v2BandpassData, bandActive?.[0], bandActive?.[1], tsFirstChannel]);

  // Register channel-viewport keyboard shortcuts ( [ / ] ) on the page.
  // Active whenever a timeseries view is mounted (one per workspace).
  useChannelViewportShortcuts({ totalChannels, nVisible: Math.min(N_VISIBLE, series.length) });
  const channelCapActive = totalChannels > series.length;

  // G7: derive a per-visible-series region tag from the loaded probe layout.
  // Series keys are either `ch-N` (flat channel tensors) or `ap-A-ml-M`
  // (grid tensors); we parse both and look up via the appropriate map.
  // Returns an array aligned with the visible `series` slice.
  const regionTags = useMemo(() => {
    if (!probeLayout || probeLayout.electrodes.length === 0) {
      return null;
    }
    // `inferredNML` comes from the full channel set (see data-pipeline memo)
    // so flat ids match the backend regardless of viewport scroll position.
    const resolver = buildRegionResolver(probeLayout, inferredNML);
    if (resolver.isEmpty) return null;
    return series.map((s) => {
      const chMatch = /^ch-(\d+)$/.exec(s.key);
      if (chMatch) {
        return resolver.regionByChannel.get(Number(chMatch[1])) ?? null;
      }
      const gridMatch = /^ap-(\d+)-ml-(\d+)$/.exec(s.key);
      if (gridMatch && inferredNML > 0) {
        const flat = Number(gridMatch[1]) * inferredNML + Number(gridMatch[2]);
        return resolver.regionByFlatId.get(flat) ?? null;
      }
      return null;
    });
  }, [probeLayout, series, inferredNML]);
  const regionTagsRef = useRef<Array<string | null> | null>(regionTags);
  useEffect(() => { regionTagsRef.current = regionTags; });

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
  const computeAutoGain = (seriesData: { values: Float32Array }[]): number => {
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
    seriesData: { values: Float32Array }[],
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
      // values is already a freshly-decoded Float32Array owned by this view
      // (transferred from the worker, never mutated elsewhere), so hold it
      // directly instead of re-copying.
      times: timesArr,
      seriesArrays: seriesData.map((s) => s.values),
      offsets,
    };

    return result;
  };

  const buildChartData = (): [Float64Array, ...Float32Array[]] | null => {
    if (times.length === 0 || series.length === 0) return null;
    // "auto": re-fit the gain to every payload (per-window adaptive fill).
    // "fit": fit ONCE (the first payload, or after a re-arm), then hold the
    // multiplier across navigation so amplitude stays comparable (fix #2).
    // "fixed": never auto-fit — the user owns the multiplier.
    if (tools.yModeRef.current === "auto") {
      gainMultiplierRef.current = computeAutoGain(series);
    } else if (tools.yModeRef.current === "fit" && !gainFittedRef.current) {
      gainMultiplierRef.current = computeAutoGain(series);
      gainFittedRef.current = true;
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
        if (range) chart.batch(() => chart.setScale("x", { min: range[0], max: range[1] }));
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
      // uPlot only commits a `setScale` from inside a batch() when idle (a bare
      // setScale silently no-ops unless an active drag's redraw loop is running)
      // — so external window changes (event nav) wouldn't move the x-axis. See
      // the live-debug finding in the handoff. batch() forces the commit.
      if (range) chart.batch(() => chart.setScale("x", { min: range[0], max: range[1] }));
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
              drawAxes: [
                (u) => {
                  // Draw auto-grouped channel labels to the left of the Y-axis.
                  // Only shown when >= 8 channels are present; groups are 4 channels each.
                  const offsets = rawDataRef.current?.offsets;
                  if (!offsets || series.length < 8) return;
                  const GROUP_SIZE = 4;
                  const nGroups = Math.ceil(series.length / GROUP_SIZE);
                  const ctx = u.ctx;
                  const dpr = window.devicePixelRatio || 1;
                  ctx.save();
                  ctx.font = `${Math.round(9 * dpr)}px Inter,ui-sans-serif,sans-serif`;
                  ctx.textAlign = "right";
                  ctx.textBaseline = "middle";
                  for (let g = 0; g < nGroups; g++) {
                    const firstIdx = g * GROUP_SIZE;
                    const lastIdx = Math.min(firstIdx + GROUP_SIZE - 1, offsets.length - 1);
                    if (firstIdx >= offsets.length) break;
                    const yTop = u.valToPos(offsets[firstIdx], "y", true);
                    const yBot = u.valToPos(offsets[lastIdx], "y", true);
                    const yMid = (yTop + yBot) / 2;
                    if (yMid < u.bbox.top || yMid > u.bbox.top + u.bbox.height) continue;
                    ctx.fillStyle = "#6b7280";
                    // G7: append the dominant region (first non-null tag in
                    // the group) when a probe-layout sidecar is loaded.
                    let regionTag: string | null = null;
                    const tags = regionTagsRef.current;
                    if (tags) {
                      for (let k = firstIdx; k <= lastIdx; k++) {
                        if (tags[k]) { regionTag = tags[k]; break; }
                      }
                    }
                    const label = regionTag
                      ? `${firstIdx}–${lastIdx} · ${regionTag}`
                      : `${firstIdx}–${lastIdx}`;
                    ctx.fillText(label, u.bbox.left - 6 * dpr, yMid);
                    if (g > 0) {
                      const ySep = (yTop + u.valToPos(offsets[firstIdx - 1], "y", true)) / 2;
                      if (ySep >= u.bbox.top && ySep <= u.bbox.top + u.bbox.height) {
                        ctx.strokeStyle = "rgba(148,163,184,0.15)";
                        ctx.lineWidth = dpr;
                        ctx.beginPath();
                        ctx.moveTo(0, ySep);
                        ctx.lineTo(u.bbox.left - 2 * dpr, ySep);
                        ctx.stroke();
                      }
                    }
                  }
                  ctx.restore();
                },
              ],
              drawClear: [
                makeBrainstateDrawHook(brainstateIntervalsRef, brainstateEnabledRef),
              ],
              draw: [
                (u) => {
                  const ctx = u.ctx;
                  const byStream = eventsByStreamRef.current;
                  const colors = streamColorsRef.current;

                  // Multi-stream path (G5): draw one colored tick per
                  // event per stream. Falls back to the single-stream
                  // `events` prop when no multi-stream data was passed.
                  if (byStream && byStream.size > 0 && colors) {
                    const plotLeft = u.bbox.left;
                    const plotRight = u.bbox.left + u.bbox.width;

                    // Pass 1 (E3): faint [t0,t1] interval shading per event, in
                    // the stream color, UNDER the peak ticks. Skips point events
                    // (no resolvable span). See event-filtering-plan.md E3.
                    ctx.save();
                    ctx.globalAlpha = 0.12;
                    for (const [name, evs] of byStream) {
                      ctx.fillStyle = colors.get(name) ?? "rgba(255,180,50,0.7)";
                      for (const ev of evs) {
                        const span = resolveEventSpan(ev.record as Record<string, unknown>);
                        if (!span) continue;
                        const xa = u.valToPos(span.t0, "x", true);
                        const xb = u.valToPos(span.t1, "x", true);
                        const left = Math.max(plotLeft, Math.min(xa, xb));
                        const right = Math.min(plotRight, Math.max(xa, xb));
                        if (right < plotLeft || left > plotRight) continue;
                        ctx.fillRect(left, u.bbox.top, Math.max(1, right - left), u.bbox.height);
                      }
                    }
                    ctx.restore();

                    // Pass 2: colored peak tick per event.
                    ctx.save();
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 3]);
                    for (const [name, evs] of byStream) {
                      ctx.strokeStyle = colors.get(name) ?? "rgba(255,180,50,0.7)";
                      for (const ev of evs) {
                        const t = Number((ev.record as Record<string, unknown>).t ?? NaN);
                        if (!Number.isFinite(t)) continue;
                        const x = Math.round(u.valToPos(t, "x", true));
                        if (x < plotLeft || x > plotRight) continue;
                        ctx.beginPath();
                        ctx.moveTo(x, u.bbox.top);
                        ctx.lineTo(x, u.bbox.top + u.bbox.height);
                        ctx.stroke();
                      }
                    }
                    ctx.restore();
                  } else {
                    const evs = eventsRef.current;
                    if (evs.length) {
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
                    }
                  }

                  // Coincidence glyph (G5): solid ring at top of plot for
                  // any event time involved in a cross-stream match. Drawn
                  // last so it sits above the per-stream dashed ticks.
                  const coTimes = coincidentTimesRef.current;
                  if (coTimes && coTimes.length > 0) {
                    ctx.save();
                    ctx.strokeStyle = COINCIDENCE_COLOR;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([]);
                    const radius = 5;
                    const cy = u.bbox.top + radius + 2;
                    for (const t of coTimes) {
                      if (!Number.isFinite(t)) continue;
                      const x = Math.round(u.valToPos(t, "x", true));
                      if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
                      ctx.beginPath();
                      ctx.arc(x, cy, radius, 0, Math.PI * 2);
                      ctx.stroke();
                    }
                    ctx.restore();
                  }
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

        // Seed the new chart's x-scale from the live window (preferred) so it
        // matches the navigator/spectrogram on first paint; fall back to the
        // last cached range, then to the data extent.
        const initRange = timeWindowRef.current ?? xRangeRef.current;
        if (initRange) {
          xRangeRef.current = [initRange[0], initRange[1]];
          withSuppressedWindowPublish(() => {
            chart.batch(() => chart.setScale("x", { min: initRange[0], max: initRange[1] }));
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
      // Publish the panel width so the data layer can size the LOD point
      // budget to the viewport (P6). The store dedupes equal widths; the
      // budget itself is bucketed (timeseriesPointBudget) so only a quantum
      // crossing changes the request key.
      useViewportStore.getState().setTimeseriesWidthPx(size.width);
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
      gainFittedRef.current = false;  // #2: re-fit "fit" mode for the new channel set
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
      // uPlot only commits a `setScale` from inside a batch() when idle (a bare
      // setScale silently no-ops unless an active drag's redraw loop is running)
      // — so external window changes (event nav) wouldn't move the x-axis. See
      // the live-debug finding in the handoff. batch() forces the commit.
      if (range) chart.batch(() => chart.setScale("x", { min: range[0], max: range[1] }));
    });
    reconcileChartSize();
    chart.redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2Data, slice?.payload]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.over.style.cursor = tools.activeTool === "pan" ? "grab" : "crosshair";
  }, [tools.activeTool]);

  // When the user (re)selects a Y-mode, re-arm the one-shot fit latch and apply
  // the gain immediately for the current view. Deps are [tools.yMode] ONLY —
  // NOT `series` — so navigation does not re-fit; "fit" holds and only "auto"
  // re-adapts (handled per-payload in buildChartData). This is the fix-#2
  // amplitude-stability change; the prior effect re-fit on every `series` change.
  useEffect(() => {
    gainFittedRef.current = false;
    if (tools.yMode !== "auto" && tools.yMode !== "fit") return;
    if (series.length === 0) return;
    gainMultiplierRef.current = computeAutoGain(series);
    gainFittedRef.current = true;
    applyGain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools.yMode]);

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
  }, [events, eventsByStream, coincidentTimes]);

  useEffect(() => {
    chartRef.current?.redraw();
  }, [brainstateIntervals, brainstateOverlayEnabled]);

  // External viewport sync — when the store's `timeWindow` is updated by an
  // outside actor (SSE / agent set_selection / navigator brush), sync the
  // chart's x-scale. Without this, the chart's internal `xRangeRef` cache
  // shadows the store and the view stays pinned despite the new slice.
  // Wrapped in `withSuppressedWindowPublish` so the resulting setScale hook
  // doesn't loop back through `onTimeWindowChange`.
  // See docs/log/issue/issue-arash-20260508-142724-956601.md.
  useEffect(() => {
    if (!timeWindow) return;
    const chart = chartRef.current;
    if (!chart) return;
    const cur = xRangeRef.current;
    if (cur && cur[0] === timeWindow[0] && cur[1] === timeWindow[1]) return;
    xRangeRef.current = [timeWindow[0], timeWindow[1]];
    withSuppressedWindowPublish(() => {
      chart.batch(() => chart.setScale("x", { min: timeWindow[0], max: timeWindow[1] }));
    });
    chart.redraw();
  }, [timeWindow?.[0], timeWindow?.[1]]);

  if (times.length === 0) return null;

  // Audit F3 / F4 / F21: surface the on-server display transform, the silent
  // channel cap, and any processing-pipeline failure so the user knows the
  // on-screen data isn't what they think it is.
  const displayTransforms = v2Data?.meta?.display_transforms ?? slice?.meta?.display_transforms ?? [];
  const procStatus = v2Data?.meta?.processing ?? slice?.meta?.processing;
  const fidelityNotices: string[] = [];
  if (channelCapActive) {
    fidelityNotices.push(`showing ${series.length} of ${totalChannels} channels (row-major order)`);
  }
  if (displayTransforms.length > 0) {
    fidelityNotices.push(`server display: ${displayTransforms.join(", ")} — Y axis is not in native units`);
  }
  if (procStatus?.requested && !procStatus.applied) {
    fidelityNotices.push(`processing failed — rendering raw data: ${procStatus.error ?? "unknown error"}`);
  }

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
      <BandPickerInline bandPreset={bandPreset ?? "off"} bandActive={bandActive ?? null}>
        {focusChannel && (
          <span className="ts-focus-banner" data-testid="ts-focus-banner">
            <span className="ts-focus-label">Focus:</span>
            <span className="ts-focus-coord">AP={focusChannel.ap} ML={focusChannel.ml}</span>
            <button
              type="button"
              className="ts-focus-clear"
              title="Exit focus mode (Esc)"
              onClick={() => onClearFocusChannel?.()}
            >×</button>
          </span>
        )}
        <ChannelViewportInline
          firstChannel={firstChannel}
          nVisible={Math.min(N_VISIBLE, series.length)}
          totalChannels={totalChannels}
        />
      </BandPickerInline>
      {fidelityNotices.length > 0 && (
        <div className="ts-fidelity-notice" role="status">
          {fidelityNotices.map((n, i) => (
            <span key={i} className="ts-fidelity-chip" title={n}>{n}</span>
          ))}
        </div>
      )}
      <div
        className="uplot-crosshair-host"
        style={{ position: "relative", flex: 1, minHeight: 0 }}
      >
        <div
        ref={containerRef}
        className="uplot-wrap"
        style={{ width: "100%", height: "100%" }}
        title={`${series.length} ch \u00B7 ${times.length} samples`}
      />
        {timeWindow && (
          <CrosshairOverlay tLo={timeWindow[0]} tHi={timeWindow[1]} />
        )}
        {eventsByStream && eventsByStream.size > 0 && streamColors && (
          <div
            className="ts-event-legend"
            aria-label="Event stream legend"
            style={{
              position: "absolute",
              top: 4,
              right: 6,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "3px 6px",
              borderRadius: 4,
              background: "rgba(13,17,23,0.66)",
              pointerEvents: "none",
              fontSize: 10,
              maxWidth: 180,
            }}
          >
            {Array.from(eventsByStream.keys()).map((name) => (
              <span
                key={name}
                style={{ display: "flex", alignItems: "center", gap: 5, color: "#c9d1d9" }}
                title={name}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 2,
                    background: streamColors.get(name) ?? "#ffb432",
                    flex: "0 0 auto",
                  }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
      {dataRange && timeWindow && selection && (
        <TimeseriesNavStrip
          dataRange={dataRange}
          window={timeWindow}
          cursor={selection.time}
          onCursorChange={(t) => onSelectTime?.(t)}
          onWindowChange={(w) => onTimeWindowChange?.(w)}
        />
      )}
    </div>
  );
}

/**
 * Inline band-filter picker for the timeseries view. Reads/writes to
 * `useAppStore.{bandPreset, bandCustom}`; the parent (WorkspaceMain)
 * watches those fields and fires the bandpass query, then feeds the
 * filtered data back as `v2BandpassData`. See
 * `docs/design/filtered-band-overlay.md`.
 */
function BandPickerInline({
  bandPreset,
  bandActive,
  children,
}: {
  bandPreset: BandPreset;
  bandActive: [number, number] | null;
  children?: ReactNode;
}) {
  const setBandPreset = useAppStore((s) => s.setBandPreset);
  const setBandCustom = useAppStore((s) => s.setBandCustom);
  const bandCustom = useAppStore((s) => s.bandCustom);
  return (
    <div className="ts-band-picker" role="group" aria-label="Bandpass filter">
      <span className="ts-band-label">Band:</span>
      <select
        className="ts-band-select"
        value={bandPreset}
        onChange={(e) => setBandPreset(e.target.value as BandPreset)}
      >
        <option value="off">Off</option>
        <option value="spindle">Spindle (11–16 Hz)</option>
        <option value="ripple">Ripple (100–250 Hz)</option>
        <option value="slow">Slow Osc (0.5–4 Hz)</option>
        <option value="custom">Custom…</option>
      </select>
      {bandPreset === "custom" && (
        <>
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={bandCustom[0]}
            onChange={(e) => setBandCustom(parseFloat(e.target.value) || 0.5, bandCustom[1])}
            className="ts-band-num"
            aria-label="Low cutoff (Hz)"
          />
          <span className="ts-band-dash">–</span>
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={bandCustom[1]}
            onChange={(e) => setBandCustom(bandCustom[0], parseFloat(e.target.value) || 1)}
            className="ts-band-num"
            aria-label="High cutoff (Hz)"
          />
          <span className="ts-band-unit">Hz</span>
        </>
      )}
      {bandActive && bandPreset !== "custom" && (
        <span className="ts-band-current muted">
          ({bandActive[0]}–{bandActive[1]} Hz)
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * Channel viewport scroll controls. Renders inline in the band picker
 * strip; G2 of the review-workflow spec. See
 * `docs/design/channel-viewport.md`.
 */
function ChannelViewportInline({
  firstChannel,
  nVisible,
  totalChannels,
}: {
  firstChannel: number;
  nVisible: number;
  totalChannels: number;
}) {
  const scrollChannels = useAppStore((s) => s.scrollChannels);
  if (totalChannels <= nVisible) return null;
  const step = Math.max(1, Math.floor(nVisible / 4));
  const last = Math.min(totalChannels - 1, firstChannel + nVisible - 1);
  return (
    <span className="ts-ch-viewport" role="group" aria-label="Channel viewport">
      <span className="ts-ch-label">Ch:</span>
      <button
        type="button"
        className="ts-ch-arrow"
        title={`Up ${step} channels  ([; Shift+[ for full page)`}
        onClick={(e) =>
          scrollChannels(e.shiftKey ? -nVisible : -step, totalChannels, nVisible)
        }
      >&#x25B2;</button>
      <button
        type="button"
        className="ts-ch-arrow"
        title={`Down ${step} channels  (]; Shift+] for full page)`}
        onClick={(e) =>
          scrollChannels(e.shiftKey ? nVisible : step, totalChannels, nVisible)
        }
      >&#x25BC;</button>
      <span className="ts-ch-range muted">
        {firstChannel}–{last} of {totalChannels}
      </span>
    </span>
  );
}
