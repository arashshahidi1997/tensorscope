# Prompt 48: Computation Workers

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [42_spectrogram_tensor.md](./42_spectrogram_tensor.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: move heavy transforms to worker processes.

Scope:

- worker API
- task scheduling
- result messaging

Implementation Tasks:

- define the worker contract for transform execution
- specify task scheduling and result-message semantics
- describe cancellation or stale-result handling where needed
- keep worker execution aligned with derived-tensor outputs

Constraints:

- UI thread must remain responsive
- do not mix worker orchestration with view coordination logic
- keep the first worker API narrow and explicit

Acceptance Criteria:

- derived tensor computations run asynchronously
- worker request/response rules are explicit
- heavy transform execution no longer depends on the main UI loop

Deliverables:

- prompt-ready worker-computation spec
- explicit task scheduling and result-messaging contract
