/**
 * WorkspaceMain — central linked workspace.
 *
 * Owns the full set of linked scientific views and their data fetching.
 * New view types slot in here; no shell rewrite needed.
 *
 * Reads shared navigation state from the stores.
 * Receives `onCommitSelection` for interactions that require a server round-trip
 * (e.g. clicking a time point or a spatial cell commits the new selection to the
 * server and invalidates dependent queries).
 */
import { useCallback, useEffect } from "react";
import {
  clampWindow,
  makeDefaultSliceRequest,
  makeNavigatorRequest,
  useEventWindowQuery,
  useSliceQuery,
  useStateQuery,
  useTensorQuery,
} from "../../api/queries";
import type { SelectionDTO } from "../../api/types";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore, toSelectionDTO } from "../../store/selectionStore";
import { viewRegistry } from "../../registry/viewRegistry";
import { NavigatorView } from "./NavigatorView";
import { TensorChooser } from "./TensorChooser";
import { TensorOverview } from "./TensorOverview";

type WorkspaceMainProps = {
  onCommitSelection: (dto: SelectionDTO) => void;
};

export function WorkspaceMain({ onCommitSelection }: WorkspaceMainProps) {
  const { selectedTensor, activeViews, setSelectedTensor, toggleView } = useAppStore();
  const selectionState = useSelectionStore();
  const { timeWindow, setTimeWindow, setFreq } = selectionState;

  // Store-local freq update — no server round-trip; spectrogram and PSD already
  // render the full freq range and project the cursor client-side.
  const handleSelectFreq = useCallback((freq: number) => setFreq({ freq }), [setFreq]);
  const selectionDraft = toSelectionDTO(selectionState);

  const stateQuery = useStateQuery();

  // Auto-select the server's active tensor on first load so queries fire immediately
  // without requiring a manual selection interaction.
  useEffect(() => {
    const active = stateQuery.data?.active_tensor;
    if (!selectedTensor && active) setSelectedTensor(active);
  }, [selectedTensor, stateQuery.data?.active_tensor, setSelectedTensor]);

  const tensorQuery = useTensorQuery(selectedTensor);

  const availableViews = tensorQuery.data?.available_views ?? [];
  const effectiveActiveViews = activeViews.length === 0 ? availableViews : activeViews;
  const hasTimeseries = effectiveActiveViews.includes("timeseries");
  const hasSpatial = effectiveActiveViews.includes("spatial_map");
  const hasPSD = effectiveActiveViews.includes("psd_average");
  const hasSpectrogram = effectiveActiveViews.includes("spectrogram");
  const hasNavigator = availableViews.includes("navigator");

  const timeCoord = tensorQuery.data?.coords.find((c) => c.name === "time");

  // Clamp the time window to data bounds so panning outside the recording
  // never triggers a "slice returned no data" 400 from the server.
  const safeWindow = clampWindow(timeWindow, timeCoord);

  const timeseriesSliceQuery = useSliceQuery(
    selectedTensor,
    hasTimeseries ? makeDefaultSliceRequest("timeseries", selectionDraft, safeWindow) : null,
  );
  const spatialSliceQuery = useSliceQuery(
    selectedTensor,
    hasSpatial ? makeDefaultSliceRequest("spatial_map", selectionDraft, safeWindow) : null,
  );
  const psdSliceQuery = useSliceQuery(
    selectedTensor,
    hasPSD ? makeDefaultSliceRequest("psd_average", selectionDraft, safeWindow) : null,
  );
  const spectrogramSliceQuery = useSliceQuery(
    selectedTensor,
    hasSpectrogram ? makeDefaultSliceRequest("spectrogram", selectionDraft, safeWindow) : null,
  );
  const navigatorSliceQuery = useSliceQuery(
    selectedTensor,
    hasNavigator ? makeNavigatorRequest(selectionDraft, timeCoord) : null,
  );

  // Event window for timeseries markers — same query key as the inspector's call,
  // so React Query deduplicates the request.
  const firstEventStream = stateQuery.data?.events[0] ?? null;
  const eventWindowQuery = useEventWindowQuery(firstEventStream?.name ?? null, selectionDraft, 2);

  const TimeseriesComponent = viewRegistry.timeseries;
  const SpatialMapComponent = viewRegistry.spatial_map;
  const PSDComponent = viewRegistry.psd_average;
  const SpectrogramComponent = viewRegistry.spectrogram;

  return (
    <div className="content-stack">
      {/* Tensor + view selector */}
      <TensorChooser
        tensors={stateQuery.data?.tensors ?? []}
        selectedTensor={selectedTensor ?? stateQuery.data?.active_tensor ?? ""}
        onSelectTensor={setSelectedTensor}
      />
      {tensorQuery.data ? (
        <TensorOverview
          tensor={tensorQuery.data}
          activeViews={activeViews}
          onToggleView={(v) => toggleView(v, availableViews)}
        />
      ) : null}

      {/* Navigator — always shown when the tensor has a navigator view */}
      {navigatorSliceQuery.data && (
        <NavigatorView
          slice={navigatorSliceQuery.data}
          selection={selectionDraft}
          onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
        />
      )}

      {/* Main canonical panels: timeseries + spatial map side by side */}
      {(hasTimeseries || hasSpatial) && (
        <div className="main-panels">
          {hasTimeseries && timeseriesSliceQuery.data ? (
            <div className="panel-primary">
              <TimeseriesComponent
                slice={timeseriesSliceQuery.data}
                selection={selectionDraft}
                events={eventWindowQuery.data ?? []}
                onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
                onTimeWindowChange={setTimeWindow}
              />
            </div>
          ) : null}
          {hasSpatial && spatialSliceQuery.data ? (
            <div className="panel-secondary">
              <SpatialMapComponent
                slice={spatialSliceQuery.data}
                selection={selectionDraft}
                onSelectCell={(ap, ml) =>
                  onCommitSelection({ ...selectionDraft, ap, ml, channel: null })
                }
              />
            </div>
          ) : null}
        </div>
      )}

      {/* Spectrogram */}
      {hasSpectrogram && spectrogramSliceQuery.data ? (
        <SpectrogramComponent
          slice={spectrogramSliceQuery.data}
          selection={selectionDraft}
          onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          onSelectFreq={handleSelectFreq}
        />
      ) : null}

      {/* PSD average */}
      {hasPSD && psdSliceQuery.data ? (
        <PSDComponent
          slice={psdSliceQuery.data}
          selection={selectionDraft}
          onSelectFreq={handleSelectFreq}
        />
      ) : null}
    </div>
  );
}
