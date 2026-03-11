# Prompt 43: PSD Tensor

Read first:

- [00_context.md](./00_context.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [42_spectrogram_tensor.md](./42_spectrogram_tensor.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: implement power spectral density tensors.

Scope:

- frequency-domain aggregation
- windowed signal segments

Implementation Tasks:

- define the transform contract for PSD tensors
- specify how windowed signal segments feed PSD aggregation
- describe output coordinates and metadata
- keep PSD outputs compatible with current and future PSD views

Constraints:

- do not compute PSD ad hoc inside view components
- keep windowing assumptions explicit
- preserve compatibility with shared tensor/view contracts

Acceptance Criteria:

- PSD tensors can be visualized in PSD views
- frequency-domain aggregation rules are explicit
- PSD outputs fit the derived-tensor model

Deliverables:

- prompt-ready PSD-derived-tensor spec
- explicit aggregation and output semantics
