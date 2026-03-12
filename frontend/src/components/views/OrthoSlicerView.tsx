/**
 * OrthoSlicerView — composite view for 4D tensors.
 *
 * Renders two linked orthogonal slices side-by-side:
 * - Primary (65%): time x freq spectrogram heatmap
 * - Orthogonal (35%): AP x ML spatial map at the selected time+freq point
 *
 * Both sub-views share selection state, so crosshairs are automatically linked.
 * Each sub-view uses its own `useSliceQuery` call.
 */
import type { ReactNode } from "react";
import {
  clampWindow,
  makeDefaultSliceRequest,
  makeOrthoSpatialRequest,
  useSliceQuery,
} from "../../api/queries";
import type { CoordSummary, SelectionDTO } from "../../api/types";
import { SpectrogramView } from "./SpectrogramView";
import { SpatialMapSliceView } from "./SpatialMapSliceView";

type OrthoSlicerViewProps = {
  tensorName: string;
  selection: SelectionDTO;
  timeWindow: [number, number];
  timeCoord: CoordSummary | undefined;
  onCommitSelection: (dto: SelectionDTO) => void;
  onSelectFreq: (freq: number) => void;
  onTimeWindowChange: (window: [number, number]) => void;
  onHoverElectrode?: (info: number | null) => void;
};

export function OrthoSlicerView({
  tensorName,
  selection,
  timeWindow,
  timeCoord,
  onCommitSelection,
  onSelectFreq,
  onTimeWindowChange,
  onHoverElectrode,
}: OrthoSlicerViewProps) {
  const safeWindow = clampWindow(timeWindow, timeCoord);

  // Primary: spectrogram (time x freq)
  const spectrogramQuery = useSliceQuery(
    tensorName,
    makeDefaultSliceRequest("spectrogram", selection, safeWindow),
  );

  // Orthogonal: spatial map (AP x ML) at current time+freq
  const spatialQuery = useSliceQuery(
    tensorName,
    makeOrthoSpatialRequest(selection),
  );

  // All hooks above — conditional rendering below.

  const primaryContent: ReactNode = spectrogramQuery.data ? (
    <SpectrogramView
      slice={spectrogramQuery.data}
      selection={selection}
      onSelectTime={(t) => onCommitSelection({ ...selection, time: t })}
      onSelectFreq={onSelectFreq}
      onTimeWindowChange={onTimeWindowChange}
    />
  ) : (
    <div className="placeholder">Loading spectrogram...</div>
  );

  const orthoContent: ReactNode = spatialQuery.data ? (
    <SpatialMapSliceView
      slice={spatialQuery.data}
      selection={selection}
      onSelectCell={(ap, ml) =>
        onCommitSelection({ ...selection, ap, ml, channel: null })
      }
      onHoverElectrode={onHoverElectrode}
    />
  ) : (
    <div className="placeholder">Loading spatial...</div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        gap: "4px",
      }}
    >
      <div style={{ flex: "0 0 65%", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        {primaryContent}
      </div>
      <div style={{ flex: "0 0 35%", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        {orthoContent}
      </div>
    </div>
  );
}
