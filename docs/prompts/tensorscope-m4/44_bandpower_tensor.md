# Prompt 44: Band Power Tensor

Read first:

- [00_context.md](./00_context.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [43_psd_tensor.md](./43_psd_tensor.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: compute band power tensors.

Scope:

- frequency band selection
- temporal aggregation

Implementation Tasks:

- define how band definitions enter the transform contract
- specify temporal aggregation semantics for band power outputs
- describe output tensor coordinates and metadata
- keep the result usable by both spatial maps and time-trace views

Constraints:

- do not bury band definitions inside view logic
- keep aggregation assumptions explicit
- preserve compatibility with existing view registry direction

Acceptance Criteria:

- band power can be displayed in spatial maps and time traces
- band and aggregation rules are explicit
- outputs behave like first-class derived tensors

Deliverables:

- prompt-ready band-power tensor spec
- explicit band-definition and aggregation contract
