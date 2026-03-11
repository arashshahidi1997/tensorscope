/**
 * ChartToolbar — gesture mode controls for a uPlot timeseries chart.
 *
 * Purely presentational. All state lives in useChartTools and is passed in
 * as props, so the toolbar never influences the chart lifecycle.
 */
import type { GestureTool } from "./useChartTools";

type ChartToolbarProps = {
  activeTool: GestureTool;
  onSetTool: (t: GestureTool) => void;
  wheelZoom: boolean;
  onToggleWheelZoom: () => void;
  onReset: () => void;
};

export function ChartToolbar({
  activeTool,
  onSetTool,
  wheelZoom,
  onToggleWheelZoom,
  onReset,
}: ChartToolbarProps) {
  return (
    <div className="ts-toolbar">
      <button
        type="button"
        className={`ts-tool${activeTool === "zoom" ? " active" : ""}`}
        title="Box Zoom — drag to zoom a region"
        onClick={() => onSetTool("zoom")}
      >⊡</button>
      <button
        type="button"
        className={`ts-tool${activeTool === "pan" ? " active" : ""}`}
        title="Pan — drag to scroll"
        onClick={() => onSetTool("pan")}
      >⟺</button>
      <button
        type="button"
        className={`ts-tool${wheelZoom ? " active" : ""}`}
        title={`Wheel Zoom ${wheelZoom ? "(ON)" : "(OFF)"} — scroll to zoom at cursor`}
        onClick={onToggleWheelZoom}
      >⊙</button>
      <button
        type="button"
        className="ts-tool"
        title="Reset view"
        onClick={onReset}
      >↺</button>
    </div>
  );
}
