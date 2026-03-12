# Prompt 49: Transform Cache

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [48_computation_workers.md](./48_computation_workers.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce caching for derived tensors.

Scope:

- cache keys
- transform parameter hashing via `DerivedTensor.toJSON()`
- reuse of computed tensors
- three-stage lifecycle: scheduled → computed → consumed

Implementation Tasks:

- define cache-key rules: the cache key is `DerivedTensor.toJSON()` (from `41_derived_tensor_model.md`) — no separate hashing needed; the `Trackable` contract makes keys self-describing and human-readable
- specify the three-stage lifecycle matching HiGlass's tile model: `scheduledTransforms` (queued but not yet computed) / `computedTensors` (results available) / `consumedByViews` (actively used); stale results from superseded parameters must be discarded, never written to view state
- describe eviction rules: `VISIBLE` priority tensors are never evicted; `PREFETCH` tensors (adjacent time windows) are evicted under memory pressure; `RECENT` tensors (previously visible, now off-screen) are evicted first
- specify `localStorage` persistence keys (`"tensorscope:transform:{transformId}:{paramHash}"`) for derived tensor metadata so sessions restore without re-computing heavy transforms
- describe how `OptionalUpdate<T>` semantics apply: when only one parameter changes (e.g., frequency band), only that parameter invalidates the cache — unchanged parameters do not cause a cache miss

Constraints:

- repeated transform requests should reuse cached results only when provenance and parameters match
- do not let caching obscure correctness or metadata traceability
- keep the cache contract separate from view logic
- stale results must be discarded when parameters change — never written to canvas or view state regardless of whether the view is currently visible

Acceptance Criteria:

- repeated transform requests reuse cached results
- cache keys are derived from `DerivedTensor.toJSON()` — no ad hoc hashing
- three-stage lifecycle is explicit: scheduled / computed / consumed
- cache behavior preserves provenance and correctness
- stale-result discard is unconditional

Deliverables:

- prompt-ready transform-cache spec
- explicit cache-key, lifecycle, and eviction contract

## Reference

**HiGlass three-stage tile lifecycle** (`TiledPixiTrack.js`): `visibleTiles` / `fetchedTiles` / `tileGraphics` maps directly to M4's transform pipeline. The critical correctness rule from HiGlass: results from in-flight fetches that are no longer visible (parameters changed while the fetch was in progress) must be discarded when they arrive, not written to state. Apply the same rule to transform worker results.

See [docs/reference-studies/higlass.md §2.1](../../reference-studies/higlass.md).

**Perspective `OptionalUpdate<T>`** (`rust/perspective-viewer/src/rust/config/viewer_config.rs`): a three-state enum — `Missing` (field absent = no change), `SetDefault` (null = reset), `Update(T)` (apply value). When only `time_range` changes in a spectrogram request, the `freq_range` and `channel_mask` fields are `Missing` — the cached result for those dimensions remains valid. This is the correct semantic for incremental cache invalidation.

See [docs/reference-studies/perspective.md §2a](../../reference-studies/perspective.md).

**JupyterLab StateDB namespace keys** (`packages/statedb/src/statedb.ts`): use `"tensorscope:transform:{transformId}:{paramHash}"` as localStorage keys for persisting derived tensor metadata across sessions. The `namespace:id` convention allows `list("tensorscope:transform")` to enumerate all cached transform entries without a separate index. Restore derived tensor metadata on session load to enable cache hits without re-running transforms.

See [docs/reference-studies/jupyterlab.md §2.5](../../reference-studies/jupyterlab.md).
