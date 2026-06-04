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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  eventTimeRange,
  useProcessingQuery,
  useSetProcessing,
  PSD_EVENT_LOCK_MARGIN_S,
  useEventWindowQueries,
  useStateQuery,
  useTensorQuery,
} from "../../api/queries";
import { coincidenceIndicesByStream, extractEventTimes } from "../../api/coincidence";
import { useEventStreamsStore } from "../../store/eventStreamsStore";
import { buildStreamColorMap } from "./eventStreamColors";
import type { SelectionDTO, TensorSliceRequestDTO } from "../../api/types";
import { resolveBand, useAppStore } from "../../store/appStore";
import { useViewportStore } from "../../store/viewportStore";
import { useTimeNavigation } from "./useTimeNavigation";
import { useWorkspaceData } from "./useWorkspaceData";
import { getAvailableViews, getOrthoPair, viewRegistry } from "../../registry/viewRegistry";
import { EventAverageView } from "./EventAverageView";
import { TrackStack } from "./TrackStack";
import { TrajectoryView } from "./TrajectoryView";
import { NavigatorView } from "./NavigatorView";
import { TimeScaleBar } from "./ChartToolbar";
import { PSDCurveView } from "./PSDCurveView";
import { PSDSpatialView } from "./PSDSpatialView";
import { PropagationController } from "./PropagationController";
import { DepthMapSliceView } from "./DepthMapSliceView";
import { HeatmapView } from "./HeatmapView";
import { SpatialMapSliceView } from "./SpatialMapSliceView";
import { PSDSliceView } from "./PSDSliceView";
import { SpatialEventView } from "./SpatialEventView";
import { SpectrogramView } from "./SpectrogramView";
// PSDHeatmapView retired in the v2 cutover — psd_heatmap renders via the
// encoding-driven HeatmapView (extractHeatmapNDV2) instead.
import { TimeseriesSliceView } from "./TimeseriesSliceView";
import { OrthoSlicerView } from "./OrthoSlicerView";
import { TensorChooser } from "./TensorChooser";
import { TensorOverview } from "./TensorOverview";
import { ViewGrid } from "./ViewGrid";
import { ProcessingPanel } from "../controls/ProcessingPanel";

const PSD_LIVE_EXPANSION = ["psd_heatmap", "psd_curve", "psd_spatial"];

/**
 * Replace server's "psd_live" with the frontend sub-view IDs.
 *
 * For a linear probe (signalled by `depth_map` being available) psd_spatial is
 * dropped: on a 1-D channel axis it collapses to a single freq column of the
 * heatmap — redundant. Grid tensors keep all three (psd_spatial is a real 2-D
 * AP×ML map there). See docs/design/neuropixels-multiprobe.md §3.
 */
function expandPSDLive(views: string[]): string[] {
  if (!views.includes("psd_live")) return views;
  const isLinear = views.includes("depth_map");
  const expansion = isLinear
    ? ["psd_heatmap", "psd_curve"]
    : PSD_LIVE_EXPANSION;
  const result = views.filter((v) => v !== "psd_live");
  for (const id of expansion) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

type WorkspaceMainProps = {
  onCommitSelection: (dto: SelectionDTO) => void;
  /** Render prop: receives the navigator element to be placed in the bottom panel. */
  renderNavigator?: (node: ReactNode) => void;
};

/** Inline processing panel scoped to a specific tensor, used from the chip strip. */
function ObjectProcessingPanel({ tensorName, onClose }: { tensorName: string; onClose: () => void }) {
  const processingQuery = useProcessingQuery();
  const setProcessingMutation = useSetProcessing();
  if (!processingQuery.data) return null;
  return (
    <ProcessingPanel
      params={processingQuery.data}
      onApply={(p) => setProcessingMutation.mutate(p)}
      isPending={setProcessingMutation.isPending}
      tensorName={tensorName}
      onClose={onClose}
    />
  );
}

export function WorkspaceMain({ onCommitSelection, renderNavigator }: WorkspaceMainProps) {
  const [processingObjectId, setProcessingObjectId] = useState<string | null>(null);

  const {
    selectedTensor,
    activeViews,
    setSelectedTensor,
    toggleView,
    brainstateOverlay,
    psdFmax,
    psdNW,
    psdWindowS,
    psdLockToEvent,
    freqLogScale,
    bandPreset,
    bandCustom,
    focusChannel,
    setFocusChannel,
    workspaceObjects,
    setWorkspaceObjects,
    setObjectVisible,
    objectLayoutMode,
    setObjectLayoutMode,
  } = useAppStore();

  // `onCommitSelection` is a fresh arrow on every App render (App.tsx:68
  // wraps a mutation without useCallback). We don't want it as a memo dep
  // here — read it through a ref so children that capture it get the
  // current implementation without invalidating downstream memoisation.
  const commitSelectionRef = useRef(onCommitSelection);
  commitSelectionRef.current = onCommitSelection;

  const stateQuery = useStateQuery();

  // Auto-select the server's active tensor on first load so queries fire immediately
  // without requiring a manual selection interaction.
  useEffect(() => {
    const active = stateQuery.data?.active_tensor;
    if (!selectedTensor && active) setSelectedTensor(active);
  }, [selectedTensor, stateQuery.data?.active_tensor, setSelectedTensor]);

  // Synthesize workspace objects from the tensor list
  useEffect(() => {
    const tensors = stateQuery.data?.tensors;
    if (!tensors) return;
    setWorkspaceObjects(
      tensors.map((t) => ({
        id: t.name,
        name: t.name,
        tensorName: t.name,
        type: t.source !== null ? "derived" : "source",
        visible: true,
      })),
    );
  }, [stateQuery.data?.tensors, setWorkspaceObjects]);

  const tensorQuery = useTensorQuery(selectedTensor);

  // Escape clears the focus-channel mode globally. Bails inside inputs so
  // hitting Escape to close a popover (event annotation) doesn't also
  // exit focus.
  useEffect(() => {
    if (!focusChannel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) return;
      setFocusChannel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusChannel, setFocusChannel]);

  // Switching tensors clears any stale focus — `ap=5, ml=3` only means
  // something for the tensor whose grid you clicked on.
  useEffect(() => {
    setFocusChannel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTensor]);

  // Derive available views from stateQuery immediately (no waterfall) and
  // fall back to the richer tensorQuery once it resolves.
  // Use stateQuery.data.active_tensor as fallback because selectedTensor is set
  // by a useEffect that runs after the first render.
  const activeTensorName = selectedTensor ?? stateQuery.data?.active_tensor ?? null;
  const activeTensorSummary = stateQuery.data?.tensors.find((t) => t.name === activeTensorName);
  const earlyAvailableViews = activeTensorSummary
    ? getAvailableViews(activeTensorSummary).map((d) => d.id)
    : [];
  // Expand server-side "psd_live" into the three frontend sub-view IDs
  // so they appear in available/active views automatically.
  const rawAvailableViews = tensorQuery.data?.available_views ?? earlyAvailableViews;
  const availableViews = expandPSDLive(rawAvailableViews);
  const effectiveActiveViews = activeViews.length === 0 ? availableViews : activeViews;
  const hasTimeseries = effectiveActiveViews.includes("timeseries");
  const hasSpatial = effectiveActiveViews.includes("spatial_map");
  const hasDepthMap = effectiveActiveViews.includes("depth_map");
  const hasRaster = effectiveActiveViews.includes("raster");
  const hasTrajectory = effectiveActiveViews.includes("trajectory");
  const hasPropagation = effectiveActiveViews.includes("propagation_frame");
  const hasPSD = effectiveActiveViews.includes("psd_average");
  const hasSpectrogram = effectiveActiveViews.includes("spectrogram");
  const hasNavigator = availableViews.includes("navigator");
  const hasPSDLive = effectiveActiveViews.some((v) =>
    v === "psd_heatmap" || v === "psd_curve" || v === "psd_spatial",
  );
  const hasSpectrogramLive = effectiveActiveViews.includes("spectrogram_live");
  const hasEventAverage = effectiveActiveViews.includes("event_average");

  // Detect if the active tensor supports ortho-slicing (4D: time, freq, AP, ML)
  const tensorDims = tensorQuery.data?.dims ?? activeTensorSummary?.dims ?? [];
  const orthoPair = getOrthoPair(tensorDims);

  const timeCoord = tensorQuery.data?.coords.find((c) => c.name === "time");

  // Time / cursor navigation controller — owns the live window, the debounced +
  // data-bounds-clamped fetch window, the memoised selection draft, and the
  // freq/duration/hover handlers. See ./useTimeNavigation.
  const {
    selectionDraft,
    timeWindow,
    setTimeWindow,
    viewportDuration,
    setDuration,
    handleSelectFreq,
    setHoveredElectrode,
    safeWindow,
    expensiveSafeWindow,
    selectedEventId,
    selectedStreamName,
  } = useTimeNavigation(timeCoord);

  // G8: PSD-lock-to-event derivation.
  //
  // When `psdLockToEvent` is on AND the user has an event selected, the PSD
  // live request uses the event's `[t_start, t_end]` span (extended by
  // PSD_EVENT_LOCK_MARGIN_S) instead of the cursor-centred window. The
  // record is looked up by `id_col` against the same `eventsByStream` map
  // that drives the timeseries event markers, so the locked window stays
  // in sync with whatever the table/timeline shows.
  const eventStreamsList = stateQuery.data?.events ?? [];
  const { pinnedStreams, coincidenceWindow } = useEventStreamsStore();
  const eventsByStream = useEventWindowQueries(pinnedStreams, selectionDraft, 2);

  const lockedEventTimeRange = useMemo<[number, number] | null>(() => {
    if (!psdLockToEvent || selectedEventId == null || !selectedStreamName) return null;
    const meta = eventStreamsList.find((s) => s.name === selectedStreamName);
    const records = eventsByStream.get(selectedStreamName);
    if (!meta || !records) return null;
    const rec = records.find(
      (r) => (r.record as Record<string, unknown>)[meta.id_col] === selectedEventId,
    );
    const span = eventTimeRange(rec?.record as Record<string, unknown> | undefined, meta.time_col);
    if (!span) return null;
    return [
      Math.max(0, span[0] - PSD_EVENT_LOCK_MARGIN_S),
      span[1] + PSD_EVENT_LOCK_MARGIN_S,
    ];
  }, [
    psdLockToEvent,
    selectedEventId,
    selectedStreamName,
    eventStreamsList,
    eventsByStream,
  ]);

  /**
   * Focus-channel restriction. When the reviewer has clicked a spatial
   * cell, both the timeseries and spectrogram_live should drill into
   * that single (AP, ML) cell rather than show all 256 channels. Server
   * `ap_range`/`ml_range` are inclusive `[lo, hi]`, so a one-cell range
   * is `[ap, ap]`. Single-channel `(channel,)` tensors don't have AP/ML
   * dims; the server ignores the params and the focus mode is a no-op.
   */
  const withFocus = useCallback(
    <T extends TensorSliceRequestDTO | null>(req: T): T => {
      if (!req || !focusChannel) return req;
      return {
        ...req,
        ap_range: [focusChannel.ap, focusChannel.ap],
        ml_range: [focusChannel.ml, focusChannel.ml],
      } as T;
    },
    [focusChannel],
  );

  // Filtered-band overlay (G1, `docs/design/filtered-band-overlay.md`):
  // active band preset ([lo,hi]) or null when the overlay is off.
  const activeBand = resolveBand(bandPreset, bandCustom);

  // Measured timeseries panel width → viewport-derived LOD point budget (P6).
  // Null until the panel's ResizeObserver first fires; makeDefaultSliceRequest
  // falls back to a sensible constant in that gap.
  const timeseriesPixelWidth = useViewportStore((s) => s.timeseriesWidthPx) ?? undefined;

  // Per-view data layer — every slice query (v2 + the not-yet-migrated v1
  // views), the brainstate metadata/intervals fetch, the sticky "last good
  // slice" pins, and the derived per-view status maps. See ./useWorkspaceData.
  const {
    v2TimeseriesData,
    v2SpectrogramData,
    v2NavigatorData,
    v2BandpassData,
    v2SpatialData,
    v2PsdLiveData,
    v2PsdAverageData,
    depthMapSliceQuery,
    rasterSliceQuery,
    trajectorySliceQuery,
    spectrogramSliceQuery,
    spectrogramLiveV2Query,
    psdLiveV2Query,
    brainstateIntervals,
    brainstateAvailable,
    fetchingByView,
    erroredByView,
    staleByView,
  } = useWorkspaceData({
    selectedTensor,
    selectionDraft,
    safeWindow,
    expensiveSafeWindow,
    timeCoord,
    flags: {
      hasTimeseries,
      hasSpatial,
      hasDepthMap,
      hasRaster,
      hasTrajectory,
      hasPSD,
      hasSpectrogram,
      hasNavigator,
      hasPSDLive,
      hasSpectrogramLive,
    },
    withFocus,
    psd: { nw: psdNW, fmax: psdFmax, windowS: psdWindowS },
    lockedEventTimeRange,
    activeBand,
    timeseriesPixelWidth,
  });

  // Multi-stream event window for the timeseries markers (G5). The
  // `pinnedStreams`/`eventsByStream` declarations live above (alongside the
  // PSD-lock-to-event derivation that consumes them); only the derived
  // colour map + first-stream helper hang off them here.
  const firstEventStream = eventStreamsList[0] ?? null;
  const streamColorsMap = useMemo(() => buildStreamColorMap(pinnedStreams), [pinnedStreams]);

  const coincidentTimes = useMemo<number[]>(() => {
    if (pinnedStreams.length < 2) return [];
    const byStream = new Map<string, ReturnType<typeof extractEventTimes>>();
    for (const name of pinnedStreams) {
      const recs = eventsByStream.get(name);
      const meta = eventStreamsList.find((s) => s.name === name) ?? null;
      if (!recs) continue;
      byStream.set(name, extractEventTimes(recs, meta));
    }
    const idx = coincidenceIndicesByStream(byStream, coincidenceWindow);
    const times: number[] = [];
    for (const [name, set] of idx) {
      const evs = byStream.get(name);
      if (!evs) continue;
      for (const i of set) times.push(evs[i].t);
    }
    return times;
  }, [pinnedStreams, eventsByStream, eventStreamsList, coincidenceWindow]);

  const SpatialMapComponent = viewRegistry.spatial_map as typeof SpatialMapSliceView;
  const PSDComponent = viewRegistry.psd_average as typeof PSDSliceView;
  const SpectrogramComponent = viewRegistry.spectrogram;

  // ── Lift navigator to bottom panel via render prop ──────────────────────
  // The parent (App.tsx) stores the result in `useState<ReactNode>`. A
  // dep-less `useEffect(() => renderNavigator(<JSX>))` builds fresh JSX on
  // every render, every call fails the parent's `Object.is` bail-out, the
  // parent re-renders, the child re-fires the effect — and we cascade to
  // React's safety cap on every SSE-driven mutation.
  // Fix: memoise the JSX on its actual data dependencies, then push it to
  // the parent only when the memoised value's identity changes.
  // See docs/log/issue/issue-arash-20260508-170721-770464.md.
  const navigatorRef = useRef(renderNavigator);
  navigatorRef.current = renderNavigator;

  const timeWindowLo = timeWindow[0];
  const timeWindowHi = timeWindow[1];

  const navigatorElement = useMemo<ReactNode>(() => {
    if (!v2NavigatorData) return null;
    return (
      <>
        <NavigatorView
          v2Data={v2NavigatorData}
          selection={selectionDraft}
          onSelectTime={(t) => commitSelectionRef.current({ ...selectionDraft, time: t })}
          onTimeWindowChange={setTimeWindow}
          brainstateIntervals={brainstateIntervals}
          brainstateOverlayEnabled={brainstateOverlay && brainstateAvailable}
        />
        <TimeScaleBar
          timeCursor={selectionDraft.time}
          viewportDuration={viewportDuration}
          onViewportDurationChange={setDuration}
          onJumpToTime={(t) => commitSelectionRef.current({ ...selectionDraft, time: t })}
        />
        <TrackStack
          timeWindow={[timeWindowLo, timeWindowHi]}
          timeCursor={selectionDraft.time}
          onSelectTime={(t) => commitSelectionRef.current({ ...selectionDraft, time: t })}
        />
      </>
    );
  }, [
    selectionDraft,
    setTimeWindow,
    brainstateIntervals,
    brainstateOverlay,
    brainstateAvailable,
    viewportDuration,
    setDuration,
    timeWindowLo,
    timeWindowHi,
    v2NavigatorData,
  ]);

  useEffect(() => {
    navigatorRef.current?.(navigatorElement);
  }, [navigatorElement]);

  // ── Build view elements map ────────────────────────────────────────────
  const viewElements: Record<string, ReactNode> = {};

  if (hasTimeseries) {
    const dataRange: [number, number] | undefined =
      typeof timeCoord?.min === "number" && typeof timeCoord?.max === "number"
        ? [timeCoord.min, timeCoord.max]
        : undefined;
    viewElements["timeseries"] = v2TimeseriesData ? (
      <TimeseriesSliceView
        v2Data={v2TimeseriesData}
        v2BandpassData={v2BandpassData}
        bandPreset={bandPreset}
        bandActive={activeBand}
        focusChannel={focusChannel}
        onClearFocusChannel={() => setFocusChannel(null)}
        selection={selectionDraft}
        eventsByStream={eventsByStream}
        streamColors={streamColorsMap}
        coincidentTimes={coincidentTimes}
        brainstateIntervals={brainstateIntervals}
        brainstateOverlayEnabled={brainstateOverlay && brainstateAvailable}
        onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
        onTimeWindowChange={setTimeWindow}
        timeWindow={timeWindow}
        dataRange={dataRange}
      />
    ) : (
      <div className="placeholder">Loading…</div>
    );
  }

  if (hasSpatial) {
    viewElements["spatial_map"] = v2SpatialData ? (
      <SpatialMapComponent
        v2Cells={v2SpatialData}
        selection={selectionDraft}
        onSelectCell={(ap, ml) => {
          // Drilling down: enter focus mode AND move the cursor. The
          // timeseries + spectrogram_live slices pick up `focusChannel`
          // via `withFocus()` and restrict to this single cell. Escape
          // / "✕" in the focus banner clears it.
          setFocusChannel({ ap, ml });
          onCommitSelection({ ...selectionDraft, ap, ml, channel: null });
        }}
        onHoverElectrode={setHoveredElectrode}
      />
    ) : (
      <div className="placeholder">Loading…</div>
    );
  }

  if (hasDepthMap) {
    viewElements["depth_map"] = depthMapSliceQuery.data ? (
      <DepthMapSliceView
        slice={depthMapSliceQuery.data}
        selection={selectionDraft}
        onSelectCell={(ap) => {
          // ap is the depth rank == channel index for a single-column strip.
          setFocusChannel({ ap, ml: 0 });
          onCommitSelection({ ...selectionDraft, ap, ml: 0, channel: null });
        }}
      />
    ) : (
      <div className="placeholder">Loading…</div>
    );
  }

  if (hasRaster) {
    viewElements["raster"] = rasterSliceQuery.data ? (
      <HeatmapView
        slice={rasterSliceQuery.data}
        viewId="raster"
        defaultEncoding={{ x: "time", y: "channel" }}
        colormap="viridis"
      />
    ) : (
      <div className="placeholder">Loading…</div>
    );
  }

  if (hasTrajectory) {
    viewElements["trajectory"] = trajectorySliceQuery.data ? (
      <TrajectoryView
        slice={trajectorySliceQuery.data}
        selection={selectionDraft}
        onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
      />
    ) : (
      <div className="placeholder">Loading…</div>
    );
  }

  if (hasPropagation) {
    viewElements["propagation_frame"] = (
      <PropagationController
        tensorName={selectedTensor}
        timeCoord={timeCoord}
        selectionDraft={selectionDraft}
        onSelectCell={(ap, ml) => {
          setFocusChannel({ ap, ml });
          onCommitSelection({ ...selectionDraft, ap, ml, channel: null });
        }}
        onHoverElectrode={setHoveredElectrode}
      />
    );
  }

  if (hasSpectrogram) {
    if (orthoPair && activeTensorName) {
      // 4D tensor: render ortho-slicer (spectrogram + linked spatial map)
      viewElements["spectrogram"] = (
        <OrthoSlicerView
          tensorName={activeTensorName}
          selection={selectionDraft}
          timeWindow={timeWindow}
          timeCoord={timeCoord}
          onCommitSelection={onCommitSelection}
          onSelectFreq={handleSelectFreq}
          onTimeWindowChange={setTimeWindow}
          onHoverElectrode={setHoveredElectrode}
        />
      );
    } else if (spectrogramSliceQuery.data) {
      viewElements["spectrogram"] = (
        <SpectrogramComponent
          slice={spectrogramSliceQuery.data}
          selection={selectionDraft}
          onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          onSelectFreq={handleSelectFreq}
          onTimeWindowChange={setTimeWindow}
          timeWindow={timeWindow}
        />
      );
    }
  }

  if (hasSpectrogramLive) {
    // Multitaper compute can be slow on long windows / dense grids
    // (cogpy.spectral.multitaper.mtm_spectrogram is np.apply_along_axis
    // over per-channel ghostipy calls — sequential on the numpy path).
    // Render an explicit "Computing…" placeholder while the slice is in
    // flight so the slot doesn't read as broken / empty.
    viewElements["spectrogram_live"] = v2SpectrogramData ? (
      <SpectrogramView
        v2Data={v2SpectrogramData}
        selection={selectionDraft}
        onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
        onSelectFreq={handleSelectFreq}
        onTimeWindowChange={setTimeWindow}
        timeWindow={timeWindow}
      />
    ) : spectrogramLiveV2Query.isError ? (
      <div className="placeholder placeholder--error">
        spectrogram_live failed: {String(spectrogramLiveV2Query.error ?? "unknown")}
      </div>
    ) : (
      <div className="placeholder placeholder--computing">
        <span className="spinner" aria-hidden="true" /> Computing multitaper spectrogram…
      </div>
    );
  }

  if (hasPSD && v2PsdAverageData) {
    // The worker already reduced the cube to the {freqs, mean, std} curve (P8).
    viewElements["psd_average"] = (
      <PSDComponent
        v2Data={{ freqs: v2PsdAverageData.freqs, values: v2PsdAverageData.mean }}
        selection={selectionDraft}
        onSelectFreq={handleSelectFreq}
      />
    );
  }

  if (hasPSDLive) {
    // All three PSD-live subviews are fed from one v2 cube. The worker returns
    // a PSDLiveDecoded bundle (P8): `tensor` (the raw cube) drives the
    // encoding-driven heatmap and the freq-selected spatial map (both reshape
    // on the main thread because their inputs change live without a refetch),
    // and the worker-reduced `average` mean±std curve feeds psd_curve directly.
    // One server round-trip, three views.
    const avgData = v2PsdLiveData ? v2PsdLiveData.average : null;

    if (v2PsdLiveData && avgData) {
      const psdCube = v2PsdLiveData.tensor;
      // Encoding-driven heatmap: freq on X, channel/spatial dim on Y so
      // depth/channel reads vertically. The y-dim defaults to whichever
      // channel-like dim the PSD cube carries (`channel` for linear probes,
      // else `AP`). Remaining dims (e.g. ML) are mean-reduced; the user can
      // reassign axes live. See docs/design/encoding-heatmap.md.
      const psdYDim = psdCube.meta.dims.includes("channel")
        ? "channel"
        : psdCube.meta.dims.includes("AP")
          ? "AP"
          : psdCube.meta.dims.find((c) => c !== "freq") ?? "channel";
      viewElements["psd_heatmap"] = (
        <HeatmapView
          v2={psdCube}
          viewId="psd_heatmap"
          defaultEncoding={{ x: "freq", y: psdYDim }}
          colormap="inferno"
          logColor
        />
      );
      viewElements["psd_curve"] = (
        <PSDCurveView
          data={avgData}
          selectedFreq={selectionDraft.freq}
          onSelectFreq={handleSelectFreq}
          freqLogScale={freqLogScale}
        />
      );
      viewElements["psd_spatial"] = (
        <PSDSpatialView
          v2={psdCube}
          selectedFreq={selectionDraft.freq}
          onSelectFreq={handleSelectFreq}
          onSelectCell={(ap, ml) => {
            // PSD-spatial map: same drill-down behaviour as the main
            // spatial map. The reviewer picked the cell whose PSD they
            // want to dig into — show that one channel everywhere.
            setFocusChannel({ ap, ml });
            onCommitSelection({ ...selectionDraft, ap, ml, channel: null });
          }}
        />
      );
    } else {
      // Loading / error placeholders for the three PSD-live subviews so
      // each slot signals work-in-flight rather than rendering empty.
      const placeholder = psdLiveV2Query.isError ? (
        <div className="placeholder placeholder--error">
          psd_live failed: {String(psdLiveV2Query.error ?? "unknown")}
        </div>
      ) : (
        <div className="placeholder placeholder--computing">
          <span className="spinner" aria-hidden="true" /> Computing PSD…
        </div>
      );
      viewElements["psd_heatmap"] = placeholder;
      viewElements["psd_curve"] = placeholder;
      viewElements["psd_spatial"] = placeholder;
    }
  }

  if (hasEventAverage) {
    viewElements["event_average"] = (
      <EventAverageView
        tensorName={selectedTensor}
        eventStreams={stateQuery.data?.events ?? []}
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
          availableViews={availableViews}
          activeViews={activeViews}
          onToggleView={(v) => toggleView(v, availableViews)}
        />
      ) : null}

      {/* Navigator inline fallback — shown when no bottom panel render prop */}
      {!renderNavigator && v2NavigatorData && (
        <>
          <NavigatorView
            v2Data={v2NavigatorData}
            selection={selectionDraft}
            onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
            onTimeWindowChange={setTimeWindow}
            brainstateIntervals={brainstateIntervals}
            brainstateOverlayEnabled={brainstateOverlay && brainstateAvailable}
          />
          <TimeScaleBar
            timeCursor={selectionDraft.time}
            viewportDuration={viewportDuration}
            onViewportDurationChange={setDuration}
            onJumpToTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          />
          <TrackStack
            timeWindow={timeWindow}
            timeCursor={selectionDraft.time}
            onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          />
        </>
      )}

      {/* Workspace object chips */}
      {workspaceObjects.length > 1 && (
        <div className="workspace-object-strip">
          <div className="object-layout-toggle">
            {(["single", "row", "column"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`ts-tool${objectLayoutMode === m ? " active" : ""}`}
                title={`Layout: ${m}`}
                onClick={() => setObjectLayoutMode(m)}
              >
                {m === "single" ? "⊡" : m === "row" ? "⊟" : "⊞"}
              </button>
            ))}
          </div>
          {workspaceObjects.map((obj) => (
            <div
              key={obj.id}
              className={`object-chip object-chip--${obj.type}${obj.tensorName === (selectedTensor ?? stateQuery.data?.active_tensor) ? " object-chip--active" : ""}`}
              onClick={() => setSelectedTensor(obj.tensorName)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedTensor(obj.tensorName); }}
            >
              <span className="object-chip-dot" />
              <span className="object-chip-name">{obj.name}</span>
              <button
                type="button"
                className="object-chip-vis"
                title={obj.visible ? "Hide" : "Show"}
                onClick={(e) => { e.stopPropagation(); setObjectVisible(obj.id, !obj.visible); }}
              >
                {obj.visible ? "●" : "○"}
              </button>
              <button
                type="button"
                className="object-chip-vis"
                title="Process…"
                onClick={(e) => {
                  e.stopPropagation();
                  setProcessingObjectId((prev) => prev === obj.id ? null : obj.id);
                }}
              >
                ⚙
              </button>
            </div>
          ))}
        </div>
      )}
      {processingObjectId !== null && workspaceObjects.length > 1 && (() => {
        const obj = workspaceObjects.find((o) => o.id === processingObjectId);
        return obj ? (
          <ObjectProcessingPanel
            tensorName={obj.tensorName}
            onClose={() => setProcessingObjectId(null)}
          />
        ) : null;
      })()}

      {/* View grid replaces the old hardcoded layout */}
      <ViewGrid
        viewElements={viewElements}
        fetchingByView={fetchingByView}
        erroredByView={erroredByView}
        staleByView={staleByView}
        activeViewIds={effectiveActiveViews}
        availableViews={availableViews}
        globalTensor={activeTensorName ?? ""}
        tensorNames={(stateQuery.data?.tensors ?? []).map((t) => t.name)}
      />
    </div>
  );
}
