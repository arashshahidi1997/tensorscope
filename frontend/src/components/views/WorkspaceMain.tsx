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
  clampWindow,
  makeDefaultSliceRequest,
  useProcessingQuery,
  useSetProcessing,
  makeNavigatorRequest,
  makePSDLiveRequest,
  makeSpectrogramLiveRequest,
  useBrainstateIntervalsQuery,
  useBrainstateMetaQuery,
  useEventWindowQuery,
  useSliceQuery,
  useStateQuery,
  useTensorQuery,
  useV2PSDHeatmapQuery,
  useV2SpectrogramQuery,
  useV2TimeseriesQuery,
  isV2Enabled,
} from "../../api/queries";
import {
  decodeArrowSlice,
  extractPSDHeatmap,
  extractPSDAverage,
  type ColumnarTimeseries,
  type PSDHeatmapData,
  type Spectrogram,
} from "../../api/arrow";
import type { SelectionDTO } from "../../api/types";
import { resolveBand, useAppStore } from "../../store/appStore";
import { useSelectionStore, toSelectionDTO } from "../../store/selectionStore";
import { getAvailableViews, getOrthoPair, viewRegistry } from "../../registry/viewRegistry";
import { HypnogramView } from "./HypnogramView";
import { NavigatorView } from "./NavigatorView";
import { TimeScaleBar } from "./ChartToolbar";
import { PSDHeatmapView } from "./PSDHeatmapView";
import { PSDCurveView } from "./PSDCurveView";
import { PSDSpatialView } from "./PSDSpatialView";
import { PropagationController } from "./PropagationController";
import { SpatialMapSliceView } from "./SpatialMapSliceView";
import { SpatialEventView } from "./SpatialEventView";
import { SpectrogramView } from "./SpectrogramView";
import { TimeseriesSliceView } from "./TimeseriesSliceView";
import { OrthoSlicerView } from "./OrthoSlicerView";
import { TensorChooser } from "./TensorChooser";
import { TensorOverview } from "./TensorOverview";
import { ViewGrid } from "./ViewGrid";
import { ProcessingPanel } from "../controls/ProcessingPanel";

const PSD_LIVE_EXPANSION = ["psd_heatmap", "psd_curve", "psd_spatial"];

/** Replace server's "psd_live" with the three frontend sub-view IDs. */
function expandPSDLive(views: string[]): string[] {
  if (!views.includes("psd_live")) return views;
  const result = views.filter((v) => v !== "psd_live");
  for (const id of PSD_LIVE_EXPANSION) {
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
    showHypnogram,
    psdFmax,
    psdNW,
    psdWindowS,
    freqLogScale,
    bandPreset,
    bandCustom,
    workspaceObjects,
    setWorkspaceObjects,
    setObjectVisible,
    objectLayoutMode,
    setObjectLayoutMode,
  } = useAppStore();
  const selectionState = useSelectionStore();
  const { timeWindow, setTimeWindow, setFreq, setHoveredElectrode, viewportDuration, setViewportDuration } = selectionState;

  // Store-local freq update — no server round-trip; spectrogram and PSD already
  // render the full freq range and project the cursor client-side.
  const handleSelectFreq = useCallback((freq: number) => setFreq({ freq }), [setFreq]);
  // Memoise selectionDraft on the underlying primitives so its identity is
  // stable across renders that don't actually change the selection. Without
  // this, every store mutation (including hover-only events on the canvas
  // that touch `spatial.hoveredId`) produces a fresh DTO and invalidates
  // every downstream memo.
  const selectionDraft = useMemo(
    () => toSelectionDTO(selectionState),
    [
      selectionState.timeCursor,
      selectionState.freq.freq,
      selectionState.spatial.ap,
      selectionState.spatial.ml,
      selectionState.spatial.channel,
    ],
  );

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
  const hasPropagation = effectiveActiveViews.includes("propagation_frame");
  const hasPSD = effectiveActiveViews.includes("psd_average");
  const hasSpectrogram = effectiveActiveViews.includes("spectrogram");
  const hasNavigator = availableViews.includes("navigator");
  const hasPSDLive = effectiveActiveViews.some((v) =>
    v === "psd_heatmap" || v === "psd_curve" || v === "psd_spatial",
  );
  const hasSpectrogramLive = effectiveActiveViews.includes("spectrogram_live");

  // Detect if the active tensor supports ortho-slicing (4D: time, freq, AP, ML)
  const tensorDims = tensorQuery.data?.dims ?? activeTensorSummary?.dims ?? [];
  const orthoPair = getOrthoPair(tensorDims);

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
  const psdLiveQuery = useSliceQuery(
    selectedTensor,
    hasPSDLive
      ? makePSDLiveRequest(selectionDraft, psdWindowS, timeCoord, { NW: psdNW, fmax: psdFmax })
      : null,
  );

  // Contract-v2 PSDHeatmap path. Behind localStorage["tensorscope:v2"]==="1".
  // Reads via the worker pool — main-thread blocking goes from ~150 ms (v1
  // long-format decode) to ~1 ms (postMessage round-trip). The flag is read
  // every render so a tab toggling it picks up on the next React Query
  // refetch — but `useV2PSDHeatmapQuery` keys off `request === null` to
  // gate the actual fetch, so a flag flip during navigation is harmless.
  const v2Enabled = isV2Enabled();
  const psdLiveV2Query = useV2PSDHeatmapQuery(
    selectedTensor,
    hasPSDLive && v2Enabled
      ? makePSDLiveRequest(selectionDraft, psdWindowS, timeCoord, { NW: psdNW, fmax: psdFmax })
      : null,
  );
  // Spectrogram live — multitaper spectrogram on the visible window. Server
  // defaults are sleep-band tuned (Prerau-style baseline subtraction); the
  // frontend doesn't currently expose a knob panel for these, but the
  // request shape forwards any params on the wire. We pass `safeWindow`
  // (already clamped against the tensor's time coord) so the heatmap's
  // x-axis tracks the timeseries / navigator visible range.
  const spectrogramLiveQuery = useSliceQuery(
    selectedTensor,
    hasSpectrogramLive ? makeSpectrogramLiveRequest(selectionDraft, safeWindow) : null,
  );
  const navigatorSliceQuery = useSliceQuery(
    selectedTensor,
    hasNavigator && timeCoord ? makeNavigatorRequest(selectionDraft, timeCoord) : null,
  );

  // Contract-v2 parallel queries for timeseries / spectrogram_live / navigator.
  // Same gating pattern as `psdLiveV2Query`: only fire when the v2 flag is on
  // and the corresponding v1 query would have fired. Each worker call returns
  // a pre-extracted shape the view consumes directly via `v2Data`.
  const timeseriesV2Query = useV2TimeseriesQuery(
    selectedTensor,
    hasTimeseries && v2Enabled
      ? makeDefaultSliceRequest("timeseries", selectionDraft, safeWindow)
      : null,
    "Timeseries",
  );
  const spectrogramLiveV2Query = useV2SpectrogramQuery(
    selectedTensor,
    hasSpectrogramLive && v2Enabled
      ? makeSpectrogramLiveRequest(selectionDraft, safeWindow)
      : null,
    "SpectrogramLive",
  );
  const navigatorV2Query = useV2TimeseriesQuery(
    selectedTensor,
    hasNavigator && timeCoord && v2Enabled
      ? makeNavigatorRequest(selectionDraft, timeCoord)
      : null,
    "Navigator",
  );

  // Filtered-band overlay (G1, `docs/design/filtered-band-overlay.md`).
  // Fires only when a band preset is active AND v2 is on. Reuses the
  // timeseries shape — server applies `bandpass` after slicing.
  const activeBand = resolveBand(bandPreset, bandCustom);
  const bandpassRequest =
    hasTimeseries && v2Enabled && activeBand
      ? {
          ...makeDefaultSliceRequest("timeseries", selectionDraft, safeWindow),
          bandpass: { lo_hz: activeBand[0], hi_hz: activeBand[1] },
        }
      : null;
  const timeseriesBandpassQuery = useV2TimeseriesQuery(
    selectedTensor,
    bandpassRequest,
    "TimeseriesBandpass",
  );

  // Brainstate queries — fetch metadata once, intervals per visible window
  const brainstateMetaQuery = useBrainstateMetaQuery();
  const brainstateAvailable = brainstateMetaQuery.data?.available ?? false;
  const brainstateTimeRange = brainstateMetaQuery.data?.time_range ?? [null, null];
  // Fetch all intervals (no window filter) since the dataset is small
  const brainstateIntervalsQuery = useBrainstateIntervalsQuery(
    brainstateAvailable && typeof brainstateTimeRange[0] === "number" ? brainstateTimeRange[0] : undefined,
    brainstateAvailable && typeof brainstateTimeRange[1] === "number" ? brainstateTimeRange[1] : undefined,
  );
  const brainstateIntervals = brainstateIntervalsQuery.data ?? [];

  // Keep the last successfully-received slice for each view so that a transient
  // query error (e.g. zooming between two samples → 400 "no data") does not blank
  // the panel.  The ref is updated on every successful data arrival.
  const lastTimeseries = useRef(timeseriesSliceQuery.data ?? null);
  const lastNavigator = useRef(navigatorSliceQuery.data ?? null);
  if (timeseriesSliceQuery.data) lastTimeseries.current = timeseriesSliceQuery.data;
  if (navigatorSliceQuery.data) lastNavigator.current = navigatorSliceQuery.data;
  const timeseriesData = timeseriesSliceQuery.data ?? lastTimeseries.current;
  const navigatorData = navigatorSliceQuery.data ?? lastNavigator.current;

  // Same optimistic-render pattern for the v2 PSDHeatmap path. Combined
  // with `placeholderData: keepPreviousData` on the v2 query, this means
  // the canvas keeps painting the previous slice through any brief
  // window where the new fetch is in flight or has errored. Per
  // `docs/design/contract-v2.md` §0.2 (Neuroglancer "render whatever's
  // in GPU memory immediately" + HiGlass "old tiles remain visible").
  const lastPsdHeatmapV2 = useRef<PSDHeatmapData | null>(null);
  if (psdLiveV2Query.data) lastPsdHeatmapV2.current = psdLiveV2Query.data;
  const v2HeatmapData = psdLiveV2Query.data ?? lastPsdHeatmapV2.current;

  // Same sticky-ref optimistic render for v2 timeseries / spectrogram /
  // navigator. Each view falls back to `last…V2.current` when its v2 query
  // is in flight, so the canvas never blanks during a drag.
  const lastTimeseriesV2 = useRef<ColumnarTimeseries | null>(null);
  const lastSpectrogramV2 = useRef<Spectrogram | null>(null);
  const lastNavigatorV2 = useRef<ColumnarTimeseries | null>(null);
  const lastBandpassV2 = useRef<ColumnarTimeseries | null>(null);
  if (timeseriesV2Query.data) lastTimeseriesV2.current = timeseriesV2Query.data;
  if (spectrogramLiveV2Query.data) lastSpectrogramV2.current = spectrogramLiveV2Query.data;
  if (navigatorV2Query.data) lastNavigatorV2.current = navigatorV2Query.data;
  if (timeseriesBandpassQuery.data) lastBandpassV2.current = timeseriesBandpassQuery.data;
  // When the user toggles bandpass off, clear the sticky ref so the
  // filtered overlay disappears immediately instead of lingering as a
  // stale series.
  if (!activeBand) lastBandpassV2.current = null;
  const v2TimeseriesData = timeseriesV2Query.data ?? lastTimeseriesV2.current;
  const v2SpectrogramData = spectrogramLiveV2Query.data ?? lastSpectrogramV2.current;
  const v2NavigatorData = navigatorV2Query.data ?? lastNavigatorV2.current;
  const v2BandpassData = activeBand
    ? (timeseriesBandpassQuery.data ?? lastBandpassV2.current)
    : null;

  // Event window for timeseries markers — same query key as the inspector's call,
  // so React Query deduplicates the request.
  const firstEventStream = stateQuery.data?.events[0] ?? null;
  const eventWindowQuery = useEventWindowQuery(firstEventStream?.name ?? null, selectionDraft, 2);

  const SpatialMapComponent = viewRegistry.spatial_map as typeof SpatialMapSliceView;
  const PSDComponent = viewRegistry.psd_average;
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

  const brainstateT0 = brainstateTimeRange[0];
  const brainstateT1 = brainstateTimeRange[1];
  const timeWindowLo = timeWindow[0];
  const timeWindowHi = timeWindow[1];

  const navigatorElement = useMemo<ReactNode>(() => {
    if (!navigatorData) return null;
    return (
      <>
        <NavigatorView
          slice={navigatorData}
          v2Data={v2Enabled ? v2NavigatorData : null}
          selection={selectionDraft}
          onSelectTime={(t) => commitSelectionRef.current({ ...selectionDraft, time: t })}
          onTimeWindowChange={setTimeWindow}
          brainstateIntervals={brainstateIntervals}
          brainstateOverlayEnabled={brainstateOverlay && brainstateAvailable}
        />
        <TimeScaleBar
          timeCursor={selectionDraft.time}
          viewportDuration={viewportDuration}
          onViewportDurationChange={setViewportDuration}
          onJumpToTime={(t) => commitSelectionRef.current({ ...selectionDraft, time: t })}
        />
        {showHypnogram && brainstateAvailable && brainstateIntervals.length > 0 && (
          <HypnogramView
            intervals={brainstateIntervals}
            timeRange={[
              typeof brainstateT0 === "number" ? brainstateT0 : 0,
              typeof brainstateT1 === "number" ? brainstateT1 : 10,
            ]}
            timeWindow={[timeWindowLo, timeWindowHi]}
            timeCursor={selectionDraft.time}
            onSelectTime={(t) => commitSelectionRef.current({ ...selectionDraft, time: t })}
          />
        )}
      </>
    );
  }, [
    navigatorData,
    selectionDraft,
    setTimeWindow,
    brainstateIntervals,
    brainstateOverlay,
    brainstateAvailable,
    viewportDuration,
    setViewportDuration,
    showHypnogram,
    brainstateT0,
    brainstateT1,
    timeWindowLo,
    timeWindowHi,
    v2Enabled,
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
    viewElements["timeseries"] = timeseriesData ? (
      <TimeseriesSliceView
        slice={timeseriesData}
        v2Data={v2Enabled ? v2TimeseriesData : null}
        v2BandpassData={v2BandpassData}
        bandPreset={bandPreset}
        bandActive={activeBand}
        selection={selectionDraft}
        events={eventWindowQuery.data ?? []}
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
      <PropagationController
        tensorName={selectedTensor}
        timeCoord={timeCoord}
        selectionDraft={selectionDraft}
        onSelectCell={(ap, ml) =>
          onCommitSelection({ ...selectionDraft, ap, ml, channel: null })
        }
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
    viewElements["spectrogram_live"] = spectrogramLiveQuery.data ? (
      <SpectrogramView
        slice={spectrogramLiveQuery.data}
        v2Data={v2Enabled ? v2SpectrogramData : null}
        selection={selectionDraft}
        onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
        onSelectFreq={handleSelectFreq}
        onTimeWindowChange={setTimeWindow}
        timeWindow={timeWindow}
      />
    ) : spectrogramLiveQuery.isError ? (
      <div className="placeholder placeholder--error">
        spectrogram_live failed: {String(spectrogramLiveQuery.error ?? "unknown")}
      </div>
    ) : (
      <div className="placeholder placeholder--computing">
        <span className="spinner" aria-hidden="true" /> Computing multitaper spectrogram…
      </div>
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

  if (hasPSDLive) {
    // Heatmap data routing: when the v2 dev flag is on AND the worker has
    // already returned a slice (live or sticky), feed the v2 result to
    // PSDHeatmapView. Otherwise fall back to the v1 long-format extractor
    // off `psdLiveQuery.data`. PSDCurve / PSDSpatial stay on v1 in this
    // session — those views migrate per the parity-gate process in
    // `docs/design/contract-v2.md` §5.
    const heatmapFromV2 = v2Enabled ? v2HeatmapData : null;

    if (psdLiveQuery.data) {
      const decoded = decodeArrowSlice(psdLiveQuery.data);
      const v1Heatmap = extractPSDHeatmap(decoded);
      const heatmapData = heatmapFromV2 ?? v1Heatmap;
      const avgData = extractPSDAverage(decoded);

      // Map selection.ap/ml indices → coord values so PSDHeatmapView can
      // mark the column corresponding to the spatial cursor (channel
      // labels in the heatmap payload are `AP{val}_ML{val}` from the
      // tensor's coord arrays). Without this the heatmap was a static
      // overview that ignored AP/ML changes.
      const apCoordVals = (tensorQuery.data?.coords.find((c) => c.name === "AP")?.values ?? null) as number[] | null;
      const mlCoordVals = (tensorQuery.data?.coords.find((c) => c.name === "ML")?.values ?? null) as number[] | null;
      const selAPVal = apCoordVals?.[selectionDraft.ap];
      const selMLVal = mlCoordVals?.[selectionDraft.ml];
      const indexFromCoord = (coords: number[] | null, target: number): number | null => {
        if (!coords) return null;
        for (let i = 0; i < coords.length; i++) if (coords[i] === target) return i;
        return null;
      };

      viewElements["psd_heatmap"] = (
        <PSDHeatmapView
          data={heatmapData}
          selectedFreq={selectionDraft.freq}
          onSelectFreq={handleSelectFreq}
          freqLogScale={freqLogScale}
          selectedAPVal={typeof selAPVal === "number" ? selAPVal : undefined}
          selectedMLVal={typeof selMLVal === "number" ? selMLVal : undefined}
          onSelectChannel={(apVal, mlVal) => {
            const apIdx = indexFromCoord(apCoordVals, apVal);
            const mlIdx = indexFromCoord(mlCoordVals, mlVal);
            if (apIdx == null || mlIdx == null) return;
            onCommitSelection({ ...selectionDraft, ap: apIdx, ml: mlIdx, channel: null });
          }}
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
          decoded={decoded}
          selectedFreq={selectionDraft.freq}
          onSelectFreq={handleSelectFreq}
          onSelectCell={(ap, ml) =>
            onCommitSelection({ ...selectionDraft, ap, ml, channel: null })
          }
        />
      );
    } else {
      // Loading / error placeholders for the three PSD-live subviews so
      // each slot signals work-in-flight rather than rendering empty.
      const placeholder = psdLiveQuery.isError ? (
        <div className="placeholder placeholder--error">
          psd_live failed: {String(psdLiveQuery.error ?? "unknown")}
        </div>
      ) : (
        <div className="placeholder placeholder--computing">
          <span className="spinner" aria-hidden="true" /> Computing PSD…
        </div>
      );
      // Optimistic-render edge case: the v2 heatmap path may have a result
      // before v1 returns (worker decode is faster, or v1 errored). Show
      // it instead of a placeholder so the canvas keeps content during the
      // window where only one path has data.
      if (heatmapFromV2) {
        viewElements["psd_heatmap"] = (
          <PSDHeatmapView
            data={heatmapFromV2}
            selectedFreq={selectionDraft.freq}
            onSelectFreq={handleSelectFreq}
            freqLogScale={freqLogScale}
          />
        );
      } else {
        viewElements["psd_heatmap"] = placeholder;
      }
      viewElements["psd_curve"] = placeholder;
      viewElements["psd_spatial"] = placeholder;
    }
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
      {!renderNavigator && navigatorData && (
        <>
          <NavigatorView
            slice={navigatorData}
            v2Data={v2Enabled ? v2NavigatorData : null}
            selection={selectionDraft}
            onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
            onTimeWindowChange={setTimeWindow}
            brainstateIntervals={brainstateIntervals}
            brainstateOverlayEnabled={brainstateOverlay && brainstateAvailable}
          />
          <TimeScaleBar
            timeCursor={selectionDraft.time}
            viewportDuration={viewportDuration}
            onViewportDurationChange={setViewportDuration}
            onJumpToTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
          />
          {showHypnogram && brainstateAvailable && brainstateIntervals.length > 0 && (
            <HypnogramView
              intervals={brainstateIntervals}
              timeRange={[
                typeof brainstateTimeRange[0] === "number" ? brainstateTimeRange[0] : 0,
                typeof brainstateTimeRange[1] === "number" ? brainstateTimeRange[1] : 10,
              ]}
              timeWindow={timeWindow}
              timeCursor={selectionDraft.time}
              onSelectTime={(t) => onCommitSelection({ ...selectionDraft, time: t })}
            />
          )}
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
        activeViewIds={effectiveActiveViews}
        availableViews={availableViews}
        globalTensor={activeTensorName ?? ""}
        tensorNames={(stateQuery.data?.tensors ?? []).map((t) => t.name)}
      />
    </div>
  );
}
