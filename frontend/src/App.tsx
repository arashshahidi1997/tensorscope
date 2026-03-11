import { useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import {
  makeDefaultSliceRequest,
  makeNavigatorRequest,
  useEventWindowQuery,
  useProcessingQuery,
  useSetProcessing,
  useSliceQuery,
  useStateQuery,
  useTensorQuery,
} from "./api/queries";
import type { EventRecordDTO, LayoutDTO, SelectionDTO } from "./api/types";
import { LayoutPanel } from "./components/controls/LayoutPanel";
import { ProcessingPanel } from "./components/controls/ProcessingPanel";
import { SelectionPanel } from "./components/controls/SelectionPanel";
import { EventTableView } from "./components/views/EventTableView";
import { TensorChooser } from "./components/views/TensorChooser";
import { TensorOverview } from "./components/views/TensorOverview";
import { NavigatorView } from "./components/views/NavigatorView";
import { LayoutShell } from "./components/layout/LayoutShell";
import { useAppStore } from "./store/appStore";
import { viewRegistry } from "./registry/viewRegistry";

function App() {
  const queryClient = useQueryClient();
  const stateQuery = useStateQuery();
  const processingQuery = useProcessingQuery();
  const setProcessingMutation = useSetProcessing();
  const {
    selectedTensor,
    activeViews,
    selectionDraft,
    layoutDraft,
    timeWindow,
    setSelectedTensor,
    toggleView,
    setSelectionDraft,
    patchSelectionDraft,
    setLayoutDraft,
    setTimeWindow,
  } = useAppStore();

  // Initialise store from first API response
  useEffect(() => {
    if (!stateQuery.data) return;
    if (!selectedTensor) setSelectedTensor(stateQuery.data.active_tensor);
    if (!selectionDraft) setSelectionDraft(stateQuery.data.selection);
    if (!layoutDraft) setLayoutDraft(stateQuery.data.layout);
  }, [layoutDraft, selectedTensor, selectionDraft, setLayoutDraft, setSelectedTensor, setSelectionDraft, stateQuery.data]);

  const tensorQuery = useTensorQuery(selectedTensor);

  const availableViews = tensorQuery.data?.available_views ?? [];
  // activeViews=[] means "all on"; resolve to the effective set
  const effectiveActiveViews = activeViews.length === 0 ? availableViews : activeViews;
  const hasTimeseries = effectiveActiveViews.includes("timeseries");
  const hasSpatial = effectiveActiveViews.includes("spatial_map");
  const hasPSD = effectiveActiveViews.includes("psd_average");
  const hasSpectrogram = effectiveActiveViews.includes("spectrogram");
  const hasNavigator = availableViews.includes("navigator"); // navigator always shown

  const timeCoord = tensorQuery.data?.coords.find((c) => c.name === "time");

  // Slice requests driven by timeWindow
  const timeseriesReq =
    selectionDraft && hasTimeseries
      ? makeDefaultSliceRequest("timeseries", selectionDraft, timeWindow)
      : null;
  const spatialReq =
    selectionDraft && hasSpatial
      ? makeDefaultSliceRequest("spatial_map", selectionDraft, timeWindow)
      : null;
  const psdReq =
    selectionDraft && hasPSD
      ? makeDefaultSliceRequest("psd_average", selectionDraft, timeWindow)
      : null;
  const spectrogramReq =
    selectionDraft && hasSpectrogram
      ? makeDefaultSliceRequest("spectrogram", selectionDraft, timeWindow)
      : null;
  const navigatorReq =
    selectionDraft && hasNavigator
      ? makeNavigatorRequest(selectionDraft, timeCoord)
      : null;

  const timeseriesSliceQuery = useSliceQuery(selectedTensor, timeseriesReq);
  const spatialSliceQuery = useSliceQuery(selectedTensor, spatialReq);
  const psdSliceQuery = useSliceQuery(selectedTensor, psdReq);
  const spectrogramSliceQuery = useSliceQuery(selectedTensor, spectrogramReq);
  const navigatorSliceQuery = useSliceQuery(selectedTensor, navigatorReq);

  // Event data
  const firstEventStream = stateQuery.data?.events[0] ?? null;
  const eventWindowQuery = useEventWindowQuery(firstEventStream?.name ?? null, selectionDraft, 2);

  // Prev/next event navigation
  const goToEvent = useCallback(
    (direction: "prev" | "next") => {
      if (!firstEventStream?.name || !selectionDraft) return;
      const params = new URLSearchParams({
        t0: direction === "prev" ? "0" : String(selectionDraft.time + 0.001),
        t1: direction === "prev"
          ? String(Math.max(0, selectionDraft.time - 0.001))
          : String((firstEventStream.time_range[1] ?? selectionDraft.time + 100)),
      });
      api.getEventWindow(firstEventStream.name, params).then((evs: EventRecordDTO[]) => {
        const ev = direction === "prev" ? evs[evs.length - 1] : evs[0];
        if (!ev) return;
        const t = Number((ev.record as Record<string, unknown>).t ?? NaN);
        if (Number.isFinite(t)) commitSelection({ ...selectionDraft, time: t });
      });
    },
    [firstEventStream, selectionDraft], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Selection mutation
  const selectionMutation = useMutation({
    mutationFn: (payload: SelectionDTO) => api.updateSelection(payload),
    onSuccess: (selection) => {
      setSelectionDraft(selection);
      queryClient.invalidateQueries({ queryKey: ["state"] });
      queryClient.invalidateQueries({ queryKey: ["slice"] });
    },
  });

  const layoutMutation = useMutation({
    mutationFn: (payload: { preset: string }) => api.updateLayout(payload),
    onSuccess: (layout) => {
      setLayoutDraft(layout as LayoutDTO);
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  const commitSelection = (payload: SelectionDTO) => selectionMutation.mutate(payload);

  if (stateQuery.isLoading || !stateQuery.data || !selectionDraft || !layoutDraft) {
    return <div className="empty-state">Connecting to TensorScope API…</div>;
  }
  if (stateQuery.isError) {
    return <div className="empty-state error">Failed to load API state.</div>;
  }

  const TimeseriesComponent = viewRegistry.timeseries;
  const SpatialMapComponent = viewRegistry.spatial_map;
  const PSDComponent = viewRegistry.psd_average;
  const SpectrogramComponent = viewRegistry.spectrogram;

  return (
    <LayoutShell
      title={stateQuery.data.layout.title}
      sessionId={stateQuery.data.session_id}
      layout={layoutDraft}
      sidebar={
        <>
          <SelectionPanel
            selection={selectionDraft}
            onSelectionChange={patchSelectionDraft}
            onCommit={() => selectionMutation.mutate(selectionDraft)}
          />
          <LayoutPanel
            layout={layoutDraft}
            onPresetChange={(preset) => layoutMutation.mutate({ preset })}
          />
          {processingQuery.data && (
            <ProcessingPanel
              params={processingQuery.data}
              onApply={(p) => setProcessingMutation.mutate(p)}
              isPending={setProcessingMutation.isPending}
            />
          )}
        </>
      }
      details={
        <EventTableView
          streamMeta={firstEventStream}
          events={eventWindowQuery.data ?? []}
          selectedTime={selectionDraft.time}
          onSelectTime={(t) => commitSelection({ ...selectionDraft, time: t })}
          onPrev={() => goToEvent("prev")}
          onNext={() => goToEvent("next")}
        />
      }
    >
      <div className="content-stack">
        {/* Tensor + view selector */}
        <TensorChooser
          tensors={stateQuery.data.tensors}
          selectedTensor={selectedTensor ?? stateQuery.data.active_tensor}
          onSelectTensor={setSelectedTensor}
        />
        {tensorQuery.data ? (
          <TensorOverview
            tensor={tensorQuery.data}
            activeViews={activeViews}
            onToggleView={(v) => toggleView(v, availableViews)}
          />
        ) : null}

        {/* Navigator — always shown when available */}
        {navigatorSliceQuery.data && (
          <NavigatorView
            slice={navigatorSliceQuery.data}
            selection={selectionDraft}
            onSelectTime={(t) => commitSelection({ ...selectionDraft, time: t })}
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
                  onSelectTime={(t) => commitSelection({ ...selectionDraft, time: t })}
                />
              </div>
            ) : null}
            {hasSpatial && spatialSliceQuery.data ? (
              <div className="panel-secondary">
                <SpatialMapComponent
                  slice={spatialSliceQuery.data}
                  selection={selectionDraft}
                  onSelectCell={(ap, ml) =>
                    commitSelection({ ...selectionDraft, ap, ml, channel: null })
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
          />
        ) : null}

        {/* PSD average */}
        {hasPSD && psdSliceQuery.data ? (
          <PSDComponent
            slice={psdSliceQuery.data}
            selection={selectionDraft}
          />
        ) : null}

      </div>
    </LayoutShell>
  );
}

export default App;
