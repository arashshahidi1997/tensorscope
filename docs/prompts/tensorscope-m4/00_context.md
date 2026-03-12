# TensorScope M4 Context

Use this file as the shared context preamble for M4 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m3/README.md](../tensorscope-m3/README.md)

## Relationship to previous milestones

- M1 establishes the architecture spine and shared navigation model.
- M2 adds scalable data access and linked scientific views.
- M3 adds spatial dynamics and propagation views.
- M4 builds on those layers by introducing the explicit transform layer for derived tensors.

## Why analysis transforms must be separated from views

Analysis logic should not be hidden inside rendering components.

M4 moves TensorScope toward:

`tensor -> transform -> derived tensor -> view`

This keeps analysis extensible, reproducible, and reusable across views.

## Derived tensor concept

A derived tensor is a tensor product created from one or more input tensors through an explicit transform.

Typical examples:

- spectrogram
- PSD
- band power
- coherence
- event-aligned signals
- state-space trajectories

## Transform registry concept

Transforms should be registered, discoverable, and explicit about:

- input tensor requirements
- output tensor shape and coordinates
- provenance
- compatibility with downstream views

## Compute pipeline overview

M4 expects a compute pipeline that can:

- schedule heavier transforms outside the main UI loop
- emit derived tensors as first-class outputs
- preserve metadata and provenance
- support later caching and reuse

## Caching and worker-based computation

- heavier transforms should move toward worker-based computation
- repeated requests should eventually reuse cached derived tensors
- caching must preserve correctness and traceability

## Guardrails

- views should consume tensors, not compute them
- shared navigation state remains the coordination mechanism
- transform logic must not become an implicit side effect of view rendering
- worker and cache layers must preserve a correct CPU-first baseline
- M4 does not yet define the full transform DAG inspection UI
- M4 does not yet define pipeline export or workflow generation

## Transform vs. initializer distinction

Observable Plot formalises a distinction that is directly applicable to M4: **transforms** operate in abstract data space and have no knowledge of pixel geometry; **initializers** operate after scales are resolved and may use canvas dimensions. In M4's terms: spectrogram FFT, PSD aggregation, coherence estimation, and event alignment are all transforms — they are correct independent of viewport size. Client-side decimation to match canvas pixel width, or frequency-bin resampling to viewport height, are initializers that belong on the frontend after scale resolution. The diagnostic test: if a computation needs to know canvas pixel width or height, it is an initializer, not a server-side or worker transform. Keep this boundary explicit in transform contracts.

See [docs/reference-studies/observable-plot.md §2.2](../../reference-studies/observable-plot.md).

## Reference studies

[docs/reference-studies/jupyterlab.md](../../reference-studies/jupyterlab.md) contains a JupyterLab frontend analysis (kernel/backend excluded). Two M4-relevant patterns: (1) typed `Token` + plugin activation pattern (`packages/application/src/lab.ts`) — the right model for `TransformRegistry`: transforms declare typed `requires`/`provides` tokens, the registry resolves dependency order before activation, and each registration returns a disposable for clean unregistration (linked from `40_transform_registry.md`); (2) StateDB namespace-prefixed session persistence — debounced auto-save using `"tensorscope:transform:{hash}"` keys enables session restore for long-running analysis workflows (linked from `49_transform_cache.md`).

[docs/reference-studies/jupyterlite.md](../../reference-studies/jupyterlite.md) contains a JupyterLite analysis. One M4-relevant pattern: Comlink worker RPC — `expose(api)` in the worker + `wrap(new Worker(...))` on the main thread provides transparent async/await worker calls without manual `postMessage` wiring; use for M4 compute workers (spectrogram FFT, coherence, PCA) (linked from `48_computation_workers.md`). Streaming intermediate results (e.g., per-channel FFT slices arriving before the full spectrogram completes) use raw `postMessage` with a discriminated property (`_tensorMessage`) alongside Comlink — they coexist cleanly.

[docs/reference-studies/neuroglancer.md](../../reference-studies/neuroglancer.md) contributes two M4-relevant patterns: (1) `ChunkManager` priority tiers — heavy M4 transform jobs should follow the same `VISIBLE > PREFETCH > RECENT` model when queuing compute work (linked from `48_computation_workers.md`); (2) `Trackable` interface — `toJSON()` / `restoreState()` / `reset()` / `changed` signal — is the right contract for derived tensor provenance metadata and transform parameters: every derived tensor should be serializable and restorable without losing traceability (linked from `41_derived_tensor_model.md` and `49_transform_cache.md`).

[docs/reference-studies/perspective.md](../../reference-studies/perspective.md) contains a Perspective analytics tool analysis. Four M4-relevant patterns: (1) `save()`/`restore()` per plugin — each view exposes a serializable state token; stub these in M2/M3 views and fill in for M4 session continuity; (2) side-effect plugin registration (`extensions.ts` `registerPlugin()`) — import a transform module and it registers itself; no manual registry editing required; directly applicable to M4 transform registry; (3) `MovingWindowRenderTimer` adaptive throttle — 5-sample sliding window of frame durations; applicable to M4 compute workers reporting intermediate results at variable latency (linked from `48_computation_workers.md`); (4) `OptionalUpdate<T>` three-state partial DTO — applicable to M4 incremental derived-tensor update requests where only changed transform parameters should trigger recomputation (linked from `49_transform_cache.md`).

[docs/reference-studies/higlass.md](../../reference-studies/higlass.md) contributes two M4-relevant patterns: (1) three-stage tile lifecycle — `visibleTiles` / `fetchedTiles` / `tileGraphics` — maps directly to M4's transform pipeline: `scheduledTransforms` (queued) / `computedTensors` (results ready) / `consumedByViews` (rendered); stale results from previous parameters must be discarded, never written into view state (linked from `49_transform_cache.md`); (2) `BackgroundTaskScheduler` with per-`trackId` deduplication via `requestIdleCallback` — deduplicates stale compute tasks when parameters change faster than workers can process (linked from `48_computation_workers.md`).

[docs/reference-studies/deck-gl.md](../../reference-studies/deck-gl.md) contributes one M4-relevant pattern: the binary attribute API — derived tensors that feed spatial views should produce typed array outputs (`Float32Array` for positions/amplitudes, `Uint8Array` for RGBA colors) that can be passed directly to GPU attribute slots without an intermediate JS object array. This is the right output contract for band-power and coherence tensors feeding the spatial electrode map (linked from `44_bandpower_tensor.md` and `45_coherence_tensor.md`).

## M4 success condition

TensorScope can represent analysis outputs as explicit derived tensors backed by explicit transforms, reusable across views instead of being recomputed ad hoc inside those views.
