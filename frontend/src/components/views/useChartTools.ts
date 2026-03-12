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

export type GestureTool = "pan" | "zoom";
export type YMode = "yZoom" | "yGain";

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
  const [activeTool, setActiveTool] = useState<GestureTool>("zoom");
  const [wheelZoom, setWheelZoom] = useState(true);
  const [yMode, setYMode] = useState<YMode>("yZoom");

  // Mirror state into refs so gesture handlers always read current values
  // without requiring chart recreation when tool changes.
  const toolRef = useRef<GestureTool>("zoom");
  const wheelZoomRef = useRef(true);
  const yModeRef = useRef<YMode>("yZoom");
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

  const toggleWheelZoom = useCallback(() => setWheelZoom((v) => !v), []);

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
