# Prompt 47: State-Space View

Read first:

- [00_context.md](./00_context.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [46_event_aligned_tensor.md](./46_event_aligned_tensor.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce neural state-space visualization.

Scope:

- dimensionality reduction (PCA, UMAP, or equivalent)
- trajectory visualization in 2D/3D reduced space
- temporal embedding: each frame of the recording is one point on the trajectory

Implementation Tasks:

- define the `DimReductionTransform` contract: input = `(time, channel)` tensor; output = `(time, component)` tensor where `component` is the reduced dimension (typically 2 or 3)
- register the transform with explicit parameters: method (PCA / UMAP), n_components, fitting window (which time range is used to fit the projection)
- specify that the reduced `(time, component)` tensor is a first-class derived tensor with the same `Trackable` provenance contract as spectrogram or PSD
- describe how the trajectory view links to shared time navigation: `timeCursor` maps to a highlighted point on the trajectory; time-window selection highlights a trajectory segment
- keep the state-space outputs linked to shared time navigation via the selection store, not by embedding navigation logic in the view

Constraints:

- do not treat dimensionality reduction as view-internal only
- keep the first design compatible with shared navigation and registry contracts
- preserve a CPU-first baseline (PCA via sklearn / numpy in the Python backend is sufficient for M4)
- do not couple the trajectory rendering to a specific dimensionality reduction method

Acceptance Criteria:

- state-space trajectories can be linked to time navigation via the shared selection store
- reduced outputs are represented as explicit tensor products in the registry
- trajectory semantics (component axes, fitting window) are documented in the transform contract

Deliverables:

- prompt-ready state-space view spec
- explicit reduced-tensor and linking contract

## Reference

Deck.gl's `OrthographicView` + `ScatterplotLayer` + attribute transitions is the right rendering stack for trajectory visualization in 2D reduced space. Each time point is an electrode-free `ScatterplotLayer` point; the `timeCursor` position maps to a highlighted point via `updateTriggers: { getFillColor: [timeCursor] }`. GPU attribute transitions (`transitions: { getFillColor: { duration: 80 } }`) smooth cursor movement without a JS animation loop.

For 3D trajectories, `OrbitView` replaces `OrthographicView`; the interaction model remains the same.

See [docs/reference-studies/deck-gl.md §2.1, §2.2, §2.4](../../reference-studies/deck-gl.md).

The trajectory's time axis must link to the shared navigation store via the same `timeCursor` / `timeWindow` semantics that the timeseries view uses. Neuroglancer's three-mode linking model (`LINKED / RELATIVE / UNLINKED`) is the right mental model for whether the trajectory view's time cursor is locked to the global time or independent.

See [docs/reference-studies/neuroglancer.md §2.2](../../reference-studies/neuroglancer.md).
