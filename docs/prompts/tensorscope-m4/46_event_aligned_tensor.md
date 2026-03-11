# Prompt 46: Event-Aligned Tensor

Read first:

- [00_context.md](./00_context.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: create event-aligned derived tensors.

Scope:

- window extraction around events
- alignment to event time
- stacked event matrices

Implementation Tasks:

- define the transform contract for event-aligned tensors
- specify how event-relative coordinates are represented
- describe stacked event-matrix outputs and metadata
- keep the result aligned with event navigation and peri-event views

Constraints:

- do not implement event alignment as a view-only concern
- keep alignment windows and event references explicit
- preserve compatibility with shared event-navigation semantics

Acceptance Criteria:

- peri-event visualizations consume event-aligned tensors
- event-relative coordinates and stacking rules are explicit
- outputs fit the derived-tensor model

Deliverables:

- prompt-ready event-aligned tensor spec
- explicit windowing and alignment contract
