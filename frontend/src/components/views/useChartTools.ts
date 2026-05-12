/**
 * useChartTools — view-local gesture/tool mode state for a uPlot chart.
 *
 * Manages:
 *   - active gesture tool (pan | zoom)
 *   - wheel-zoom toggle
 *   - stable refs that attachGestures reads without stale closures
 *   - initial x-scale capture for reset
 *
 * Tool state is deliberately view-local: it is not shared navigation state
 * and should not enter the shared selection store.
 *
 * Usage:
 *   const chartRef = useRef<uPlot | null>(null);
 *   const tools = useChartTools(chartRef);
 *   // After chart creation:
 *   chartRef.current = chart;
 *   tools.onChartCreated(chart);
 *   // In cleanup:
 *   chartRef.current = null;
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type uPlot from "uplot";
import { useGestureStore, type DragTool, type ScrollTool } from "../../store/gestureStore";

export type GestureTool = "pan" | "zoom";
export type YMode = "auto" | "fixed" | "fit";

// Lossy bridge: the chart toolbar API still uses "pan" | "zoom" (legacy
// vocabulary) but the global store has the full Bokeh-style drag set.
// `box_select` falls through to "zoom" until the timeseries view grows
// a selection-region overlay (follow-up).
function dragToTool(d: DragTool): GestureTool {
  return d === "pan" ? "pan" : "zoom";
}
function toolToDrag(t: GestureTool): DragTool {
  return t === "pan" ? "pan" : "box_zoom";
}
function scrollToWheelZoom(s: ScrollTool): boolean {
  return s === "wheel_zoom";
}

export type ChartToolsResult = {
  activeTool: GestureTool;
  setActiveTool: (t: GestureTool) => void;
  wheelZoom: boolean;
  toggleWheelZoom: () => void;
  yMode: YMode;
  setYMode: (m: YMode) => void;
  /** Stable ref for attachGestures — always current, never triggers recreation. */
  toolRef: React.RefObject<GestureTool>;
  /** Stable ref for attachGestures — always current, never triggers recreation. */
  wheelZoomRef: React.RefObject<boolean>;
  /** Stable ref for Y-axis mode — always current, never triggers recreation. */
  yModeRef: React.RefObject<YMode>;
  /**
   * Call once after each uPlot instance is created.
   * Captures the initial x-scale bounds so reset can restore them.
   */
  onChartCreated: (chart: uPlot) => void;
  /** Restore the x-scale to the bounds captured at chart creation. */
  reset: () => void;
};

export function useChartTools(
  chartRef: React.RefObject<uPlot | null>,
): ChartToolsResult {
  // Gesture tools live in the shared gestureStore so a single toolbar
  // applies across timeseries, spectrogram, PSD-heatmap, etc. Y-mode
  // stays local — it's a per-chart config, not a gesture.
  const drag = useGestureStore((s) => s.drag);
  const scroll = useGestureStore((s) => s.scroll);
  const setDrag = useGestureStore((s) => s.setDrag);
  const setScroll = useGestureStore((s) => s.setScroll);

  const activeTool = dragToTool(drag);
  const wheelZoom = scrollToWheelZoom(scroll);

  const setActiveTool = useCallback(
    (t: GestureTool) => setDrag(toolToDrag(t)),
    [setDrag],
  );
  const toggleWheelZoom = useCallback(
    () => setScroll(scroll === "wheel_zoom" ? "off" : "wheel_zoom"),
    [setScroll, scroll],
  );

  const [yMode, setYMode] = useState<YMode>("auto");

  // Mirror state into refs so gesture handlers always read current values
  // without requiring chart recreation when tool changes.
  const toolRef = useRef<GestureTool>(activeTool);
  const wheelZoomRef = useRef(wheelZoom);
  const yModeRef = useRef<YMode>("auto");
  useEffect(() => { toolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { wheelZoomRef.current = wheelZoom; }, [wheelZoom]);
  useEffect(() => { yModeRef.current = yMode; }, [yMode]);

  // Initial scale bounds — stored once after chart creation, used by reset.
  const initialScalesRef = useRef<{ min: number; max: number } | null>(null);

  const onChartCreated = useCallback((chart: uPlot) => {
    const { min, max } = chart.scales.x;
    initialScalesRef.current = (min != null && max != null) ? { min, max } : null;
  }, []);

  const reset = useCallback(() => {
    const chart = chartRef.current;
    const init = initialScalesRef.current;
    if (!chart || !init) return;
    chart.setScale("x", { min: init.min, max: init.max });
  }, [chartRef]);

  return {
    activeTool,
    setActiveTool,
    wheelZoom,
    toggleWheelZoom,
    yMode,
    setYMode,
    toolRef,
    wheelZoomRef,
    yModeRef,
    onChartCreated,
    reset,
  };
}
