/**
 * ChartToolbar — gesture mode controls for a uPlot timeseries chart.
 *
 * Purely presentational. All state lives in useChartTools (which proxies
 * the global gestureStore) and is passed in as props, so the toolbar
 * never influences the chart lifecycle.
 *
 * The drag / scroll / inspect controls follow Bokeh's category model:
 * one active drag tool, one active scroll tool, zero-or-more inspectors.
 * https://docs.bokeh.org/en/latest/docs/user_guide/interaction/tools.html
 */
import { useEffect, useRef, useState } from "react";
import type { GestureTool, YMode } from "./useChartTools";
import { hasInspector, useGestureStore } from "../../store/gestureStore";

export const TIME_SCALES = [
  { label: "10ms", seconds: 0.01 },
  { label: "50ms", seconds: 0.05 },
  { label: "100ms", seconds: 0.1 },
  { label: "500ms", seconds: 0.5 },
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
];

type ChartToolbarProps = {
  activeTool: GestureTool;
  onSetTool: (t: GestureTool) => void;
  wheelZoom: boolean;
  onToggleWheelZoom: () => void;
  onReset: () => void;
  yMode: YMode;
  onSetYMode: (m: YMode) => void;
  /** Raster display mode (channel×time heatmap) vs stacked traces. */
  rasterMode?: boolean;
  onToggleRaster?: () => void;
};

export function ChartToolbar({
  activeTool,
  onSetTool,
  wheelZoom,
  onToggleWheelZoom,
  onReset,
  yMode,
  onSetYMode,
  rasterMode,
  onToggleRaster,
}: ChartToolbarProps) {
  const inspectors = useGestureStore((s) => s.inspectors);
  const toggleInspector = useGestureStore((s) => s.toggleInspector);
  const crosshairOn = hasInspector(inspectors, "crosshair");
  return (
    <div className="ts-toolbar">
      {/* Drag tools — one active. */}
      <button
        type="button"
        className={`ts-tool${activeTool === "zoom" ? " active" : ""}`}
        title="Box zoom (b) — drag to zoom a region"
        onClick={() => onSetTool("zoom")}
      >&#x229E;</button>
      <button
        type="button"
        className={`ts-tool${activeTool === "pan" ? " active" : ""}`}
        title="Pan (p) — drag to scroll"
        onClick={() => onSetTool("pan")}
      >&#x27FA;</button>
      <div className="ts-toolbar-sep" />
      {/* Scroll tool — wheel zoom on/off. */}
      <button
        type="button"
        className={`ts-tool${wheelZoom ? " active" : ""}`}
        title={`Wheel zoom (w) ${wheelZoom ? "ON" : "OFF"} — scroll to zoom at cursor`}
        onClick={onToggleWheelZoom}
      >&#x2299;</button>
      <div className="ts-toolbar-sep" />
      {/* Inspectors — multiple may stack. */}
      <button
        type="button"
        className={`ts-tool${crosshairOn ? " active" : ""}`}
        title={`Crosshair (c) ${crosshairOn ? "ON" : "OFF"} — show a synchronised cursor across linked views`}
        onClick={() => toggleInspector("crosshair")}
      >&#xFF0B;</button>
      <div className="ts-toolbar-sep" />
      {/* Y-axis modes — chart-local, not a gesture. */}
      <button
        type="button"
        className={`ts-tool${yMode === "auto" ? " active" : ""}`}
        title="Auto — rescale amplitude on every data refresh"
        onClick={() => onSetYMode("auto")}
      >A</button>
      <button
        type="button"
        className={`ts-tool${yMode === "fixed" ? " active" : ""}`}
        title="Fixed — lock Y range; scroll on Y axis or Shift+scroll to adjust"
        onClick={() => onSetYMode("fixed")}
      >&#x00B1;</button>
      <button
        type="button"
        className={`ts-tool${yMode === "fit" ? " active" : ""}`}
        title="Fit — scale once to fit all channels, then hold"
        onClick={() => onSetYMode("fit")}
      >&#x21D5;</button>
      {onToggleRaster && (
        <>
          <div className="ts-toolbar-sep" />
          {/* Display mode — stacked traces vs channel×time raster heatmap. */}
          <button
            type="button"
            className={`ts-tool${rasterMode ? " active" : ""}`}
            title={`Raster ${rasterMode ? "ON" : "OFF"} — show all channels as a channel×time heatmap (shares this time axis)`}
            aria-pressed={rasterMode}
            onClick={onToggleRaster}
          >&#x25A6;</button>
        </>
      )}
      <div className="ts-toolbar-sep" />
      {/* Reset action. */}
      <button
        type="button"
        className="ts-tool"
        title="Reset view (r)"
        onClick={onReset}
      >&#x21BA;</button>
    </div>
  );
}

/** TimeScaleBar — horizontal bar with time scale preset pills and a time input. Sits below the chart. */
type TimeScaleBarProps = {
  timeCursor: number;
  /** Called when user picks a preset; receives the new duration in seconds. */
  onViewportDurationChange?: (d: number) => void;
  /** Fallback: called with a computed [start, end] window (used by views without viewportDuration in store). */
  onTimeWindowChange?: (window: [number, number]) => void;
  onJumpToTime?: (t: number) => void;
  /** Optional: immediately zoom the chart to the window (optimistic local update). */
  onImmediateZoom?: (window: [number, number]) => void;
  /** Current viewport duration in seconds — highlights the matching preset pill. */
  viewportDuration?: number;
};

export function TimeScaleBar({ timeCursor, onViewportDurationChange, onTimeWindowChange, onJumpToTime, onImmediateZoom, viewportDuration }: TimeScaleBarProps) {
  const [draft, setDraft] = useState(() => formatSeconds(timeCursor));
  const focusedRef = useRef(false);

  // Focus-aware sync: refresh the field from the external cursor only while the
  // user is NOT typing in it, so an animation tick or paired-agent commit can't
  // wipe an in-progress edit. See docs/design/time-transport.md (Phase B).
  useEffect(() => {
    if (!focusedRef.current) setDraft(formatSeconds(timeCursor));
  }, [timeCursor]);

  const handleTimeScale = (seconds: number) => {
    if (!Number.isFinite(timeCursor)) return;
    const half = seconds / 2;
    const window: [number, number] = [timeCursor - half, timeCursor + half];
    // Instantly zoom the chart (optimistic) before the server round-trip
    onImmediateZoom?.(window);
    if (onViewportDurationChange) {
      onViewportDurationChange(seconds);
    } else {
      onTimeWindowChange?.(window);
    }
  };

  const handleSubmit = () => {
    const t = parseFloat(draft);
    if (!Number.isFinite(t)) return;
    onJumpToTime?.(t);
  };

  return (
    <div className="ts-timescale-bar">
      <input
        type="text"
        inputMode="decimal"
        className="ts-time-input"
        value={draft}
        title="Jump to time (seconds)"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => { focusedRef.current = true; }}
        // Commit once, on blur. Enter blurs → single onJumpToTime (no double-fire).
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={() => { focusedRef.current = false; handleSubmit(); }}
      />
      <span className="ts-time-unit">s</span>
      <div className="ts-toolbar-sep" />
      {TIME_SCALES.map((ts) => (
        <button
          key={ts.label}
          type="button"
          className={`ts-timescale-pill${viewportDuration != null && Math.abs(viewportDuration - ts.seconds) < 1e-6 ? " active" : ""}`}
          title={`Set window to ${ts.label}`}
          onClick={() => handleTimeScale(ts.seconds)}
        >
          {ts.label}
        </button>
      ))}
    </div>
  );
}

function formatSeconds(s: number): string {
  return Number.isFinite(s) ? s.toFixed(3) : "0.000";
}
