/**
 * ChartToolbar — gesture mode controls for a uPlot timeseries chart.
 *
 * Purely presentational. All state lives in useChartTools and is passed in
 * as props, so the toolbar never influences the chart lifecycle.
 */
import { useEffect, useRef, useState } from "react";
import type { GestureTool, YMode } from "./useChartTools";

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
};

export function ChartToolbar({
  activeTool,
  onSetTool,
  wheelZoom,
  onToggleWheelZoom,
  onReset,
  yMode,
  onSetYMode,
}: ChartToolbarProps) {
  return (
    <div className="ts-toolbar">
      <button
        type="button"
        className={`ts-tool${activeTool === "zoom" ? " active" : ""}`}
        title="Box Zoom — drag to zoom a region"
        onClick={() => onSetTool("zoom")}
      >&#x229E;</button>
      <button
        type="button"
        className={`ts-tool${activeTool === "pan" ? " active" : ""}`}
        title="Pan — drag to scroll"
        onClick={() => onSetTool("pan")}
      >&#x27FA;</button>
      <button
        type="button"
        className={`ts-tool${wheelZoom ? " active" : ""}`}
        title={`Wheel Zoom ${wheelZoom ? "(ON)" : "(OFF)"} — scroll to zoom at cursor`}
        onClick={onToggleWheelZoom}
      >&#x2299;</button>
      <div className="ts-toolbar-sep" />
      <button
        type="button"
        className={`ts-tool${yMode === "yZoom" ? " active" : ""}`}
        title="Y Zoom — scroll on Y axis to zoom Y range (Shift+scroll for gain)"
        onClick={() => onSetYMode("yZoom")}
      >&#x21D5;</button>
      <button
        type="button"
        className={`ts-tool${yMode === "yGain" ? " active" : ""}`}
        title="Gain — scroll on Y axis to scale waveform amplitude (Shift+scroll always activates gain)"
        onClick={() => onSetYMode("yGain")}
      >&#x00B1;</button>
      <button
        type="button"
        className={`ts-tool${yMode === "yAuto" ? " active" : ""}`}
        title="Auto Gain — automatically scale amplitude to fit visible signal variance"
        onClick={() => onSetYMode("yAuto")}
      >A</button>
      <div className="ts-toolbar-sep" />
      <button
        type="button"
        className="ts-tool"
        title="Reset view"
        onClick={onReset}
      >&#x21BA;</button>
    </div>
  );
}

/** TimeScaleBar — horizontal bar with time scale preset pills and a time input. Sits below the chart. */
type TimeScaleBarProps = {
  timeCursor: number;
  onTimeWindowChange: (window: [number, number]) => void;
  onJumpToTime?: (t: number) => void;
  /** Optional: immediately zoom the chart to the window (optimistic local update). */
  onImmediateZoom?: (window: [number, number]) => void;
};

export function TimeScaleBar({ timeCursor, onTimeWindowChange, onJumpToTime, onImmediateZoom }: TimeScaleBarProps) {
  const [draft, setDraft] = useState("");
  const lastCursor = useRef(timeCursor);

  // Sync display when cursor moves externally
  useEffect(() => {
    if (timeCursor !== lastCursor.current) {
      lastCursor.current = timeCursor;
      setDraft(formatSeconds(timeCursor));
    }
  }, [timeCursor]);

  // Initialize on mount
  useEffect(() => {
    setDraft(formatSeconds(timeCursor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTimeScale = (seconds: number) => {
    if (!Number.isFinite(timeCursor)) return;
    const half = seconds / 2;
    const window: [number, number] = [timeCursor - half, timeCursor + half];
    // Instantly zoom the chart (optimistic) before the server round-trip
    onImmediateZoom?.(window);
    onTimeWindowChange(window);
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
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
        onBlur={handleSubmit}
      />
      <span className="ts-time-unit">s</span>
      <div className="ts-toolbar-sep" />
      {TIME_SCALES.map((ts) => (
        <button
          key={ts.label}
          type="button"
          className="ts-timescale-pill"
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
