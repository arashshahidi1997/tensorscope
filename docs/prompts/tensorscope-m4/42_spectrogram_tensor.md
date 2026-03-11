# Prompt 42: Spectrogram Tensor

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: implement spectrogram as a derived tensor.

Scope:

- STFT computation
- frequency coordinate definition
- time-frequency grid

Implementation Tasks:

- define the transform contract for spectrogram tensors
- specify time-frequency coordinates and metadata
- describe how spectrogram outputs become first-class tensors
- keep the result compatible with existing or planned spectrogram views

Constraints:

- use worker-based computation
- views should consume spectrogram tensors instead of computing them inline
- keep time-frequency semantics explicit

Acceptance Criteria:

- `SpectrogramView` consumes spectrogram tensors instead of computing them
- frequency coordinates and grid semantics are explicit
- worker-based computation is part of the design

Deliverables:

- prompt-ready spectrogram-derived-tensor spec
- explicit STFT output and coordinate contract
