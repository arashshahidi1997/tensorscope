# Prompt 47: State-Space View

Read first:

- [00_context.md](./00_context.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [46_event_aligned_tensor.md](./46_event_aligned_tensor.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce neural state-space visualization.

Scope:

- dimensionality reduction
- trajectory visualization
- temporal embedding

Implementation Tasks:

- define the tensor and view contract needed for state-space trajectories
- specify how dimensionality reduction outputs become consumable tensors
- describe temporal embedding or trajectory semantics
- keep state-space outputs linked to shared time navigation

Constraints:

- do not treat dimensionality reduction as view-internal only
- keep the first design compatible with shared navigation and registry contracts
- preserve a CPU-first baseline

Acceptance Criteria:

- state-space trajectories can be linked to time navigation
- reduced outputs are represented as explicit tensor products
- trajectory semantics are documented clearly

Deliverables:

- prompt-ready state-space view spec
- explicit reduced-tensor and linking contract
