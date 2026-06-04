import { useRef } from "react";
import {
  makeDefaultSliceRequest,
  makeNavigatorRequest,
  makePSDLiveRequest,
  makeSpectrogramLiveRequest,
  makeTrajectoryRequest,
  useBrainstateIntervalsQuery,
  useBrainstateMetaQuery,
  useSliceQuery,
  useV2PSDAverageQuery,
  useV2PSDLiveQuery,
  useV2SpatialQuery,
  useV2SpectrogramQuery,
  useV2TimeseriesQuery,
} from "../../api/queries";
import type { CoordSummary, SelectionDTO, TensorSliceRequestDTO } from "../../api/types";
import { buildViewQueryStatusMaps } from "./viewQueryStatus";

/** Which view slots are live this render — gates each query's request to null. */
export type WorkspaceViewFlags = {
  hasTimeseries: boolean;
  hasSpatial: boolean;
  hasDepthMap: boolean;
  hasRaster: boolean;
  hasTrajectory: boolean;
  hasPSD: boolean;
  hasSpectrogram: boolean;
  hasNavigator: boolean;
  hasPSDLive: boolean;
  hasSpectrogramLive: boolean;
};

export type WorkspaceDataParams = {
  selectedTensor: string | null;
  selectionDraft: SelectionDTO;
  safeWindow: [number, number];
  /** Longer-debounced window for the Tier-2 expensive views (P5). */
  expensiveSafeWindow: [number, number];
  timeCoord: CoordSummary | undefined;
  flags: WorkspaceViewFlags;
  /** Adds `ap_range`/`ml_range` when the reviewer has drilled into one cell. */
  withFocus: <T extends TensorSliceRequestDTO | null>(req: T) => T;
  psd: { nw: number; fmax: number; windowS: number };
  /** Event-locked PSD window ([t0,t1] extended by margin) or null. */
  lockedEventTimeRange: [number, number] | null;
  /** Active filtered-band preset ([lo,hi]) or null when the overlay is off. */
  activeBand: [number, number] | null;
  /** Measured timeseries panel width (CSS px) → viewport-derived point budget (P6). */
  timeseriesPixelWidth?: number;
};

/**
 * Sticky-data: keep the last successfully-received result so a transient
 * query error (e.g. zooming between two samples → 400 "no data") doesn't blank
 * the panel. Combined with `placeholderData: keepPreviousData`, the canvas
 * keeps painting the previous slice through an in-flight or errored fetch
 * (contract-v2 §0.2: Neuroglancer "render whatever's in GPU memory" + HiGlass
 * "old tiles remain visible"). `keep=false` clears the pin and returns null
 * (used to drop the bandpass overlay the moment the band toggles off).
 */
function useStickyData<T>(value: T | null | undefined, keep = true): T | null {
  const ref = useRef<T | null>(null);
  if (value) ref.current = value;
  if (!keep) ref.current = null;
  return keep ? (value ?? ref.current) : null;
}

/**
 * Per-view data layer for the workspace.
 *
 * Owns every slice query (v2 + the not-yet-migrated v1 views), the brainstate
 * metadata/intervals fetch, the sticky "last good slice" pins, and the derived
 * per-view status maps. Returns the pre-extracted shapes each view consumes
 * plus the raw query handles needed by the render's loading/error branches.
 * Behaviour is identical to the previous inline block in WorkspaceMain —
 * each query is called unconditionally; the `has*` flag only gates the request
 * argument to null so the query stays disabled.
 */
export function useWorkspaceData(params: WorkspaceDataParams) {
  const {
    selectedTensor,
    selectionDraft,
    safeWindow,
    expensiveSafeWindow,
    timeCoord,
    flags,
    withFocus,
    psd,
    lockedEventTimeRange,
    activeBand,
    timeseriesPixelWidth,
  } = params;

  // Contract-v2 is the only data path. Each view's query returns the
  // pre-extracted shape the view consumes directly (no v1 long-format decode).
  const timeseriesV2Query = useV2TimeseriesQuery(
    selectedTensor,
    flags.hasTimeseries
      ? withFocus(makeDefaultSliceRequest("timeseries", selectionDraft, safeWindow, timeseriesPixelWidth))
      : null,
    "Timeseries",
  );
  const spatialV2Query = useV2SpatialQuery(
    selectedTensor,
    flags.hasSpatial ? makeDefaultSliceRequest("spatial_map", selectionDraft, safeWindow) : null,
  );
  // depth_map: linear-probe analogue of spatial_map (Neuropixels DV). Same
  // ±0.25 s instantaneous slice shape; server collapses time → (channel,)
  // profile with the depth coord. No v2 extractor yet → stays v1.
  const depthMapSliceQuery = useSliceQuery(
    selectedTensor,
    flags.hasDepthMap ? makeDefaultSliceRequest("depth_map", selectionDraft, safeWindow) : null,
  );
  // raster: channel × time amplitude heatmap over the visible window. No v2
  // extractor yet → stays v1.
  const rasterSliceQuery = useSliceQuery(
    selectedTensor,
    flags.hasRaster ? makeDefaultSliceRequest("raster", selectionDraft, safeWindow) : null,
  );
  // trajectory: full-session position path (time, axis). Pinned full-range
  // request (like the navigator) so the whole arena is visible and the query
  // key doesn't churn on cursor moves — the marker tracks selection.time.
  // No v2 extractor yet → stays v1.
  const trajectorySliceQuery = useSliceQuery(
    selectedTensor,
    flags.hasTrajectory && timeCoord ? makeTrajectoryRequest(selectionDraft, timeCoord) : null,
  );
  // Standalone psd_average — a pre-computed freq-only (or freq × spatial)
  // tensor. The view derives its `{freqs, values}` curve via extractPSDAverageV2.
  const psdAverageV2Query = useV2PSDAverageQuery(
    selectedTensor,
    flags.hasPSD ? makeDefaultSliceRequest("psd_average", selectionDraft, safeWindow) : null,
  );
  // Precomputed spectrogram (4D ortho path). No v2 extractor for the ortho
  // slicer yet → stays v1.
  const spectrogramSliceQuery = useSliceQuery(
    selectedTensor,
    flags.hasSpectrogram ? makeDefaultSliceRequest("spectrogram", selectionDraft, safeWindow) : null,
  );
  // Tier-2 deprioritization gate (P5): hold the expensive spectral queries
  // until the cheap Tier-0 timeseries query has settled, so a scrub/pan
  // doesn't enqueue a multitaper compute per intermediate window. When the
  // timeseries panel isn't live the gate is open (its query is disabled, so
  // `isFetching` stays false). psd_live is keyed on the cursor (not the
  // window), so the longer-debounced expensiveSafeWindow can't deprioritize
  // it — the settle gate does.
  const tier0Pending = flags.hasTimeseries && timeseriesV2Query.isFetching;

  // PSD-live cube — one (freq, AP, ML | channel) tensor feeds all three
  // subviews (psd_heatmap via extractHeatmapNDV2, psd_curve via
  // extractPSDAverageV2, psd_spatial via extractPSDSpatialV2).
  const psdLiveV2Query = useV2PSDLiveQuery(
    selectedTensor,
    flags.hasPSDLive && !tier0Pending
      ? makePSDLiveRequest(
          selectionDraft,
          psd.windowS,
          timeCoord,
          { NW: psd.nw, fmax: psd.fmax },
          lockedEventTimeRange,
        )
      : null,
  );
  // Spectrogram live — multitaper spectrogram on the visible window. Server
  // defaults are sleep-band tuned (Prerau-style baseline subtraction); the
  // request shape forwards any params on the wire. We pass `expensiveSafeWindow`
  // (the longer-debounced, clamped window — P5) so a scrub coalesces to one
  // compute on the final position; the heatmap's x-axis still tracks the
  // timeseries / navigator visible range once it settles.
  const spectrogramLiveV2Query = useV2SpectrogramQuery(
    selectedTensor,
    flags.hasSpectrogramLive
      ? withFocus(makeSpectrogramLiveRequest(selectionDraft, expensiveSafeWindow))
      : null,
    "SpectrogramLive",
  );
  const navigatorV2Query = useV2TimeseriesQuery(
    selectedTensor,
    flags.hasNavigator && timeCoord
      ? makeNavigatorRequest(selectionDraft, timeCoord)
      : null,
    "Navigator",
  );

  // Filtered-band overlay (G1, `docs/design/filtered-band-overlay.md`).
  // Fires only when a band preset is active. Reuses the timeseries shape —
  // server applies `bandpass` after slicing.
  const bandpassRequest =
    flags.hasTimeseries && activeBand
      ? withFocus({
          ...makeDefaultSliceRequest("timeseries", selectionDraft, safeWindow, timeseriesPixelWidth),
          bandpass: { lo_hz: activeBand[0], hi_hz: activeBand[1] },
        })
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

  // Sticky "last good slice" pins (see useStickyData). The bandpass pin is
  // cleared when no band is active so the filtered overlay disappears at once
  // instead of lingering as a stale series.
  const v2TimeseriesData = useStickyData(timeseriesV2Query.data);
  const v2SpectrogramData = useStickyData(spectrogramLiveV2Query.data);
  const v2NavigatorData = useStickyData(navigatorV2Query.data);
  const v2BandpassData = useStickyData(timeseriesBandpassQuery.data, Boolean(activeBand));
  const v2SpatialData = useStickyData(spatialV2Query.data);
  const v2PsdLiveData = useStickyData(psdLiveV2Query.data);
  const v2PsdAverageData = useStickyData(psdAverageV2Query.data);

  // Per-view query status. `useSliceQuery` uses `placeholderData:
  // keepPreviousData` + `retry: false`, so each panel keeps painting the
  // PREVIOUS slice through a refetch or error — without a signal the user
  // can't tell the panel is showing the wrong window. We surface three
  // flags per view (refactor-plan N2): isFetching (in flight), isError
  // (last fetch failed → showing stale-and-known-bad data), isPlaceholderData
  // (showing previous-window data while the new fetch is in flight).
  const { fetchingByView, erroredByView, staleByView } = buildViewQueryStatusMaps({
    timeseries: timeseriesV2Query,
    spatial_map: spatialV2Query,
    depth_map: depthMapSliceQuery,
    raster: rasterSliceQuery,
    trajectory: trajectorySliceQuery,
    psd_average: psdAverageV2Query,
    spectrogram: spectrogramSliceQuery,
    spectrogram_live: spectrogramLiveV2Query,
    navigator: navigatorV2Query,
    psd_heatmap: psdLiveV2Query,
    psd_curve: psdLiveV2Query,
    psd_spatial: psdLiveV2Query,
  });

  return {
    // Pre-extracted shapes each view renders directly.
    v2TimeseriesData,
    v2SpectrogramData,
    v2NavigatorData,
    v2BandpassData,
    v2SpatialData,
    v2PsdLiveData,
    v2PsdAverageData,
    // Raw query handles for the render's loading/error branches.
    depthMapSliceQuery,
    rasterSliceQuery,
    trajectorySliceQuery,
    spectrogramSliceQuery,
    spectrogramLiveV2Query,
    psdLiveV2Query,
    // Brainstate overlay inputs.
    brainstateIntervals,
    brainstateAvailable,
    // Per-view status flags for the grid chrome.
    fetchingByView,
    erroredByView,
    staleByView,
  };
}
