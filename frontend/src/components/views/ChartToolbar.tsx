/**
 * ChartToolbar — gesture mode controls for a uPlot timeseries chart.
 *
 * Purely presentational. All state lives in useChartTools and is passed in
 * as props, so the toolbar never influences the chart lifecycle.
 */
import type { GestureTool, YMode } from "./useChartTools";

export const TIME_SCALES = [
  { label: "10ms", seconds: 0.01 },
  { label: "50ms", seconds: 0.05 },
  { label: "100ms", seconds: 0.1 },
  { label: "500ms", seconds: 0.5 },
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
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
        title="Y Zoom — scroll on Y axis to zoom Y range"
        onClick={() => onSetYMode("yZoom")}
      >&#x21D5;</button>
      <button
        type="button"
        className={`ts-tool${yMode === "yGain" ? " active" : ""}`}
        title="Gain — scroll on Y axis to scale waveform amplitude"
        onClick={() => onSetYMode("yGain")}
      >&#x00B1;</button>
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

/** TimeScaleBar — horizontal bar with time scale preset pills. Sits below the chart. */
type TimeScaleBarProps = {
  timeCursor: number;
  onTimeWindowChange: (window: [number, number]) => void;
};

export function TimeScaleBar({ timeCursor, onTimeWindowChange }: TimeScaleBarProps) {
  const handleTimeScale = (seconds: number) => {
    if (!Number.isFinite(timeCursor)) return;
    const half = seconds / 2;
    onTimeWindowChange([timeCursor - half, timeCursor + half]);
  };

  return (
    <div className="ts-timescale-bar">
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
