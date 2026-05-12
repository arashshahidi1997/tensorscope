# Transport-architecture survey — what mature browser viewers actually do

**Status:** survey complete; informs revision of [`docs/design/contract-v2.md`](../design/contract-v2.md)
**Author:** agent (drafted 2026-05-11)
**Scope:** TensorScope's wire-format / transport / decode refactor decisions
**Corpus:** `/storage2/arash/projects/tensorscope/resources/` (curated reference library)

## TL;DR

Three mature systems (Perspective, Neuroglancer, HiGlass) plus the uPlot/deck.gl
rendering libraries we already touch all converge on the same answer:

- **Keep slice-on-demand REST. Don't pivot to LOD pyramid or WebSocket push.** Our
  data fits in RAM (~768 MB), the user is a single browser session, windows are
  short. The architectures designed for terabyte volumes / streaming feeds /
  Hi-C matrices add complexity our scale doesn't justify.
- **Fix the wire encoding** the way the audit recommended (binary Arrow IPC over
  HTTP, no base64), AND add three concrete UX patterns that all three systems
  use to keep panning feel instant.

The three patterns to steal are (1) **render-from-cache while fetch-in-flight**,
(2) **Worker-thread decode**, and (3) **request batching / deduplication
across the multi-view fan-out**. None require architectural pivots.

## Measured baseline (sub-01/ses-04)

Real wire sizes from the live audit bundle on `127.0.0.1:8000`:

| Slice | Wire (HTTP body) | Arrow IPC body | Notes |
|---|---:|---:|---|
| `timeseries` 2 s window, 2000 pts MINMAX | **21.8 MB** | 16.4 MB | base64 + JSON wrap adds 33% |
| `spectrogram_live` 8 s window, default params | **56.2 MB** | 42.2 MB | dominant interactive cost |
| `spatial_map` single frame | 9.5 KB | 6.6 KB | small, unaffected |

These are worse than the audit's projections. The v2 wire-format fix is more
valuable than the design doc estimated.

## Three surveys

Each survey was conducted by a Sonnet sub-agent reading the project's own
docs and architecture-relevant source. Full agent transcripts are in
`/tmp/claude-2090/.../tasks/`. Distilled findings below.

### Perspective — FINOS analytics + WASM + WebSocket + Arrow

**What it does that's relevant:** Server-side C++ engine (compiled to WASM
or native Rust/Python) holds the full dataset in memory; clients connect
over WebSocket; payloads are bare Arrow IPC bytes inside protobuf-framed
messages.

| Aspect | What Perspective does |
|---|---|
| Transport | WebSocket bidirectional; protobuf `Request`/`Response` frames carrying raw Arrow IPC payloads inside `bytes` fields. No HTTP fallback. |
| Wire format | `application/octet-stream` Arrow IPC. **No base64 anywhere.** Coord metadata is Arrow schema-level column names. |
| Server engine | Full dataset in memory in C++ engine. Optional `limit` for rolling window. Virtual-server adapter (DuckDB / ClickHouse) translates each `to_arrow` request to SQL when the dataset doesn't fit. |
| Client decode | Browser WASM engine runs in a dedicated Web Worker. Responses arrive as `ArrayBuffer` via `ws.binaryType = "arraybuffer"`. Transferable `ArrayBuffer`s for zero-copy postMessage. |
| Streaming model | **Server-pushes, client-subscribes.** `view.on_update(callback, {mode: "row"})` delivers Arrow IPC deltas without client polling. Server has a `poll()` gate for debounce. |
| Largest demo | 1,000,000 rows in tabular benchmark; rolling 250 k-row ring buffer in streaming example. |

**What we should steal — Perspective's verdict (verbatim):**

> *Keep slice-on-demand HTTP. Change the wire encoding in one place: remove
> base64, send a raw binary response (`Content-Type:
> application/vnd.apache.arrow.stream`). That gives you most of Perspective's
> wire efficiency with zero architecture change. WebSocket over HTTP is
> optional and would only matter if you add a streaming/animation mode later.*

The Perspective `on_update` push model is for live ingest (market data, event
streams). TensorScope's user-driven cursor navigation against a static
recording is fundamentally different — keep REST + slice-on-demand.

### Neuroglancer — Google's billion-voxel viewer

**What it does that's relevant:** Multi-resolution chunk pyramid over
Zarr / N5 / Google's `precomputed` format; HTTP range requests; full WebGL
2 GPU rendering pipeline.

| Aspect | What Neuroglancer does |
|---|---|
| Data layout | Strict mipmap pyramid; per-scale `chunk_sizes` (typically 64³). Two-level sharded index with Morton-coded uint64 keys for efficient HTTP range fetching. |
| Wire format | Per-chunk raw binary (`raw`/`jpeg`/`compressed_segmentation` for precomputed; blosc/gzip/zstd for Zarr/N5). **No JSON wrapper, no base64.** |
| Transport | Standard HTTP GET (unsharded) or HTTP **Range** requests (sharded). Protocols: `http://`, `https://`, `gs://`, `s3://`. ngauth sidecar for auth. |
| Client decode | All download + decode in a WebWorker. Chunks travel `QUEUED → DOWNLOADING → SYSTEM_MEMORY_WORKER → SYSTEM_MEMORY → GPU_MEMORY`. Only `GPU_MEMORY` is renderable. LRU eviction with `VISIBLE`/`PREFETCH`/`RECENT` priority. |
| Render | WebGL 2 GLSL shaders; each chunk is a 2-D texture (3-D data packed into 2-D due to WebGL texture-dim limits). |
| N-D handling | Arbitrary-rank named coord spaces. Dim suffixes: `'` for local-per-layer, `^` for channel-axis, none for global/display. Time is just another dim; no "time-series" concept. |
| Pan/zoom UX | Render whatever's in GPU memory **immediately**. Worker queues new chunks with `VISIBLE` priority. Missing chunks show black, no fade-in. 30 ms `chunkUpdateDeadline` to avoid frame drops. |

**What we should steal — Neuroglancer's verdict (verbatim):**

> *Do not pivot to a full chunked-LOD model. TensorScope's recordings fit
> entirely in server RAM, and your dominant bottleneck is the 150–250 ms
> round-trip latency on window-commit, not data volume. A LOD pyramid would
> require pre-computing multiple downsampled timeseries / spectrogram
> resolutions server-side, adding a zarr/n5 chunking layer, and rewriting
> the client to do chunk-based viewport math — considerable complexity for
> a use case that is far simpler.*
>
> *Steal three specific ideas: raw binary wire format, WebWorker decode,
> and a "render what's cached, fetch the rest" viewport model.*

Neuroglancer's named-dim coord spaces (`x`, `y`, `z`, `time`, `x'`, `c^`)
are also conceptually aligned with v2's dim-keyed selection DTO. Good
validation that our §3.2 direction is sound.

### HiGlass — multiscale 1D/2D genomic viewer

**What it does that's relevant:** Tile pyramid for genomic matrices and
1D tracks; PIXI.js WebGL rendering; per-track-type density modes.

| Aspect | What HiGlass does |
|---|---|
| Tile addressing | `tilesetUid.zoomLevel.tilePos...` (1D: `uid.z.x`; 2D: `uid.z.x.y`). Zoom level computed from D3 scale ratio. Two schemas: binary-powers ("legacy") or explicit sorted-resolutions (cooler/mcool). |
| Wire format | **JSON wrapping base64-encoded dense binary array** (the pattern we'd be moving *away from*). Schema: `{dense: "<base64>", dtype: "float16"\|"float32", zoomLevel, tilePos, min_value, max_value}`. Sparse tracks (gene annotations) use a different feature-list JSON format. |
| Tile server | `higlass-server` (Django) computes tiles on-demand from `.cool` / `.mcool` / `.bigwig` (formats with built-in multi-resolution). No persistent tile cache. |
| Client decode | Float32Array constructed synchronously on main thread (the "worker" name in the code is a relic of an earlier design). |
| Render | PIXI.js / WebGL Sprites. Heatmap tiles uploaded as RGBA textures via a LUT. 1D line tracks use Pixi `Graphics.lineTo`. |
| Pan/zoom UX | **Optimistic GPU transform.** D3 zoom updates `_xScale` immediately; Pixi container is translated/scaled (`pMobile.position.x = tx; scale.x = k`) synchronously. New tiles load in the background via 100 ms debounced fetch. Old tiles remain visible at their stretched positions — no blank state. Request bundling by `id`/`server` deduplicates concurrent requests. |
| Multiple tracks | All dense-array tracks share one wire shape (`{dense, dtype, ...}`); the *interpretation* differs (1D bigwig vs 2D Hi-C vs 2D multivec). Feature/annotation tracks have a separate format. |

**What we should steal — HiGlass's verdict (verbatim):**

> *Do not pivot to a full HiGlass tile-pyramid model. The pyramid is justified
> when data is genomic-scale (~3B positions) and the format already has LOD
> baked in (mcool, bigwig). TensorScope's timeseries is structurally
> different: short windows, RAM-resident data. Pyramid construction adds
> complexity with little payoff.*
>
> *Steal: optimistic pan via GPU transform; request batching + dedup; float16
> encoding for spectrogram / heatmap.*

### Other libraries (quick scan)

- **deck.gl**: WebGL/WebGPU layer framework. Has `tile-layer` / `tileset-2d`
  for the standard slippy-map tile pattern. Not transport-relevant unless
  we switch from Canvas2D to WebGL rendering — and uPlot's own perf budget
  (100 k pts/ms) is way above what our 2000-point downsampled views need,
  so the rendering layer is not the bottleneck.
- **uPlot**: what we use. Confirms Canvas2D is fast enough at our scale.
  Author explicitly says "switch to WebGL only if your data exceeds 100 k
  in-view points" — we're at 2000.
- **visx / observable-plot / nivo**: declarative grammars for small-to-medium
  data. Not at our scale.
- **jupyterlab / jupyterlite**: relevant only for the future kernel-side
  pairing model; not for the data wire.

## What converges, what diverges

| Pattern | Perspective | Neuroglancer | HiGlass | Recommendation for TensorScope |
|---|:---:|:---:|:---:|---|
| Drop base64 + JSON wrap; raw binary on the wire | ✓ | ✓ | (their model still does it; they admit it's suboptimal) | **Adopt.** Direct ROI: 33% on every payload. |
| WebWorker decode | ✓ | ✓ | (used to; reverted) | **Adopt.** Universal recommendation. Promote from Phase 4 to Phase 1. |
| Render-from-cache while fetch-in-flight | (push model handles it) | ✓ | ✓ | **Adopt.** Fixes nav-strip latency without changing the wire. |
| Request batching / dedup across views | — | (chunk-level cache does it) | ✓ | **Adopt** as Phase 1 sibling. Coalesces the multi-view fan-out. |
| float16 dtype for spectrogram / heatmap | — | (jpeg for uint8 images) | ✓ | **Adopt** as opt-in per-view. |
| HTTP range requests | — | ✓ | — | **Skip** — designed for sharded multi-GB files we don't have. |
| LOD / tile pyramid | — | ✓ | ✓ | **Skip** — overkill at our scale (per all three). |
| WebSocket push / streaming updates | ✓ | — | — | **Skip** — for live ingest, not user-driven cursor navigation. |
| Multi-resolution server format (Zarr/N5/cooler) | — | ✓ | ✓ | **Skip** — we hold xarray in RAM. |

## Implications for `contract-v2.md`

The audit's core direction — **fix the wire encoding, don't pivot the
architecture** — is unanimously validated. The v2 design (§3.1 labeled
Arrow record batch with per-dim coord arrays + schema metadata) maps
exactly onto what Perspective + Neuroglancer ship.

Three concrete revisions worth folding into the design doc:

1. **Promote Worker decode from Phase 4 to Phase 1.** It's the universal
   recommendation; without it, even the v2 wire fix leaves decode on the
   main thread and the nav-strip drag retains a measurable hitch. Should
   land in the same PR as the v2 endpoint.
2. **Add an "optimistic-render" UX layer to Phase 1.** Specifically: when
   a slice fetch is in flight, the view keeps painting the *previous*
   slice's data (we already do this for uPlot via TanStack's
   `keepPreviousData`, but the canvas-based views — Spectrogram, PSD
   Heatmap, Spatial Map — need to explicitly preserve their last
   rendered buffer until the new slice arrives). This is what
   Neuroglancer calls "render whatever's in GPU memory immediately".
3. **Add Phase 1.5: request batching / multi-view coalescing.** When the
   user pans, four views fire simultaneous requests for overlapping
   time-ranges + identical processing params. A client-side batch layer
   (or a `/api/v2/tensors/{name}/slices` plural endpoint that takes a
   list of view specs) would let the server do the windowed compute
   once and fan-out N Arrow batches. Sized at ~1-2 days; large enough
   to call out, small enough to ship inside Phase 1.

Two ideas worth considering but **not committing to** yet:

- **float16 dtype** for spectrogram / heatmap payloads. Halves wire size
  with no visible quality loss for log-power data. Opt-in per view via a
  request DTO field. Land if Phase 1 measurements show wire size is still
  a bottleneck after the v1 → v2 cutover.
- **gzip/zstd Content-Encoding** for additional compression. Neuroglancer
  emphasizes this; smooth LFP compresses well. Easy to add (FastAPI middleware);
  defer until measurement justifies.

## Non-pivots (call them out so we don't re-litigate)

- **No LOD pyramid.** All three surveys converge: our scale doesn't justify
  it. ProbeLayout work may revisit if probe-of-probes data ever lands; not
  today.
- **No WebSocket push.** Cursor navigation is request/response shaped, not
  ingest-shaped. WebSockets are worth revisiting only if we add a live
  multi-pair-agent broadcast story (mass-selection sync across multiple
  paired clients). Not on the current roadmap.
- **No Zarr/N5/precomputed backend.** xarray-in-RAM is the right server
  model for our dataset size and we'd lose the on-the-fly transform
  pipeline (CMR / notch / spatial median / PSD live) if we pre-compute
  tiles.

## Cross-refs

- Design doc to revise: [`docs/design/contract-v2.md`](../design/contract-v2.md)
- Audit issue: [`docs/log/issue/issue-arash-20260510-111746-938324.md`](../log/issue/issue-arash-20260510-111746-938324.md)
- Currently-paused refactor agent (handle `e5c427462f59`) — needs new
  directives reflecting these findings before resuming.
