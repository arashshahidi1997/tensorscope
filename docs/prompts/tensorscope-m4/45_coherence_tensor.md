# Prompt 45: Coherence Tensor

Read first:

- [00_context.md](./00_context.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: compute pairwise coherence tensors.

Scope:

- channel pair relationships
- frequency-resolved coherence

Implementation Tasks:

- define the transform contract for coherence tensors
- specify how channel-pair structure is represented
- describe frequency-resolved output coordinates and metadata
- keep the design scalable enough for large channel sets

Constraints:

- must support large channel sets
- do not hard-code small-matrix assumptions into the tensor model
- preserve explicit provenance and compatibility metadata

Acceptance Criteria:

- coherence matrices can be visualized efficiently
- channel-pair and frequency coordinates are explicit
- the tensor contract is compatible with large-channel use cases

Deliverables:

- prompt-ready coherence-tensor spec
- explicit pairwise structure and scaling assumptions
