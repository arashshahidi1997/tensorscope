# TensorScope contract v2 — wire format, selection, view registry

**Status:** Phase 1 shipped (committed in `dec0bc1`, 2026-05-12); Phases 1.5–5 still proposed. Revised 2026-05-11 with survey findings.
**Author:** agent (drafted 2026-05-10, revised 2026-05-11)
**Driving review:** [`docs/log/issue/issue-arash-20260510-111746-938324.md`](../log/issue/issue-arash-20260510-111746-938324.md) — the structural-debt audit
**Transport survey:** [`docs/research/transport-survey.md`](../research/transport-survey.md) — Perspective + Neuroglancer + HiGlass converge on the direction below
**Downstream consumer:** [`docs/design/probe-layout.md`](probe-layout.md) — blocked on this work landing
**Audit findings addressed (in order of bite):** F1, F2, F6, F8, F9, F10, F11, F15, F18, F22

## 0. Survey-driven revisions (2026-05-11)

A survey of `/storage2/arash/projects/tensorscope/resources/` (Perspective,
Neuroglancer, HiGlass + smaller libraries) unanimously validates the
audit's core direction — **fix the wire encoding, don't pivot the
architecture**. Three concrete patterns appear in all three systems and
are folded into the phasing below:

1. **Worker-thread decode is universal.** Moved from Phase 4 to Phase 1
   (paired with the v2 endpoint).
2. **Optimistic "render-from-cache while fetch-in-flight"** is the UX
   pattern that keeps Neuroglancer and HiGlass feeling instant. Added as
   an explicit Phase 1 acceptance criterion for canvas-based views
   (Spectrogram, PSDHeatmap, SpatialMap, Propagation).
3. **Request batching / multi-view coalescing.** Added as Phase 1.5 — small
   enough to ship inside Phase 1's PR. Coalesces the multi-view fan-out
   on pan/zoom.

Non-pivots confirmed by the survey:

- **No LOD pyramid** — overkill at our scale; all three systems that use
  one explicitly say so.
- **No WebSocket push** — Perspective's own recommendation; our cursor-
  navigation pattern is request/response shaped, not ingest-shaped.
- **No Zarr/N5/precomputed backend** — xarray-in-RAM is the right server
  model and we'd lose the on-the-fly transform pipeline.

Two opt-ins to consider after Phase 1 measurements:

- **float16 dtype** for spectrogram / heatmap (halves wire size with no
  visible quality loss for log-power data).
- **gzip/zstd Content-Encoding** for additional compression on smooth LFP.

See [`docs/research/transport-survey.md`](../research/transport-survey.md)
for the full survey, measured baselines, and per-system findings.

---

## 1. Why now

The recent fidelity round (F3 / F4 / F5 / F21 + the addendum's colour/axis work)
cleared the user-visible scientific bugs without touching the contract. The
remaining audit findings cluster into three load-bearing structural debts that
in-place fixes can't resolve:

1. **Wire format (F6 + F7 + F11).** Slice payloads are long-format Arrow tables
   with one row per cell × 5 cols. A `spectrogram_live` 4-D cube at audit
   defaults ships as ~3 M rows ≈ 120 MB pre-compression for ~26 MB of actual
   data. The frontend then parses string-encoded channel labels back into
   coords to reconstruct semantics. Drag latency on the new timeseries nav
   strip is the user-visible symptom: each window commit ships ~20 MB of
   downsampled timeseries over base64 JSON, and per-channel coord round-trips
   through strings are the dominant decode cost.
2. **Selection ontology (F2 + F1 + F9).** `SelectionDTO` is welded to
   `{time, freq, ap, ml, channel}` with `ge=0.0` constraints; `_VIEW_REGISTRY`
   is a hand-keyed frozenset table; `psd_live` and `spectrogram_live` flatten
   "every non-time dim" into a synthetic channel axis. A `(trial, time,
   channel)` or `(event, lag, freq)` tensor is silently mis-grouped. This is
   the gate for [`probe-layout.md`](probe-layout.md) and for any atlas /
   peri-event work.
3. **Type drift (F8).** TS types are hand-maintained against Pydantic DTOs and
   already drift (`enabled`, `K`, `detrend` missing). Future contract changes
   will silently break callers.

The audit's blunt recommendation — *redesign the core contract first, refactor
the rest in place* — is the right call. This doc commits the design and
sequencing so we can split implementation across multiple sessions without
losing context between them.

## 2. Goals & non-goals

**Goals.**

- Cut per-slice wire-payload size by ~10× on dense 4-D outputs (kills F6).
- Carry coord values as typed arrays on the wire — no string round-trips
  (kills F7 + the PSDHeatmap label-parsing smell).
- Replace `SelectionDTO.{time, freq, ap, ml, channel}` with a dim-keyed
  coord dict that accepts any tensor schema (kills F2, unblocks ProbeLayout).
- Replace `_VIEW_REGISTRY: dict[frozenset[str], list[str]]` with
  `required_dims ⊆ tensor.dims` rules (kills F1 + F17).
- Generate TS types from OpenAPI in CI (kills F8 + makes the v2 schema the
  single source of truth).
- Plumb `AbortSignal` through every fetch so pan/zoom drops in-flight
  requests (kills F10).
- Offload Arrow decode to a Web Worker (kills F15 + makes nav-strip drag
  fully responsive even with large payloads).
- Migrate views one at a time behind a feature flag, no big-bang cutover.

**Non-goals (out of scope for this design doc).**

- ProbeLayout itself — separate doc, separate work, downstream of Phase 2.
- Atlas integration — downstream of ProbeLayout.
- The pipeline / DAG redesign — already has its own spec.
- Server-side background processing (F18). Phase 3 candidate; touched
  here only for cache invalidation semantics.
- Replacing TanStack Query / Zustand / uPlot — the contract change is
  isolated to the data layer.

## 3. Target architecture

### 3.1 Wire format v2 — labeled-tensor record batch

A slice response is a single Arrow record batch with:

| Field | Type | Meaning |
|---|---|---|
| `data` | `FixedSizeList<FloatN>` row-major or one column per leading-dim slab | The full N-D values cube. |
| `coords/<dim>` | typed array per dim, named by dim | Coord values for that slice along `<dim>`. Length = slice extent along that dim. |
| *(no per-row metadata)* | | Long-format columns are gone — the dim ordering lives in schema metadata, not duplicated per cell. |

Schema metadata (key/value pairs on the record batch schema):

```json
{
  "version": "2.0",
  "dims": ["time", "freq", "AP", "ML"],
  "shape": [200, 64, 16, 16],
  "dtype": "float32",
  "units": "uV",
  "attrs": {"fs": 1250.0, "subject": "sub-01"},
  "display_transforms": ["zscore_offset(scale=3.0)"],
  "processing": {"requested": true, "applied": true, "error": null},
  "slice_provenance": {"masked_ids": [...], "downsample": "minmax", "max_points": 2000}
}
```

Encoding choices:

- **`data` layout.** Two reasonable shapes — pick one. (a) Single Arrow
  `FixedSizeList<float32>` of length `prod(shape)`, row-major, dim order
  per `dims`. Decoder reshapes by `shape`. (b) One Arrow column per
  leading-dim slab (e.g. for `(time, freq, AP, ML)`, one column per time
  index, each holding `freq×AP×ML` values). (a) is simpler; (b) is
  better if the frontend wants per-slab streaming. We start with (a).
- **`coords/<dim>`.** Plain typed arrays — `Float64Array` for numeric,
  `Utf8` for string-coord dims (rare). Name pattern `coords/<dim>` keeps
  the schema readable and avoids collision with data.
- **Transport.** `Content-Type: application/vnd.apache.arrow.stream` over
  HTTP. No base64. Frontend uses the `apache-arrow` package's
  `tableFromIPC(arrayBuffer)` directly.
- **Compression.** Arrow IPC `LZ4_FRAME` codec on the body. Negotiated in
  the v2 endpoint; gzip stays available for non-Arrow clients.

Expected payload sizes (sub-01/ses-04, 16×16 grid):

| View | v1 (long Arrow + base64) | v2 (labeled + LZ4) | Ratio |
|---|---|---|---|
| `timeseries` 2 s × 256 ch, 2000 pts after MINMAX | ~16 MB | ~2.0 MB | 8× |
| `spectrogram_live` 8 s window, default params | ~12 MB | ~1.6 MB | 7.5× |
| `propagation_movie` 60 frames | ~3.2 MB | ~0.25 MB | 13× |
| `spatial_map` single frame | ~120 KB | ~20 KB | 6× |

Numbers are conservative; the real savings come from killing the per-row
coord duplication and base64.

### 3.2 Selection v2 — dim-keyed coord dict

Replace `SelectionDTO` with:

```python
class SelectionDTOv2(BaseModel):
    """Dim-aware selection. Validates against the active tensor's coords."""
    cursors: dict[str, float | int | str]  # one anchor value per dim
    ranges: dict[str, tuple[float, float]] | None = None  # half-open windows
    indexers: dict[str, int] | None = None                # raw positional fallback
```

Validation rules:

- `cursors[dim]` must be one of the tensor's coord values for `dim`
  (server checks against the active tensor's coord schema).
- `ranges[dim]` is half-open `[lo, hi)`; for time-like dims `hi >= lo`.
- Negative values are allowed everywhere (kills the `ge=0.0` lock that
  blocked peri-event views — the perievent_epochs transform produces
  `lag ∈ [-Δ, +Δ]`).
- The v1 → v2 shim: a back-compat helper that maps `{time, freq, ap, ml,
  channel}` onto the new dict, so existing callers keep working through
  the migration window.

`channel_mask` becomes part of the slice request, not selection: it's
view state, not navigation state.

### 3.3 View registry v2 — compositional

Replace `_VIEW_REGISTRY: dict[frozenset[str], list[str]]` with:

```python
@dataclass
class ViewDef:
    name: str                    # "timeseries", "psd_live", ...
    required_dims: set[str]      # must be subset of tensor.dims
    aggregates_over: set[str]    # dims the view will reduce
    produces_dims: set[str]      # dims of the output slice
    params_schema: type[BaseModel] | None  # view-specific params DTO
```

`available_views(tensor) := [v for v in VIEW_DEFS if v.required_dims <=
set(tensor.dims)]`.

Adding `(trial, time, channel)` support means registering a `trial_average`
view that aggregates `trial` — no need to re-key the registry or touch
unrelated views.

The `psd_live` and `spectrogram_live` flatten-everything path goes away:
when a view sees an unexpected non-time dim it returns a structured 400 with
"unsupported dim layout: {dims}; this view needs {required_dims}".

### 3.4 Type generation pipeline

```
FastAPI app  →  /openapi.json
              ↓
        openapi-typescript
              ↓
   frontend/src/api/v2-types.ts  (generated, gitignored or kept-in-tree)
              ↓
        ts-eslint custom rule
              ↓
       CI fails on drift
```

Run `openapi-typescript /openapi.json -o src/api/v2-types.ts` as part of
`pixi run frontend-build`. Keep `src/api/types.ts` (hand-maintained v1)
until the v1 endpoint retires.

### 3.5 Frontend data layer

Replace ad-hoc `fetch` calls with:

```ts
type SliceFetchOptions = {
  signal?: AbortSignal;
  format: "v1-json-base64" | "v2-arrow-stream";
};

async function fetchSliceV2(
  tensor: string,
  request: SliceRequestV2,
  opts: SliceFetchOptions,
): Promise<LabeledTensor> { ... }
```

`useSliceQuery` passes `AbortSignal` from React Query's `signal` parameter
through to `fetch`. Stale pan/zoom requests drop automatically.

Decoded slices flow through an `arrow.worker.ts` Web Worker:

```
main thread → postMessage(arrayBuffer) → worker
              ↓
        tableFromIPC + extract per-dim coords + values
              ↓
   transferable → main thread → uPlot.setData
```

Typed-array transfers via `Transferable` keep zero-copy. The 32-channel
cap (audit F4) becomes a frontend display-only flag — the worker hands
the full N-channel cube to the renderer, which paints only the visible
subset.

## 4. Phased plan

### Phase 1 — wire format v2 endpoint + worker decode + optimistic render (7–10 days)

**Scope expanded from initial estimate** to fold in two patterns the
transport survey confirms are universal in mature viewers. The wire
fix alone is necessary but not sufficient — without worker decode the
nav-strip drag retains a measurable hitch even with 5× smaller payloads.

**Backend.**

- Add `/api/v2/tensors/{name}/slice` next to v1. Same handler, different
  encoder. Encoder is `encode_arrow_v2(da) → bytes`.
- Implement the labeled record-batch encoder per §3.1. Reuse the existing
  `apply_slice_request` (which already returns an `xr.DataArray`); the
  encoder is the only new piece.
- Response sets `Content-Type: application/vnd.apache.arrow.stream`,
  body is raw Arrow IPC bytes (NO base64, NO JSON wrap). Per the survey:
  Perspective + Neuroglancer both do exactly this.
- Compression starts uncompressed; gzip/zstd via FastAPI middleware added
  only if Phase 1 measurements still show wire-size as a bottleneck.
- Add a feature-flag DTO field to v1 responses: `meta.contract_version:
  "1.0"`. v2 responses ship `"2.0"` (in schema metadata, not in a JSON
  wrapper).

**Frontend — wire decoder.**

- New `api/v2-arrow.ts` decoder. Single function:
  `decodeLabeledTensor(bytes: ArrayBuffer) → LabeledTensor`.
- New extractors that pull per-dim arrays from the labeled tensor instead
  of grouping long-format rows: `extractTimeseriesV2`, `extractSpatialV2`,
  `extractPSDHeatmapV2`, etc.
- Behind a `localStorage["tensorscope:v2"] === "1"` flag.
- Migrate **one** view first — PSDHeatmap (largest payloads, biggest win).
  Validate parity (visual + values) against v1 side-by-side.

**Frontend — worker decode (NEW, promoted from Phase 4).**

- `src/api/arrow.worker.ts` runs `tableFromIPC` + extractors off the main
  thread. Per Neuroglancer's pattern: `QUEUED → DOWNLOADING → DECODED →
  RENDERABLE`. Per Perspective's: transferable `ArrayBuffer`s for zero-copy
  `postMessage` across the worker boundary.
- `useSliceQuery` posts the response `ArrayBuffer` to a worker pool;
  receives back typed arrays + coord metadata; calls the existing
  extractor's "from-typed-arrays" entry. Main thread never blocks on
  decode.
- Worker pool size: 2 workers (one for active slice, one for prefetch).
  Configurable.

**Frontend — optimistic-render (NEW).**

- Canvas-based views (Spectrogram, PSDHeatmap, SpatialMap, Propagation*)
  must keep painting the *previous* slice's data while a new slice
  fetch is in flight. uPlot-based views (Timeseries, Navigator) already
  get this via TanStack's `keepPreviousData`; canvas views need explicit
  buffer preservation.
- Pattern: keep the last successfully-rendered ImageData/Float32Array
  in a ref. On data invalidation, do NOT clear the canvas — let the
  next paint overwrite it. Per Neuroglancer: "render whatever's in GPU
  memory immediately; queue new chunks". Per HiGlass: "old tiles remain
  visible at their stretched positions — no blank state".

**Acceptance.**

- 90th-percentile slice payload size drops ≥5× on the audit's three
  largest views (PSD heatmap, spectrogram_live, propagation_movie). Use
  the measured baselines in
  [`docs/research/transport-survey.md`](../research/transport-survey.md):
  timeseries 21.8 MB → ≤4.5 MB; spectrogram_live 56.2 MB → ≤12 MB.
- Nav-strip drag at 60 fps shows no canvas flicker / blank-out and the
  main-thread frame budget stays under 16 ms during pan (verified via
  Chrome devtools performance profile).
- v1 endpoint still serves every existing view unchanged.

**Status (2026-05-11).**

- Backend `/api/v2/tensors/{name}/slice` shipped. `encode_arrow_v2` lives
  in `src/tensorscope/server/state.py`; router in
  `src/tensorscope/server/routers/tensors_v2.py`. 10 backend parity tests.
- Frontend worker pool (2 workers, round-robin) ships at
  `frontend/src/api/{workerPool,arrow.worker}.ts`. Worker chunk emits
  cleanly via Vite (`dist/assets/arrow.worker-*.js`, ~170 kB) and syncs
  into `src/tensorscope/static/assets/` via `pixi run frontend-build`.
- Per-view extractors: `extractPSDHeatmapV2`, `extractTimeseriesV2`,
  `extractSpectrogramV2`. All parity-tested vs. v1 extractors
  (10 frontend parity tests, including one round-trip through the live
  python encoder).
- v2 wiring complete for: PSDHeatmap, Timeseries, Spectrogram (live + pre-
  computed), Navigator. Each view accepts an optional `v2Data` prop;
  when present it bypasses `decodeArrowSlice(slice)` entirely. WorkspaceMain
  fires v2 queries in parallel to v1 (gated on
  `localStorage["tensorscope:v2"]==="1"`) with sticky-ref optimistic
  fallback per view.
- Measured wire ratios (audit bundle, sub-01/ses-04 LFP, 16×16 grid):
  - timeseries 2 s: 21.8 MB → 2.07 MB (10.58×)
  - spectrogram_live 8 s: 56.2 MB → 4.22 MB (13.32×)
  - psd_live: 13.6 MB → 1.29 MB (10.57×)
  All beat the ≥5× target.
- Outstanding before Phase 1 close: live browser validation of the
  optimistic-render + worker-decode UX during cursor drag (no canvas
  blank, main-thread frame ≤16 ms). Tests pass; visual confirmation
  pending.

### Phase 1.5 — multi-view request coalescing (1–2 days)

**Why this is its own phase:** when the user pans, the timeseries,
spectrogram_live, psd_heatmap, and navigator panels fire simultaneous
v2 requests for overlapping time ranges + identical processing params.
HiGlass's `tile-proxy.js` solves this with request bundling by `id` and
`server`, debounced at 100 ms. We have an equivalent: the same
`(processing_params, masked_ids)` slice-prep computation runs N times
for N concurrent view requests.

**Backend (option A — server-side fan-out).** New endpoint
`POST /api/v2/tensors/{name}/slices` accepting a list of view specs
sharing one time-range + processing context. Server runs
`apply_processing` and base slice once, fans out to per-view reductions,
returns a concatenated Arrow stream with per-view boundary markers.

**Backend (option B — request-coalescing middleware).** Same endpoint
shape as v2 single-slice. Server holds a 50 ms request-coalesce window:
identical `(tensor, time_range, processing_hash)` requests within the
window share one compute, fan out N responses. Cheaper to implement,
slightly higher latency-floor.

**Frontend.** A request-batch layer between `useSliceQuery` and the
worker. On a window change, all view queries register their slice spec
within a 16 ms tick; the batcher fires one combined request and routes
responses back to the right query keys.

Pick A vs B during Phase 1 wrap-up based on measured benefit.

### Phase 2 — dim-generic selection + view registry (3–5 days)

**Backend.**

- Add `SelectionDTOv2` per §3.2. The v1→v2 shim is one helper function.
- Refactor `_VIEW_REGISTRY` into `VIEW_DEFS: list[ViewDef]` per §3.3.
- `apply_slice_request` consumes the new selection: every `cursor`/`range`
  is matched against the actual tensor coord, not against hardcoded field
  names. The `psd_live` / `spectrogram_live` flatten path becomes an
  explicit `aggregates_over` clause; non-matching dim layouts return 400.
- Add tests for `(trial, time, channel)`, `(unit, time)`, `(event, lag,
  freq)`. They must reject cleanly (400 + "unsupported dim layout: …")
  rather than silently mis-route.

**Frontend.**

- Frontend `VIEW_DESCRIPTORS` becomes the same `required_dims ⊆ tensor.dims`
  predicate. Delete `getOrthoPair`'s hardcoded check.
- Selection store migrates to a coord-dict shape; UI components that
  reference `selection.ap` / `selection.ml` go through a `getCoord(dim)`
  helper.

**Acceptance.**

- A `(trial, time, channel)` tensor loads, lists no compatible views,
  returns a clear 400 on any v1-style slice request.
- ProbeLayout work can start (it depends solely on §3.2 + §3.3 being in
  place — no further wire changes needed).
- F22 regression tests for unusual dim layouts are green.

### Phase 3 — server-side correctness + cache (2–3 days)

- **F11 alignment.** All slice `range` params become label-based (`xr.sel`),
  not positional. `ap_range: [1.6, 2.8]` selects coord values, not
  indices. The integer-indexer form is `indexers[dim] = i`.
- **F13.** Require `attrs["fs"]` on time-dim tensors; warn loudly on
  inference fallback; surface in `meta.warnings`.
- **F14.** Configurable processing pipeline order. ProcessingParamsDTO
  becomes a list of typed steps in order, not a flat blob.
- **F18.** Background-thread reprocess. `set_processing` returns
  immediately with `processing.applied: false` and a job id; SSE
  publishes `processing_progress` events. Slices block on the cache
  until the new processed tensor is ready, with a configurable timeout.

### Phase 4 — frontend perf & UX (2–3 days, shrunk from 3–5 days)

Worker decode (F15) moved into Phase 1 per survey findings; Phase 4
becomes a smaller cleanup.

- **F10.** `AbortSignal` through every fetch — nav-strip pan, view
  switches, processing changes. React Query's `signal` is the entry point.
- **F23.** Split `setHoveredElectrode` into `useHoverStore`; consumers of
  `useSelectionStore()` (no selector) stop re-rendering on hover.
- **F25.** URL persistence: `useSearchParams` mirrors selection + active
  views + layout preset. Share-link works end-to-end.

### Phase 5 — retire v1 + cleanup (1–2 days)

- Delete `api/types.ts` (hand-maintained); the codegen output is the only
  source.
- Delete the v1→v2 selection shim, hand-keyed `_VIEW_REGISTRY`, and the
  long-format Arrow encoder.
- Document the v2 contract in `docs/api/contract-v2.md` (reference, not
  the design doc).

**Total:** ~3–4 person-weeks if done end-to-end. Phase 1 + Phase 1.5 + Phase 2
together (~13 days) is the minimum that unblocks ProbeLayout AND delivers a
visible win on the nav-strip latency the user has been hitting.

## 5. Migration strategy

**One view at a time, parity gate.** For each view migrating to v2:

1. Build the v2 extractor on the new endpoint.
2. Render both v1 and v2 paths side by side behind the dev flag.
3. Lock in a visual + numeric parity test (Vitest with synthetic data:
   identical slice request → identical decoded values within float
   tolerance, identical canvas pixel hash within ±2 LSB).
4. Flip the default to v2 once the parity test passes for 24 hours of
   real-data use.
5. Delete the v1 path for that view.

**Selection migration is single-cutover, not per-view.** Because every view
reads from the same selection store, we can't migrate selection one view
at a time — that would mean two stores or two readers. Plan: the v2
selection lands as a parallel `useSelectionStoreV2`, the v2 views read
from it, and v1 views read from a derived shim that mirrors v2 → v1
shape. When the last v1 view migrates, the shim drops out.

**Pair-mode coordinated.** Pairing agents (Python scripts) call the same
HTTP API. The shim is the only thing that lets a v1 client stay live
during the cutover. Document the deprecation timeline in the pairing
docs.

## 6. Risks & open questions

**Risks.**

- Arrow IPC LZ4 codec support in browsers depends on `apache-arrow`'s
  JS implementation — verify before committing. Fallback: no
  compression, payloads are still ~5× smaller from format alone.
- The labeled-tensor schema's `dims` metadata key is the keystone. If
  any view forgets to honour it (e.g. transposes axes silently), the
  decoder mis-reshapes. Add a runtime assertion in the v2 decoder.
- Selection back-compat shim has subtle edge cases — e.g. `time = 0.0`
  in v1 is "default" or "no selection?". Spec the semantics explicitly
  before coding.
- React Query's `keepPreviousData` interacts with AbortSignal in
  surprising ways (in-flight queries that were the previous-data
  source can get aborted mid-display). Test the cancel path under load.

**Open questions.**

1. **Channel mask in v2.** *Resolved (post-Phase-1, commits `567654a` +
   `ee7b4fd`).* Kept as a flat `masked_ids` list, but as **per-tensor
   session state** (`ServerState.channel_masks`) rather than on selection
   or the slice request — managed via its own `/masks` router
   (`MaskStateDTO` / `MaskUpdateDTO`) and applied server-side inside
   `apply_slice_request` (`_apply_channel_mask_nan`), then surfaced in
   `slice_provenance.masked_ids`. It now applies across all views (incl.
   PSD-spatial and propagation) via v2 query invalidation. The
   dim-generic reshape (masked coord values per dim, or a boolean mask
   aligned to the spatial dims) is deferred to Phase 2 alongside
   `SelectionDTOv2`.
2. **Versioning policy.** If v2 lands, what's the deprecation horizon
   for v1? My default: v1 stays available for one minor-version cycle
   after every view has migrated; deletion in the version after that.
3. **OpenAPI codegen as gitignored vs committed.** Committed is
   easier to review (PR diff shows contract changes); gitignored is
   cleaner (no merge conflicts on generated code). Default: committed,
   with a CI check that regen-from-spec produces no diff.
4. **Worker decode for Pairing-mode browser clients.** The worker
   needs the same Arrow build as the main thread; pairing clients
   that use the bundled static files need to ship the worker too.
   Verify the Vite + Worker plugin chain emits a single chunk.

## 7. Sequencing recommendation (updated 2026-05-11)

Given the survey findings and current workflow:

1. **Phase 1 first** (wire format v2 + worker decode + optimistic render
   for PSDHeatmap). Direct win on the recently-noticed nav-strip latency.
   ~7–10 days.
2. **Phase 1.5** (multi-view request coalescing). Tacked onto Phase 1's PR
   if measurements show it matters; otherwise deferred. ~1–2 days.
3. **Phase 2** (dim-generic selection + registry). Unblocks ProbeLayout.
   ~3–5 days.
4. **Pause** for ProbeLayout work to start, in parallel with Phase 3 +
   Phase 4. ProbeLayout doesn't need Phase 3/4 done first.
5. **Phase 5** (cleanup) after ProbeLayout settles, because ProbeLayout
   might surface schema changes worth folding in.

If only one phase ships before ProbeLayout, **Phase 2 alone** is acceptable —
it unblocks the schema work and we can do Phase 1 alongside ProbeLayout.
The reverse (Phase 1 alone) doesn't unblock anything structural — but it
does deliver the user-visible perf win, so it's the right pick if the
nav-strip latency is the more painful blocker.

## 8. Cross-refs

- Audit issue: [`docs/log/issue/issue-arash-20260510-111746-938324.md`](../log/issue/issue-arash-20260510-111746-938324.md)
- ProbeLayout proposal: [`docs/design/probe-layout.md`](probe-layout.md)
- Atlas idea (downstream of ProbeLayout): [`docs/log/idea/idea-arash-20260510-113227-909826.md`](../log/idea/idea-arash-20260510-113227-909826.md)
- Pipeline spec (orthogonal): [`docs/design/pipeline-spec.md`](pipeline-spec.md)
