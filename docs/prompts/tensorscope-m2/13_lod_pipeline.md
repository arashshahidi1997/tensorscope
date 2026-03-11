# Prompt 13: LOD Pipeline

Read first:

- [00_context.md](./00_context.md)
- [12_data_source.md](./12_data_source.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce multiresolution pyramids for time-series data.

Scope:

- decimation levels
- LOD switching
- window-based aggregation

Implementation Tasks:

- define the LOD levels needed for overview and detail rendering
- describe how visible window size chooses an LOD level
- define the aggregation contract for decimated windows
- keep the pipeline compatible with async slice requests

Constraints:

- do not bind the design to one renderer
- do not assume GPU acceleration
- keep the first version time-series focused

Acceptance Criteria:

- large recordings can render overview quickly
- LOD switching rules are explicit
- the pipeline can support current `uPlot`-based views

Deliverables:

- prompt-ready LOD design
- clear acceptance targets for an implementation pass

## Reference

HiGlass solved the same problem for genomic tiles. Three patterns are directly applicable:

**Three-stage pipeline** (`visibleTiles` / `fetchedTiles` / `tileGraphics` in `TiledPixiTrack.js`): distinguishes what should show, what has been retrieved, and what has been rendered. Combined with a debounced batched request executor (`tile-proxy.js`), this prevents request storms during rapid pan/zoom. Adapt: replace HiGlass's `[zoomLevel, tileX, tileY]` tile IDs with TensorScope's `(timeWindow, LOD level)` slice requests.

**`BackgroundTaskScheduler`** (`utils/background-task-scheduler.js`): a `requestIdleCallback`-based queue with per-track deduplication — when a new render task arrives for the same track, the old one is dropped. Self-contained, no external dependencies. Copy and adapt for per-view render deduplication during fast pan.

**`DenseDataExtrema1D`** (`utils/DenseDataExtrema1D.js`): precomputes subset min/max at construction time so visible-range auto-scaling is O(subsets) rather than O(N). Relevant when client holds raw multichannel buffers and needs live per-channel y-axis scaling during pan.

See [docs/reference-studies/higlass.md §2.1, §2.4, §2.5](../../reference-studies/higlass.md).

Neuroglancer's `ChunkManager` (`src/chunk_manager/base.ts`, `frontend.ts`) adds a complementary model: explicit priority tiers (`VISIBLE`, `PREFETCH`, `RECENT`) and a lifecycle state machine (`QUEUED → DOWNLOADING → SYSTEM_MEMORY`). The key principle is that the frontend always renders whatever it has — it never blocks waiting for a complete response. For TensorScope: React Query's `keepPreviousData` option implements the "always show stale data rather than a blank panel" contract; `AbortController` on the fetch implements cancellation on navigation. Wire these to the `DataSource.slice()` call so in-flight requests for stale windows are cancelled when the user pans.

See [docs/reference-studies/neuroglancer.md §2.4](../../reference-studies/neuroglancer.md).

Observable Plot's transform/initializer split (`src/transforms/basic.js`) clarifies where client-side downsampling belongs in the pipeline:

**Transforms** run before scales are resolved — they operate in abstract data space. **Initializers** run after `createScales()` — they know the canvas pixel width. TensorScope's current server-side downsampling is a transform (it knows the time window, but not the canvas width). Adaptive client-side decimation — "downsample to N samples where N = canvas width in pixels" — is an initializer: it runs after the time scale is resolved and consumes `canvasWidth`. This distinction has a concrete payoff: if the spectrogram canvas is resized, the client can re-bin the cached Arrow data to the new pixel dimensions without a new server request. Implement adaptive decimation as a post-decode step in the LOD pipeline that receives `(arrowBuffer, canvasWidthPx)` rather than baking the sample count into the slice request.

See [docs/reference-studies/observable-plot.md §2.2, R1](../../reference-studies/observable-plot.md).
