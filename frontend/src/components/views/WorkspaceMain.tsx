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
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  clampWindow,
  makeDefaultSliceRequest,
  makeNavigatorRequest,
  useEventWindowQuery,
  useSliceQuery,
  useStateQuery,
  useTensorQuery,
} from "../../api/queries";
import type { SelectionDTO, TensorSliceDTO } from "../../api/types";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore, toSelectionDTO } from "../../store/selectionStore";
import { getAvailableViews, viewRegistry } from "../../registry/viewRegistry";
import { NavigatorView } from "./NavigatorView";
import { PropagationView } from "./PropagationView";
import { SpatialMapSliceView } from "./SpatialMapSliceView";
import { AnimationController } from "../controls/AnimationController";
import { SpatialEventView } from "./SpatialEventView";
import { TensorChooser } from "./TensorChooser";
import { TensorOverview } from "./TensorOverview";
import { ViewGrid } from "./ViewGrid";

type WorkspaceMainProps = {
  onCommitSelection: (dto: SelectionDTO) => void;
  /** Render prop: receives the navigator element to be placed in the bottom panel. */
  renderNavigator?: (node: ReactNode) => void;
};

export function WorkspaceMain({ onCommitSelection, renderNavigator }: WorkspaceMainProps) {
  const { selectedTensor, activeViews, setSelectedTensor, toggleView } = useAppStore();
  const selectionState = useSelectionStore();
  const { timeWindow, setTimeWindow, setFreq, setHoveredElectrode } = selectionState;

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

  // Derive available views from stateQuery immediately (no waterfall) and
  // fall back to the richer tensorQuery once it resolves.
  // Use stateQuery.data.active_tensor as fallback because selectedTensor is set
  // by a useEffect that runs after the first render.
  const activeTensorName = selectedTensor ?? stateQuery.data?.active_tensor ?? null;
  const activeTensorSummary = stateQuery.data?.tensors.find((t) => t.name === activeTensorName);
  const earlyAvailableViews = activeTensorSummary
    ? getAvailableViews(activeTensorSummary).map((d) => d.id)
    : [];
  const availableViews = tensorQuery.data?.available_views ?? earlyAvailableViews;
  const effectiveActiveViews = activeViews.length === 0 ? availableViews : activeViews;
  const hasTimeseries = effectiveActiveViews.includes("timeseries");
  const hasSpatial = effectiveActiveViews.includes("spatial_map");
  const hasPropagation = effectiveActiveViews.includes("propagation_frame");
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
  // Subscribe to timeCursor directly so propagation re-fetches on every
  // AnimationController tick (timeCursor drives frame_time).
  const timeCursor = useSelectionStore((s) => s.timeCursor);

  // Propagation frame — sequential fetch with a queue of 1.
  //
  // AbortController breaks here: at 10 fps each cursor tick arrives every ~100 ms,
  // so effect cleanup (abort) fires before the server can respond. The fix: allow
  // only one request in-flight. When the cursor moves during a pending request,
  // store the latest cursor in a ref and fetch it immediately upon completion.
  // This naturally plays at the server's throughput rate, never faster.
  const [propagationFrame, setPropagationFrame] = useState<TensorSliceDTO | null>(null);

  // Always-current refs so async callbacks never capture stale closures.
  const propagationSelRef = useRef(selectionDraft);
  propagationSelRef.current = selectionDraft;
  const propInFlightRef = useRef(false);
  const propPendingRef = useRef<{ tensor: string; time: number } | null>(null);

  // Stored in a ref so the async .then() can call it recursively via the ref
  // without capturing stale deps or needing useCallback dependencies.
  const fetchPropFrame = useRef<(tensor: string, time: number) => void>(null!);
  fetchPropFrame.current = (tensor, time) => {
    propInFlightRef.current = true;
    fetch(`/api/v1/tensors/${tensor}/slice`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view_type: "propagation_frame",
        selection: propagationSelRef.current,
        frame_time: time,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<TensorSliceDTO>) : Promise.reject()))
      .then((data) => {
        setPropagationFrame(data);
        propInFlightRef.current = false;
        // If the animation advanced while this request was in-flight, fetch
        // the queued cursor immediately so the player catches up.
        const pending = propPendingRef.current;
        if (pending) {
          propPendingRef.current = null;
          fetchPropFrame.current(pending.tensor, pending.time);
        }
      })
      .catch(() => { propInFlightRef.current = false; });
  };

  useEffect(() => {
    if (!hasPropagation || !selectedTensor) {
      propInFlightRef.current = false;
      propPendingRef.current = null;
      setPropagationFrame(null);
      return;
    }
    if (propInFlightRef.current) {
      // A request is in-flight — queue this cursor; .then() will pick it up.
      propPendingRef.current = { tensor: selectedTensor, time: timeCursor };
    } else {
      fetchPropFrame.current(selectedTensor, timeCursor);
    }
  }, [hasPropagation, selectedTensor, timeCursor]);
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

  // Keep the last successfully-received slice for each view so that a transient
  // query error (e.g. zooming between two samples → 400 "no data") does not blank
  // the panel.  The ref is updated on every successful data arrival.
  const lastTimeseries = useRef(timeseriesSliceQuery.data ?? null);
  const lastNavigator = useRef(navigatorSliceQuery.data ?? null);
  if (timeseriesSliceQuery.data) lastTimeseries.current = timeseriesSliceQuery.data;
  if (navigatorSliceQuery.data) lastNavigator.current = navigatorSliceQuery.data;
  const timeseriesData = timeseriesSliceQuery.data ?? lastTimeseries.current;
  const navigatorData = navigatorSliceQuery.data ?? lastNavigator.current;

  // Event window for timeseries markers — same query key as the inspector's call,
  // so React Query deduplicates the request.
  const firstEventStream = stateQuery.data?.events[0] ?? null;
  const eventWindowQuery = useEventWindowQuery(firstEventStream?.name ?? null, selectionDraft, 2);

  const TimeseriesComponent = viewRegistry.timeseries;
  const SpatialMapComponent = viewRegistry.spatial_map as typeof SpatialMapSliceView;
  const PSDComponent = viewRegistry.psd_average;
  const SpectrogramComponent = viewRegistry.spectrogram;

  // ── Lift navigator to bottom panel via render prop ──────────────────────
  const navigatorRef = useRef(renderNavigator);
  navigatorRef.current = renderNavigator;

  useEffect(() => {
    if (!navigatorRef.current) return;
    if (navigatorData) {
      navigatorRef.current(
        <NavigatorView
          slice={navigatorData}
          selection={selectionDraft}
          onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
        />,
      );
    } else {
      navigatorRef.current(null);
    }
  });

  // ── Build view elements map ────────────────────────────────────────────
  const viewElements: Record<string, ReactNode> = {};

  if (hasTimeseries) {
    viewElements["timeseries"] = timeseriesData ? (
      <TimeseriesComponent
        slice={timeseriesData}
        selection={selectionDraft}
        events={eventWindowQuery.data ?? []}
        onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
        onTimeWindowChange={setTimeWindow}
      />
    ) : (
      <div className="placeholder">Loading…</div>
    );
  }

  if (hasSpatial) {
    viewElements["spatial_map"] = spatialSliceQuery.data ? (
      <SpatialMapComponent
        slice={spatialSliceQuery.data}
        selection={selectionDraft}
        onSelectCell={(ap, ml) =>
          onCommitSelection({ ...selectionDraft, ap, ml, channel: null })
        }
        onHoverElectrode={setHoveredElectrode}
      />
    ) : (
      <div className="placeholder">Loading…</div>
    );
  }

  if (hasPropagation) {
    viewElements["propagation_frame"] = (
      <div className="propagation-panel">
        {timeCoord && (
          <AnimationController
            timeRange={[timeCoord.min as number ?? 0, timeCoord.max as number ?? 10]}
            fps={10}
          />
        )}
        {propagationFrame ? (
          <PropagationView
            slice={propagationFrame}
            selection={selectionDraft}
            onSelectCell={(ap, ml) =>
              onCommitSelection({ ...selectionDraft, ap, ml, channel: null })
            }
            onHoverElectrode={setHoveredElectrode}
          />
        ) : null}
      </div>
    );
  }

  if (hasSpectrogram && spectrogramSliceQuery.data) {
    viewElements["spectrogram"] = (
      <SpectrogramComponent
        slice={spectrogramSliceQuery.data}
        selection={selectionDraft}
        onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
        onSelectFreq={handleSelectFreq}
      />
    );
  }

  if (hasPSD && psdSliceQuery.data) {
    viewElements["psd_average"] = (
      <PSDComponent
        slice={psdSliceQuery.data}
        selection={selectionDraft}
        onSelectFreq={handleSelectFreq}
      />
    );
  }

  if (firstEventStream && hasSpatial) {
    viewElements["spatial_event"] = (
      <SpatialEventView
        tensorName={selectedTensor}
        periEventWindow={0.05}
      />
    );
  }

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

      {/* Navigator inline fallback — shown when no bottom panel render prop */}
      {!renderNavigator && navigatorData && (
        <NavigatorView
          slice={navigatorData}
          selection={selectionDraft}
          onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
        />
      )}

      {/* View grid replaces the old hardcoded layout */}
      <ViewGrid
        viewElements={viewElements}
        activeViewIds={effectiveActiveViews}
        availableViews={availableViews}
      />
    </div>
  );
}
