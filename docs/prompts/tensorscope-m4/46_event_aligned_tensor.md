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

- define the transform contract for event-aligned tensors: input = (raw tensor, event list, pre/post window); output = stacked `(event_index, time_offset, channel)` tensor
- specify how event-relative coordinates are represented: `time_offset` is in seconds relative to event onset; absolute time is stored as provenance but not as a coordinate axis
- describe stacked event-matrix outputs and metadata: include event count, event type, and source event ids in `DerivedTensor.params`
- keep the result aligned with event navigation and peri-event views

Constraints:

- do not implement event alignment as a view-only concern
- keep alignment windows (pre_s, post_s) and event references (event type, event ids) explicit in the transform registration
- preserve compatibility with shared event-navigation semantics
- the event-aligned tensor must remain valid if individual events are later rejected by the user; rejection state belongs to event metadata, not to the tensor coordinates

Acceptance Criteria:

- peri-event visualizations consume event-aligned tensors
- event-relative coordinates and stacking rules are explicit
- outputs fit the derived-tensor model
- event ids are preserved in provenance so rejected-trial filtering can be applied post-hoc without re-running the transform

Deliverables:

- prompt-ready event-aligned tensor spec
- explicit windowing and alignment contract

## Reference

Nivo's annotation pipeline (`packages/annotations/src/`) defines the right structural analogy for how events become typed, positioned analysis objects. The pipeline is: `EventMatcher<Datum>` → `BoundAnnotation` → `ComputedAnnotation`. In M4 terms: event type definition (`EventMatcher`) → event record with time and metadata (`BoundAnnotation`) → window-extracted tensor slice aligned to that event (`ComputedAnnotation`). Adopt this three-stage pipeline in the `EventAlignedTransform` contract so event binding and tensor extraction are distinct, composable steps.

See [docs/reference-studies/nivo.md §2B](../../reference-studies/nivo.md).
