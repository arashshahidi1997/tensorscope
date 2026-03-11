# Prompt 41: Derived Tensor Model

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define a `DerivedTensor` model.

Scope:

- tensor metadata
- parent tensor reference
- transform provenance
- coordinate system compatibility

Implementation Tasks:

- define the minimum metadata needed for derived tensors
- specify how parent tensor and transform provenance are recorded
- describe coordinate compatibility expectations
- keep the model aligned with existing tensor registry and view registry direction

Constraints:

- do not treat derived tensors as second-class view inputs
- preserve enough provenance for reproducibility
- keep compatibility rules explicit

Acceptance Criteria:

- derived tensors behave like base tensors in the view registry
- provenance and parent references are explicit
- coordinate compatibility rules are documented

Deliverables:

- prompt-ready `DerivedTensor` contract
- explicit metadata and provenance expectations
