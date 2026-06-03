/**
 * React Query hooks and slice-request factories for TensorScope views.
 *
 * ## DataSource contract
 *
 * The functions in this file implement the `DataSource` contract defined in
 * `./dataSource.ts`. Views that call `useSliceQuery(name, makeDefaultSliceRequest(...))`
 * already satisfy that contract; the interface in `dataSource.ts` makes it explicit
 * so that Prompt 13 (LOD pipeline) and Prompt 14 (worker) can introduce
 * alternative implementations behind the same typed interface.
 *
 * Relationship:
 *   - `useSliceQuery`           → cached transport layer (React Query + HTTP)
 *   - `makeDefaultSliceRequest` → per-view pixel-budget defaults
 *   - `makeNavigatorRequest`    → full-range navigator variant
 *   - `clampWindow`             → guard against out-of-range slice requests
 *   - `DataSource` (dataSource.ts) → the interface all of the above implicitly implement
 */
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { BrainstateIntervalDTO, BrainstateMetaDTO, CoordSummary, EventAverageParamsDTO, EventRecordDTO, MaskStateDTO, ProbeLayoutDTO, ProcessingParamsDTO, ScalarSeriesDTO, SelectionDTO, TensorSliceRequestDTO, TrackMetaDTO } from "./types";
import type { WorkspaceDAGDTO } from "../types/dag";
import type { ColumnarTimeseries, PSDHeatmapData, Spectrogram } from "./arrow";
import { getArrowWorkerPool } from "./workerPool";

export function useStateQuery() {
  return useQuery({
    queryKey: ["state"],
    queryFn: api.getState,
  });
}

export function useTensorQuery(name: string | null) {
  return useQuery({
    queryKey: ["tensor", name],
    queryFn: () => api.getTensor(name!),
    enabled: Boolean(name),
  });
}

/**
 * Cached slice query — the transport layer of the `DataSource` contract.
 *
 * React Query provides deduplication, stale-while-revalidate, and
 * `keepPreviousData` to avoid blank frames during navigation.
 * The query key `["slice", name, request]` uses the full request object,
 * so any navigation change fires a new fetch.
 *
 * See `DataSource` in `./dataSource.ts` for the interface this implements.
 */
export function useSliceQuery(name: string | null, request: TensorSliceRequestDTO | null) {
  return useQuery({
    queryKey: ["slice", name, request],
    queryFn: ({ signal }) => api.getTensorSlice(name!, request!, signal),
    enabled: Boolean(name && request),
    placeholderData: keepPreviousData,
    // 400/422 errors from /slice are definitional (wrong params), not transient.
    // Retrying just adds 1-7 seconds of delay before the next correct query fires.
    retry: false,
  });
}

// ── Contract v2 ─────────────────────────────────────────────────────────────
//
// Phase 1: a parallel `useV2PSDHeatmapQuery` that fetches the binary v2
// payload, ships the ArrayBuffer to the worker pool for decode + extract,
// and returns the same `PSDHeatmapData` shape the v1 path produces. Behind
// `localStorage["tensorscope:v2"] === "1"`. Only PSDHeatmap migrates this
// session; remaining views follow per the parity-gate process in
// `docs/design/contract-v2.md` §5.

export const V2_FLAG_KEY = "tensorscope:v2";

export function isV2Enabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem(V2_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

// One-shot console log of the v2 payload size so we can spot regressions in
// wire size from the console. Logged once per view-type (psd_heatmap,
// timeseries, spectrogram_live, navigator). The v1-comparison fetch this
// used to fire has been removed — the ~5× reduction is already measured, and
// the comparison doubled every view's first-load traffic with a redundant v1
// request even when v2 is the only active path.
const _v2SizeLogged = new Set<string>();
function logV2PayloadSize(viewLabel: string, v2Bytes: number): void {
  if (_v2SizeLogged.has(viewLabel)) return;
  _v2SizeLogged.add(viewLabel);
  // eslint-disable-next-line no-console
  console.info(`[contract-v2] ${viewLabel} v2 wire size: ${v2Bytes.toLocaleString()} bytes`);
}

/**
 * v2 PSDHeatmap query — raw Arrow bytes → worker decode → PSDHeatmapData.
 *
 * Returns the same shape as `extractPSDHeatmap(decoded)` from the v1 path,
 * so `PSDHeatmapView` doesn't need to know which contract supplied it.
 *
 * `placeholderData: keepPreviousData` is the optimistic-render hook —
 * during a refetch, React Query keeps the previous slice's `PSDHeatmapData`
 * in `data`, so the view re-renders with stale-but-visible content rather
 * than blanking. See `docs/design/contract-v2.md` §0.2.
 */
export function useV2PSDHeatmapQuery(
  name: string | null,
  request: TensorSliceRequestDTO | null,
) {
  return useQuery<PSDHeatmapData>({
    queryKey: ["slice-v2", "psd_heatmap", name, request],
    queryFn: async ({ signal }) => {
      const buf = await api.getTensorSliceV2(name!, request!, signal);
      logV2PayloadSize("PSDHeatmap", buf.byteLength);
      const pool = getArrowWorkerPool();
      // Worker consumes the buffer (transferred); never reads from it again.
      return pool.submit<PSDHeatmapData>(buf, "psd_heatmap");
    },
    enabled: Boolean(name && request),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * v2 timeseries / navigator query — both views share the
 * `ColumnarTimeseries` extractor output. The worker dispatches via the
 * `viewType` argument; pass the original request's `view_type` so e.g.
 * `useV2TimeseriesQuery(..., {view_type:"timeseries", ...})` hits the
 * `extractTimeseriesV2` branch.
 *
 * Used for both `timeseries` and `navigator` requests — the worker treats
 * them identically (both produce a `(time, channel|AP×ML)` cube).
 */
export function useV2TimeseriesQuery(
  name: string | null,
  request: TensorSliceRequestDTO | null,
  logLabel = "Timeseries",
) {
  return useQuery<ColumnarTimeseries>({
    queryKey: ["slice-v2", "timeseries", name, request],
    queryFn: async ({ signal }) => {
      const buf = await api.getTensorSliceV2(name!, request!, signal);
      logV2PayloadSize(logLabel, buf.byteLength);
      const pool = getArrowWorkerPool();
      return pool.submit<ColumnarTimeseries>(buf, request!.view_type);
    },
    enabled: Boolean(name && request),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * v2 spectrogram (spectrogram_live or pre-computed spectrogram) — returns
 * the same `Spectrogram` shape v1 `extractSpectrogram` produces. The
 * worker bundles decode + 4-D-cube collapse so the main thread never sees
 * the raw IPC bytes.
 */
export function useV2SpectrogramQuery(
  name: string | null,
  request: TensorSliceRequestDTO | null,
  logLabel = "Spectrogram",
) {
  return useQuery<Spectrogram>({
    queryKey: ["slice-v2", "spectrogram", name, request],
    queryFn: async ({ signal }) => {
      const buf = await api.getTensorSliceV2(name!, request!, signal);
      logV2PayloadSize(logLabel, buf.byteLength);
      const pool = getArrowWorkerPool();
      return pool.submit<Spectrogram>(buf, request!.view_type);
    },
    enabled: Boolean(name && request),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useEventWindowQuery(
  name: string | null,
  selection: SelectionDTO | null,
  halfWindow = 1,
) {
  return useQuery({
    queryKey: ["events-window", name, selection, halfWindow],
    queryFn: () => {
      const params = new URLSearchParams({
        t0: String(Math.max(0, (selection?.time ?? 0) - halfWindow)),
        t1: String((selection?.time ?? 0) + halfWindow),
      });
      if ((selection?.ap ?? null) !== null) params.set("ap", String(selection?.ap ?? 0));
      if ((selection?.ml ?? null) !== null) params.set("ml", String(selection?.ml ?? 0));
      return api.getEventWindow(name!, params);
    },
    enabled: Boolean(name && selection),
  });
}

/**
 * Multi-stream parallel event-window fetch for the detector comparison
 * overlay (G5). Returns a `Map<streamName, EventRecordDTO[]>` keyed by
 * the same `["events-window", name, selection, halfWindow]` shape the
 * single-stream hook uses — so cached results dedupe with the existing
 * `useEventWindowQuery` call site.
 *
 * Streams not yet returned are omitted from the map (the timeseries view
 * just renders fewer ticks until those queries resolve). The hook does
 * NOT wait for all queries to settle before returning data; missing
 * results don't block the rest.
 */
export function useEventWindowQueries(
  names: string[],
  selection: SelectionDTO | null,
  halfWindow = 1,
): Map<string, EventRecordDTO[]> {
  const enabled = Boolean(selection) && names.length > 0;
  const results = useQueries({
    queries: names.map((name) => ({
      queryKey: ["events-window", name, selection, halfWindow],
      queryFn: () => {
        const params = new URLSearchParams({
          t0: String(Math.max(0, (selection?.time ?? 0) - halfWindow)),
          t1: String((selection?.time ?? 0) + halfWindow),
        });
        if ((selection?.ap ?? null) !== null) params.set("ap", String(selection?.ap ?? 0));
        if ((selection?.ml ?? null) !== null) params.set("ml", String(selection?.ml ?? 0));
        return api.getEventWindow(name, params);
      },
      enabled,
    })),
  });
  const out = new Map<string, EventRecordDTO[]>();
  for (let i = 0; i < names.length; i++) {
    const data = results[i]?.data;
    if (data) out.set(names[i], data);
  }
  return out;
}

/**
 * Probe-layout sidecar fetch (G7). Returns `null` when no sidecar is loaded
 * for the active session — that is the documented "feature off" state, not
 * an error, so the spatial map renders unchanged. Cached aggressively
 * (`staleTime: Infinity`) because the layout doesn't mutate across slices.
 */
export function useProbeLayoutQuery() {
  return useQuery<ProbeLayoutDTO | null>({
    queryKey: ["probe-layout"],
    queryFn: api.getProbeLayout,
    staleTime: Infinity,
  });
}

export function useBrainstateMetaQuery() {
  return useQuery<BrainstateMetaDTO>({
    queryKey: ["brainstate-meta"],
    queryFn: api.getBrainstateMeta,
    staleTime: 60_000,
  });
}

export function useBrainstateIntervalsQuery(t0?: number, t1?: number) {
  return useQuery<BrainstateIntervalDTO[]>({
    queryKey: ["brainstate-intervals", t0, t1],
    queryFn: () => api.getBrainstateIntervals(t0, t1),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

// Generic context tracks (categorical bands + scalar traces).
export function useTracksQuery() {
  return useQuery<TrackMetaDTO[]>({
    queryKey: ["tracks"],
    queryFn: api.getTracks,
    staleTime: 60_000,
  });
}

export function useTrackIntervalsQuery(name: string, enabled: boolean, t0?: number, t1?: number) {
  return useQuery<BrainstateIntervalDTO[]>({
    queryKey: ["track-intervals", name, t0, t1],
    queryFn: () => api.getTrackIntervals(name, t0, t1),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTrackSeriesQuery(
  name: string,
  enabled: boolean,
  t0?: number,
  t1?: number,
  maxPoints?: number,
) {
  return useQuery<ScalarSeriesDTO>({
    queryKey: ["track-series", name, t0, t1, maxPoints],
    queryFn: () => api.getTrackSeries(name, t0, t1, maxPoints),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useDAGQuery() {
  return useQuery<WorkspaceDAGDTO>({
    queryKey: ["dag"],
    queryFn: api.getDAG,
    staleTime: 10_000, // 10 seconds — refresh when transforms are added
  });
}

export function useProcessingQuery() {
  return useQuery({
    queryKey: ["processing"],
    queryFn: api.getProcessing,
  });
}

export function useSetProcessing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: ProcessingParamsDTO) => api.setProcessing(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processing"] });
      // Same v1 + v2 invalidation as the mask mutation — processing
      // changes every slice, and "slice" doesn't prefix-match "slice-v2".
      queryClient.invalidateQueries({ queryKey: ["slice"] });
      queryClient.invalidateQueries({ queryKey: ["slice-v2"] });
    },
  });
}

export function useMaskQuery(tensor: string | null) {
  return useQuery<MaskStateDTO>({
    queryKey: ["mask", tensor],
    queryFn: () => api.getMask(tensor!),
    enabled: Boolean(tensor),
  });
}

export function useSetMask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tensor, masked_ids }: { tensor: string; masked_ids: number[] }) =>
      api.setMask(tensor, masked_ids),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mask", variables.tensor] });
      // Mask change invalidates every slice — masked cells become NaN
      // (or are paint-overlaid) on the next fetch. Both wire contracts:
      // `invalidateQueries` prefix-matches, and "slice" does NOT match
      // "slice-v2", so the v2 queries (timeseries / spectrogram_live /
      // psd_heatmap) need their own invalidation or they'd keep showing
      // pre-mask data.
      queryClient.invalidateQueries({ queryKey: ["slice"] });
      queryClient.invalidateQueries({ queryKey: ["slice-v2"] });
    },
  });
}

/**
 * Clamp a time window to known data bounds.
 *
 * Prevents sending out-of-range slice requests that would return 0 samples
 * and cause a 400 ("slice request returned no data") from the server.
 * Falls back to the original window if timeCoord bounds are not available.
 */
export function clampWindow(
  window: [number, number],
  timeCoord: CoordSummary | undefined,
): [number, number] {
  const lo = typeof timeCoord?.min === "number" ? timeCoord.min : -Infinity;
  const hi = typeof timeCoord?.max === "number" ? timeCoord.max : Infinity;
  const clo = Math.max(window[0], lo);
  const chi = Math.min(window[1], hi);
  // If the window is entirely outside the data range, fall back to data bounds.
  return clo < chi ? [clo, chi] : [lo === -Infinity ? window[0] : lo, hi === Infinity ? window[1] : hi];
}

/**
 * Build a slice request for a given view type.
 *
 * This function encodes the per-view pixel budgets (`max_points`) and default
 * downsampling strategies. These defaults are the concrete values behind the
 * `SliceOptions.maxPoints` and `SliceOptions.downsample` fields described in
 * `./dataSource.ts`.
 *
 * Prompt 13 (LOD pipeline) will replace or supplement these hardcoded budgets
 * with values derived from actual viewport pixel width.
 */
export function makeDefaultSliceRequest(
  viewType: string,
  selection: SelectionDTO,
  timeWindow: [number, number] = [Math.max(0, selection.time - 1), selection.time + 1],
): TensorSliceRequestDTO {
  switch (viewType) {
    case "spatial_map":
    case "psd_spatial":
    case "depth_map":
      // depth_map is the linear-probe analogue of spatial_map: an instantaneous
      // per-channel profile at the cursor time. Same narrow window + no time
      // downsample (the server collapses time → (channel,)).
      return {
        view_type: viewType,
        selection,
        time_range: [Math.max(0, selection.time - 0.25), selection.time + 0.25],
        max_points: 400,
        downsample: "none",
      };

    case "psd_average":
      // psd_average on a pre-computed freq-only tensor needs no time_range.
      // The server also accepts time_range when the tensor has a time dim.
      return {
        view_type: viewType,
        selection,
      };

    case "navigator": {
      // Navigator always fetches the full recording at low resolution.
      return {
        view_type: viewType,
        selection,
        time_range: timeWindow,
        max_points: 800,
        downsample: "minmax",
      };
    }

    case "spectrogram":
      return {
        view_type: viewType,
        // Window-bound view: the server slices by time_range and ignores
        // selection.time (verified — state.py reads selection.time only for
        // spatial_map/depth_map). Pin time to the window start so a pure cursor
        // move (e.g. animation playhead, event jump) doesn't re-key this query.
        // The crosshair reads the live cursor from its own prop. See
        // docs/design/propagation-playback.md §5 / ADR-0008.
        selection: { ...selection, time: timeWindow[0] },
        time_range: timeWindow,
        max_points: 200,
        downsample: "minmax",
      };

    default: // timeseries / raster, and anything else purely window-based
      return {
        view_type: viewType,
        // Pin time to the window start — same window-bound invariant as the
        // spectrogram branch above (timeseries/raster data depend on the
        // window, not the cursor). Keeps the key stable under cursor moves.
        selection: { ...selection, time: timeWindow[0] },
        time_range: timeWindow,
        max_points: 2000,
        downsample: "minmax",
      };
  }
}

/**
 * Build a spatial_map slice request for ortho-slicing a 4D tensor.
 *
 * Slices at a narrow time+freq window around the current selection point
 * to produce an AP × ML spatial map at that (time, freq) location.
 */
export function makeOrthoSpatialRequest(
  selection: SelectionDTO,
): TensorSliceRequestDTO {
  const halfT = 0.25; // narrow time window around selection
  return {
    view_type: "spatial_map",
    selection,
    time_range: [Math.max(0, selection.time - halfT), selection.time + halfT],
    max_points: 400,
    downsample: "none",
  };
}

/** Full-range navigator slice. Uses the tensor's time coord bounds if available. */
export function makeNavigatorRequest(
  selection: SelectionDTO,
  timeCoord: CoordSummary | undefined,
): TensorSliceRequestDTO {
  const t0 = typeof timeCoord?.min === "number" ? timeCoord.min : 0;
  const t1 = typeof timeCoord?.max === "number" ? timeCoord.max : selection.time + 10;
  // Navigator shows the FULL session and never reads selection.time on the
  // server side. Pin selection to a constant so the React Query key stays
  // invariant under cursor moves — otherwise every "next event" click
  // re-down-samples 8M samples × 256 ch (5+ s on a long iEEG session).
  // The fetch happens ONCE per (tensor, time-bounds) pair and is reused
  // for the rest of the session.
  return {
    view_type: "navigator",
    selection: { time: 0, freq: 0, ap: 0, ml: 0, channel: null },
    time_range: [t0, t1],
    max_points: 800,
    downsample: "minmax",
  };
}

/**
 * Full-session trajectory slice — the whole behavioral path at once, so the
 * arena is always visible with the cursor dot moving along it. Like the
 * navigator, it ignores selection.time server-side; pin selection to a constant
 * so the React Query key stays invariant under cursor moves (no re-fetch on
 * every scrub).
 */
export function makeTrajectoryRequest(
  selection: SelectionDTO,
  timeCoord: CoordSummary | undefined,
): TensorSliceRequestDTO {
  const t0 = typeof timeCoord?.min === "number" ? timeCoord.min : 0;
  const t1 = typeof timeCoord?.max === "number" ? timeCoord.max : selection.time + 10;
  return {
    view_type: "trajectory",
    selection: { time: 0, freq: 0, ap: 0, ml: 0, channel: null },
    time_range: [t0, t1],
    max_points: 5000,
    downsample: "minmax",
  };
}

/** Default margin around an event when locking the PSD window to it. */
export const PSD_EVENT_LOCK_MARGIN_S = 0.25;

/**
 * Resolve an event record's time span — `[t_start, t_end]` — from a free-form
 * event record dict. Returns `null` when the record doesn't carry a finite
 * event time under `timeCol` (or `t` as a fallback, mirroring `coincidence.ts`).
 *
 * Duration sources, in priority order: `t_end`, `duration_s`, `duration`. If
 * none are present, the returned span has zero width (`[t, t]`) — callers
 * extend with a margin (see `PSD_EVENT_LOCK_MARGIN_S`) so a point event still
 * produces a finite PSD window.
 */
export function eventTimeRange(
  record: Record<string, unknown> | null | undefined,
  timeCol: string,
): [number, number] | null {
  if (!record) return null;
  const rawT = record[timeCol] ?? record["t"];
  const tNum =
    typeof rawT === "number"
      ? rawT
      : typeof rawT === "string"
        ? parseFloat(rawT)
        : NaN;
  if (!Number.isFinite(tNum)) return null;

  const rawTEnd = record["t_end"];
  if (rawTEnd != null) {
    const tEnd =
      typeof rawTEnd === "number"
        ? rawTEnd
        : typeof rawTEnd === "string"
          ? parseFloat(rawTEnd)
          : NaN;
    if (Number.isFinite(tEnd) && tEnd >= tNum) return [tNum, tEnd];
  }

  const rawDur = record["duration_s"] ?? record["duration"];
  if (rawDur != null) {
    const dur =
      typeof rawDur === "number"
        ? rawDur
        : typeof rawDur === "string"
          ? parseFloat(rawDur)
          : NaN;
    if (Number.isFinite(dur) && dur >= 0) return [tNum, tNum + dur];
  }

  return [tNum, tNum];
}

/**
 * PSD live request.
 *
 * Default: window is centered on `selection.time` with width `windowSizeS`.
 *
 * When `lockedTimeRange` is provided (G8 "lock PSD to event"), it overrides
 * the cursor-centred window — the caller (typically `WorkspaceMain`) derives
 * it from the active event record via `eventTimeRange` plus a margin so the
 * PSD heatmap reflects the event's true duration instead of whatever value
 * sat in the PSD-window slider.
 */
export function makePSDLiveRequest(
  selection: SelectionDTO,
  windowSizeS: number,
  timeCoord: CoordSummary | undefined,
  psdParams?: TensorSliceRequestDTO["psd_params"],
  lockedTimeRange?: [number, number] | null,
): TensorSliceRequestDTO {
  const window: [number, number] = lockedTimeRange
    ? lockedTimeRange
    : (() => {
        const safeWindowSizeS =
          Number.isFinite(windowSizeS) && windowSizeS > 0 ? windowSizeS : 1;
        const halfWindow = safeWindowSizeS / 2;
        return [Math.max(0, selection.time - halfWindow), selection.time + halfWindow];
      })();

  return {
    view_type: "psd_live",
    selection,
    time_range: clampWindow(window, timeCoord),
    psd_params: psdParams,
  };
}

/**
 * Spectrogram live request — multitaper spectrogram on the visible window.
 *
 * Mirrors `makeDefaultSliceRequest("timeseries", …)`'s contract exactly:
 * the caller passes an already-clamped `timeWindow` (typically the store's
 * `timeWindow` after `clampWindow` against the tensor's `time` coord, i.e.
 * `safeWindow` in WorkspaceMain). The full visible range is what the
 * spectrogram heatmap needs to show frequency-vs-time evolution; centering
 * on the cursor (psd_live's pattern) collapses the time axis to ~1 segment
 * and produces a blank-looking render.
 *
 * No `max_points` is set — the server bounds segment count via the
 * mtm_spectrogram nperseg/noverlap pair.
 *
 * See docs/log/issue/issue-arash-20260508-142724-956601.md.
 */
export function makeSpectrogramLiveRequest(
  selection: SelectionDTO,
  timeWindow: [number, number],
  params?: TensorSliceRequestDTO["spectrogram_live_params"],
): TensorSliceRequestDTO {
  return {
    view_type: "spectrogram_live",
    // Window-bound: pin time to the window start so a pure cursor move doesn't
    // re-key this query (same invariant as makeDefaultSliceRequest's spectrogram
    // branch). See docs/design/propagation-playback.md §5 / ADR-0008.
    selection: { ...selection, time: timeWindow[0] },
    time_range: timeWindow,
    spectrogram_live_params: params,
  };
}

/**
 * Event-average request — builds an event-locked mean/std/median/snr trace.
 *
 * The server stacks (event, ..., lag) epochs from the source tensor and
 * reduces across the event axis. Lag-window defaults to ±1 s; bumping the
 * event cap is the user's responsibility — 200 keeps an interactive
 * round-trip tractable on dense detector streams (35 k events on the audit
 * bundle). The `selection` is irrelevant to the server response (event
 * windows are anchored at event onsets), but a stable sentinel keeps the
 * React Query cache key invariant under cursor moves.
 */
export function makeEventAverageRequest(
  params: EventAverageParamsDTO,
): TensorSliceRequestDTO {
  return {
    view_type: "event_average",
    selection: { time: 0, freq: 0, ap: 0, ml: 0, channel: null },
    event_average_params: params,
  };
}

/**
 * Propagation-movie request — returns N evenly-spaced (AP, ML) frames over
 * the visible window in one round-trip. The frontend preloads the whole
 * cube and plays back via RAF instead of stepping per-frame to the server.
 */
export function makePropagationMovieRequest(
  selection: SelectionDTO,
  timeWindow: [number, number],
  nFrames?: number,
): TensorSliceRequestDTO {
  return {
    view_type: "propagation_movie",
    selection,
    time_range: timeWindow,
    n_frames: nFrames,
  };
}
