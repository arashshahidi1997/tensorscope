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
- M4 builds on those layers by introducing an explicit analysis layer for derived tensors.

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

## Reference studies

[docs/reference-studies/jupyterlab.md](../../reference-studies/jupyterlab.md) contains a JupyterLab frontend analysis (kernel/backend excluded). Two M4-relevant patterns: (1) typed `Token` + plugin activation pattern (`packages/application/src/lab.ts`) — the right model for `TransformRegistry`: transforms declare typed `requires`/`provides` tokens, the registry resolves dependency order before activation, and each registration returns a disposable for clean unregistration (linked from `40_transform_registry.md`); (2) StateDB namespace-prefixed session persistence — debounced auto-save of the active selection DTO and derived tensor cache metadata to `localStorage` under `"tensorscope:session"` keys enables seamless session restore when M4 adds long-running analysis workflows.

[docs/reference-studies/jupyterlite.md](../../reference-studies/jupyterlite.md) contains a JupyterLite analysis. One M4-relevant pattern: Comlink worker RPC — `expose(api)` in the worker + `wrap(new Worker(...))` on the main thread provides transparent async/await worker calls without manual `postMessage` wiring; use for M4 compute workers (spectrogram FFT, coherence, PCA) (linked from `48_computation_workers.md`).

[docs/reference-studies/neuroglancer.md](../../reference-studies/neuroglancer.md) (already covered in M2/M3): Neuroglancer's `ChunkManager` priority tiers remain applicable here — heavy M4 transform jobs should follow the same `VISIBLE > PREFETCH > RECENT` priority model when queuing compute work.

[docs/reference-studies/perspective.md](../../reference-studies/perspective.md) contains a Perspective analytics tool analysis. Four M4-relevant patterns: (1) `save()`/`restore()` per plugin — each view exposes a serializable state token; the workspace aggregates all tokens plus layout into a session snapshot; stub these in M2/M3 views and fill in for M4 session continuity; (2) side-effect plugin registration (`extensions.ts` `registerPlugin()`) — import a transform module and it registers itself; no manual `VIEW_DESCRIPTORS` editing required; directly applicable to M4 transform registry; (3) `MovingWindowRenderTimer` adaptive throttle — 5-sample sliding window of frame durations; applicable to M4 compute workers reporting intermediate results at variable latency; (4) `OptionalUpdate<T>` three-state partial DTO — applicable to M4 incremental derived-tensor update requests where only changed transform parameters should trigger recomputation.

## M4 success condition

TensorScope can represent analysis outputs as explicit derived tensors that are reusable across views instead of recomputing them ad hoc inside those views.
