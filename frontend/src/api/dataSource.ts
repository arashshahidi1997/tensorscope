/**
 * DataSource — the formal contract between navigation state and tensor rendering.
 *
 * This module names and documents the implicit slice-loading contract that already
 * exists in `queries.ts` and `client.ts`. It does not replace those modules; it
 * provides a typed interface that future LOD and worker integrations (Prompts 13, 14)
 * can depend on.
 *
 * ## Analogy to cogpy / datashader
 *
 * In the old cogpy orthoslicer stack, `rasterize(element, aggregator, width, height)`
 * resolved data → screen pixels at render time. The canvas dimensions (`width`, `height`)
 * acted as the pixel budget — datashader would aggregate data to fit that budget
 * regardless of the underlying array size.
 *
 * In TensorScope's model the server plays the same role:
 *   - `downsample_time_axis` in `server/state.py` aggregates the tensor into
 *     `max_points` samples using min/max envelope (≈ datashader mean) or LTTB.
 *   - `SliceOptions.maxPoints` is the pixel budget for the time axis, expressed
 *     as a point count instead of a canvas width.
 *   - `SliceOptions.downsample` is the aggregation strategy ("minmax" ≈ ds.mean).
 *
 * Prompt 13 (LOD pipeline) will wire `maxPoints` to actual viewport pixel width,
 * completing the screen-resolution coupling that datashader provided automatically.
 *
 * ## Current concrete path
 *
 *   SelectionState (store)
 *     → toSelectionDTO()              [selectionStore.ts]
 *     → makeDefaultSliceRequest()     [queries.ts]
 *     → useSliceQuery(name, request)  [queries.ts]  ← React Query cache + dedup
 *     → api.getTensorSlice()          [client.ts]   ← HTTP POST /tensors/{name}/slice
 *     → apply_slice_request()         [server/state.py] ← window + downsample + project
 *     → TensorSliceDTO (Arrow IPC)
 *     → decodeArrowSlice()            [arrow.ts]
 *     → view renders
 *
 * `createTensorDataSource` wraps the `api.getTensorSlice` step behind this interface
 * so views and tests can depend on the contract without knowing the transport.
 */

import type {
  DownsampleMethod,
  SelectionDTO,
  TensorSliceDTO,
  TensorSliceRequestDTO,
} from "./types";

// ---------------------------------------------------------------------------
// SliceOptions
// ---------------------------------------------------------------------------

/**
 * Bounded slice options that override per-view defaults from
 * `makeDefaultSliceRequest` in `queries.ts`.
 *
 * All fields are optional. Omitted fields use view-type defaults.
 */
export interface SliceOptions {
  /**
   * Explicit time window [t0, t1] in data coordinates (seconds).
   *
   * Omit to use the default window from `SelectionState.timeWindow`.
   */
  timeRange?: [number, number];

  /**
   * Frequency window [f0, f1] in data coordinates (Hz).
   *
   * Only relevant for "spectrogram" and "psd_*" view types.
   */
  freqRange?: [number, number];

  /**
   * Maximum number of time-axis points to return — the "pixel budget" for
   * the time axis.
   *
   * The server downsamples to at most this many points via `downsample_time_axis`
   * (server/state.py). Analogous to the `width` argument in datashader's
   * `rasterize(element, aggregator, width=N)` call — it controls output resolution,
   * not the data window.
   *
   * Current per-view defaults in `makeDefaultSliceRequest` (queries.ts):
   *   - "timeseries"              → 600
   *   - "navigator"               → 300
   *   - "spectrogram"             → 200
   *   - "spatial_map"/"psd_spatial" → 400
   *
   * Prompt 13 (LOD pipeline) will derive this from actual viewport pixel width.
   */
  maxPoints?: number;

  /**
   * Downsampling strategy applied server-side.
   *
   * - "minmax" (default): min/max envelope per bucket — preserves transient peaks,
   *   good for EEG/LFP. Analogous to ds.mean aggregation in the datashader path.
   * - "lttb": Largest-Triangle-Three-Buckets — preserves perceptual waveform shape.
   * - "none": no downsampling — use only for small data or freq/spatial views.
   *
   * Mirrors `DownsampleMethod` in `server/models.py`.
   */
  downsample?: DownsampleMethod;
}

// ---------------------------------------------------------------------------
// DataSource interface
// ---------------------------------------------------------------------------

/**
 * DataSource — one named tensor, accessible as bounded async slices.
 *
 * A view that holds a DataSource can request data windows without knowing
 * anything about HTTP, Arrow IPC, or cache management. The transport and
 * caching strategy are implementation details of the concrete DataSource.
 *
 * ## Contract
 *
 * - `slice()` always returns a Promise — views must be async-aware.
 * - `slice()` never loads the full tensor — it returns only the bounded
 *   window defined by `selection`, `options.timeRange`, and `options.maxPoints`.
 * - The returned `TensorSliceDTO` carries enough metadata (coord summaries,
 *   downsampling info, axis labels) for views to render without secondary requests.
 * - `name` is stable for the session lifetime and doubles as the React Query
 *   cache key prefix: `["slice", name, request]`.
 *
 * ## Relationship to existing code
 *
 * Views that currently call `useSliceQuery(name, makeDefaultSliceRequest(...))`
 * from `queries.ts` already satisfy this contract. The interface makes it
 * explicit so that:
 *   - Prompt 13 can introduce LOD-aware slice factories behind the same interface.
 *   - Prompt 14 can route Arrow decode work through a worker behind the same interface.
 *   - Tests can swap in a stub DataSource without an HTTP server.
 *
 * ## Multi-tensor sessions (deferred)
 *
 * In a multi-tensor session each view will bind to one DataSource by name.
 * The view registry will resolve which DataSource is appropriate for a given
 * view type. This binding is deferred to the multi-tensor prompt.
 */
export interface DataSource {
  /** Tensor name on the server — stable for the session lifetime. */
  readonly name: string;

  /**
   * Request a bounded slice for a specific view type and navigation selection.
   *
   * @param viewType  One of the keys recognized by `_VIEW_REGISTRY` in
   *                  `server/state.py`: "timeseries" | "navigator" |
   *                  "spectrogram" | "psd_average" | "psd_spatial" | "spatial_map".
   * @param selection Current navigation state in wire format (from `toSelectionDTO`).
   * @param options   Optional window and pixel-budget overrides.
   * @returns         `TensorSliceDTO` with Arrow IPC payload and slice metadata.
   */
  slice(
    viewType: string,
    selection: SelectionDTO,
    options?: SliceOptions,
  ): Promise<TensorSliceDTO>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a concrete DataSource backed by an arbitrary fetch function.
 *
 * The `fetchSlice` argument is the transport — pass `api.getTensorSlice` from
 * `client.ts` for production, or a fixture-returning stub in tests.
 *
 * This factory does **not** provide caching. React components that need
 * stale-while-revalidate behavior should use `useSliceQuery` from `queries.ts`
 * directly. This factory is intended for:
 *
 *   - Unit tests: inject a stub without React Query or an HTTP server.
 *   - Future LOD-aware wrappers (Prompt 13) that pre-compute the `maxPoints`
 *     budget from viewport pixel width before calling `fetchSlice`.
 *   - Future worker-backed DataSources (Prompt 14) that route Arrow decode
 *     off the UI thread behind the same interface.
 *
 * @example
 * ```ts
 * // Production
 * const ds = createTensorDataSource("signal", api.getTensorSlice);
 * const slice = await ds.slice("timeseries", selection, { maxPoints: 600 });
 *
 * // Test stub
 * const stub = createTensorDataSource("signal", async () => fixtureSlice);
 * ```
 */
export function createTensorDataSource(
  name: string,
  fetchSlice: (name: string, req: TensorSliceRequestDTO) => Promise<TensorSliceDTO>,
): DataSource {
  return {
    name,

    slice(
      viewType: string,
      selection: SelectionDTO,
      options: SliceOptions = {},
    ): Promise<TensorSliceDTO> {
      const req: TensorSliceRequestDTO = {
        view_type: viewType,
        selection,
        ...(options.timeRange !== undefined ? { time_range: options.timeRange } : {}),
        ...(options.freqRange !== undefined ? { freq_range: options.freqRange } : {}),
        ...(options.maxPoints !== undefined ? { max_points: options.maxPoints } : {}),
        downsample: options.downsample ?? "minmax",
      };
      return fetchSlice(name, req);
    },
  };
}
